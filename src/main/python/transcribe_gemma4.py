#!/usr/bin/env python3
"""CLI script for audio transcription using Gemma 4 with chunking and checkpoint support.

Protocolo de saída:
  - stderr: uma linha JSON por evento, com discriminador `type`:
      * "progress"      — progresso genérico (campo extra aceito via kwargs)
      * "chunk_start"   — antes de processar um chunk
      * "chunk_done"    — chunk concluído com sucesso (text + duration_ms)
      * "chunk_error"   — chunk falhou (error_message)
      * "error"         — erro fatal (e o processo sai com código ≠ 0)
  - stdout: linha final com {"type": "result", "text": ...} em sucesso (exit 0)
"""

import argparse
import json
import math
import os
import sys
import time
from typing import Any

import librosa
import torch


def log_progress(progress: int, message: str, **extra: Any) -> None:
    """Emite um evento de progresso em stderr como JSON de uma linha.

    Aceita campos extras opcionais (ex: chunk_index, chunk_start_s, total_chunks)
    que são fundidos no payload. Campos fixos não são sobrescritos.
    """
    payload: dict[str, Any] = {"type": "progress", "progress": progress, "message": message}
    for k, v in extra.items():
        if k in payload:
            continue
        payload[k] = v
    print(json.dumps(payload, ensure_ascii=False), file=sys.stderr, flush=True)


def log_event(event_type: str, **fields: Any) -> None:
    """Emite um evento estruturado de chunk_start/chunk_done/chunk_error.

    Exemplo:
        log_event("chunk_start", chunk_index=0, chunk_start_s=0.0,
                  chunk_end_s=30.0, total_chunks=10)
    """
    payload: dict[str, Any] = {"type": event_type}
    for k, v in fields.items():
        if k in payload:
            continue
        payload[k] = v
    print(json.dumps(payload, ensure_ascii=False), file=sys.stderr, flush=True)


def log_error(message: str) -> None:
    print(json.dumps({"type": "error", "message": message}), file=sys.stderr, flush=True)


def load_checkpoint(checkpoint_path: str) -> dict:
    if not os.path.exists(checkpoint_path):
        return {}
    try:
        with open(checkpoint_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_checkpoint(checkpoint_path: str, data: dict) -> None:
    """Escreve o checkpoint. É tratado pelo Node como artefato derivado:
    a tabela `chunks` no DB é a fonte de verdade e pode regenerar este
    arquivo a qualquer momento."""
    try:
        with open(checkpoint_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        log_error(f"Falha ao salvar checkpoint: {e}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Transcreve áudio usando Gemma 4")
    parser.add_argument("--audio", required=True, help="Caminho do arquivo de áudio")
    parser.add_argument("--model", default="google/gemma-4-12B-it", help="ID do modelo no Hugging Face")
    parser.add_argument("--max-tokens", type=int, default=512, help="Número máximo de tokens a gerar por chunk")
    parser.add_argument("--chunk-duration", type=int, default=30, help="Duração de cada chunk de áudio em segundos")
    parser.add_argument("--checkpoint-file", default="", help="Caminho do arquivo de checkpoint JSON")
    parser.add_argument("--context", default="", help="Texto do documento original para contextualizar a transcrição")
    parser.add_argument("--low-memory", action="store_true", help="Força mais offload para disco (mais lento, usa menos RAM)")
    parser.add_argument("--cache-dir", default="", help="Diretório de cache do Hugging Face (para modelos embutidos no pacote)")
    parser.add_argument(
        "--max-chunks",
        type=int,
        default=0,
        help="Processa no máximo este número de chunks novos (0 = todos). "
             "Usado pelo modo 'pré-teste' do app: processa só os primeiros N "
             "chunks para validar antes de rodar o áudio inteiro.",
    )
    args = parser.parse_args()

    if not os.path.exists(args.audio):
        log_error(f"Arquivo de áudio não encontrado: {args.audio}")
        sys.exit(1)

    # Load checkpoint if available
    checkpoint = {}
    checkpoint_path = args.checkpoint_file
    if checkpoint_path:
        checkpoint = load_checkpoint(checkpoint_path)
        if checkpoint.get("audio") == args.audio and checkpoint.get("model") == args.model:
            completed = len(checkpoint.get("results", []))
            if completed > 0:
                log_progress(10, f"Retomando transcrição: {completed} chunk(s) já processado(s)...")
        else:
            checkpoint = {}

    try:
        from transformers import Gemma4Processor, Gemma4ForConditionalGeneration
    except ImportError as e:
        log_error(f"Erro ao importar Gemma4 classes: {e}")
        sys.exit(1)

    # Detectar device: MPS (Mac Silicon), CUDA, ou CPU
    if torch.backends.mps.is_available():
        device = "mps"
        dtype = torch.bfloat16
    elif torch.cuda.is_available():
        device = "cuda"
        dtype = torch.bfloat16
    else:
        device = "cpu"
        dtype = torch.float32

    # Detectar RAM total para decidir offload agressivo
    total_ram_gb = 16
    try:
        import psutil
        total_ram_gb = psutil.virtual_memory().total / (1024 ** 3)
    except Exception:
        try:
            import subprocess
            total_ram_bytes = int(subprocess.check_output(["sysctl", "-n", "hw.memsize"]).strip())
            total_ram_gb = total_ram_bytes / (1024 ** 3)
        except Exception:
            pass

    low_memory = args.low_memory or total_ram_gb < 20
    if low_memory:
        log_progress(10, f"Modo economia de memória ativado ({total_ram_gb:.0f} GB RAM detectada). Carregando modelo com offload para disco...")
    elif not checkpoint:
        log_progress(10, "Loading model...")
    else:
        log_progress(10, "Loading model (retomando)...")

    # Diretório temporário para offload de pesos quando a memória não for suficiente
    offload_dir = os.path.join(os.path.dirname(__file__), "model_offload")
    os.makedirs(offload_dir, exist_ok=True)

    try:
        processor_kwargs: dict = {}
        model_kwargs: dict = {
            "torch_dtype": dtype,
            "low_cpu_mem_usage": True,
        }
        if args.cache_dir:
            processor_kwargs["cache_dir"] = args.cache_dir
            model_kwargs["cache_dir"] = args.cache_dir
            processor_kwargs["local_files_only"] = True
            model_kwargs["local_files_only"] = True

        processor = Gemma4Processor.from_pretrained(args.model, **processor_kwargs)
        if not checkpoint and not low_memory:
            log_progress(30, "Processor loaded. Loading model weights...")

        if device != "cpu":
            if low_memory:
                # Força mais camadas para o disco quando há pouca RAM
                model_kwargs["device_map"] = "auto"
                model_kwargs["offload_folder"] = offload_dir
                model_kwargs["offload_state_dict"] = True
                model_kwargs["max_memory"] = {0: "4GiB", "cpu": "6GiB"}
            else:
                model_kwargs["device_map"] = "auto"
                model_kwargs["offload_folder"] = offload_dir
        model = Gemma4ForConditionalGeneration.from_pretrained(args.model, **model_kwargs)
        if device == "cpu":
            model = model.to(device)
    except Exception as e:
        log_error(f"Falha ao carregar modelo: {e}")
        sys.exit(1)

    if not checkpoint:
        log_progress(50, "Model loaded. Loading audio...")

    try:
        audio, sr = librosa.load(args.audio, sr=16000, mono=True)
    except Exception as e:
        log_error(f"Falha ao carregar áudio: {e}")
        sys.exit(1)

    total_samples = len(audio)
    chunk_samples = args.chunk_duration * sr
    total_chunks = max(1, math.ceil(total_samples / chunk_samples))

    # Restore checkpoint state
    results = checkpoint.get("results", [])
    completed_count = len(results)

    if completed_count > 0:
        log_progress(55, f"Retomando: {completed_count}/{total_chunks} chunks já processados. Continuando...")
    else:
        log_progress(55, f"Áudio de {total_samples / sr:.0f}s dividido em {total_chunks} chunk(s) de {args.chunk_duration}s...")

    if args.context and args.context.strip():
        context_snippet = args.context.strip()[:2000]
        system_prompt = f"""Você está transcribindo um áudio relacionado ao seguinte documento:

---
{context_snippet}
---

Transcreva o conteúdo deste áudio em português, palavra por palavra."""
    else:
        system_prompt = "Transcreva o conteúdo deste áudio em português, palavra por palavra."

    # Limite de chunks: pré-teste vs. transcrição completa.
    # --max-chunks N ⇒ processa no máximo N chunks novos (além dos já
    # concluídos do checkpoint). 0 = sem limite (roda tudo).
    max_new = args.max_chunks if args.max_chunks > 0 else (total_chunks - completed_count)
    end_index = min(total_chunks, completed_count + max_new)
    is_pretest = args.max_chunks > 0 and end_index < total_chunks

    if is_pretest:
        log_progress(
            55,
            f"Pré-teste: processando {end_index - completed_count} chunk(s) "
            f"({completed_count + 1}–{end_index} de {total_chunks})...",
        )

    for i in range(completed_count, end_index):
        start = i * chunk_samples
        end = min(start + chunk_samples, total_samples)
        chunk = audio[start:end]
        chunk_start_s = start / sr
        chunk_end_s = end / sr

        # Emite chunk_start ANTES do processamento (Node vai upsertar com
        # status='transcribing' e o painel mostra o spinner).
        log_event(
            "chunk_start",
            chunk_index=i,
            chunk_start_s=chunk_start_s,
            chunk_end_s=chunk_end_s,
            total_chunks=total_chunks,
        )

        # Mantém uma linha de progresso "genérico" para a TranscriptionModal
        # (que ainda lê progress+message). Será removida quando migrarmos
        # a modal para consumir eventos estruturados.
        progress_start = 60
        progress_end = 95
        chunk_progress = progress_start + int(((i + 1) / total_chunks) * (progress_end - progress_start))
        log_progress(
            chunk_progress,
            f"Chunk {i + 1}/{total_chunks} — transcrevendo...",
        )

        chunk_t0 = time.monotonic()

        try:
            messages = [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": system_prompt},
                        {"type": "audio"},
                    ],
                },
            ]
            prompt_text = processor.apply_chat_template(messages, add_generation_prompt=True, tokenize=False)
            inputs = processor(
                text=prompt_text,
                audio=[chunk],
                return_tensors="pt",
            )
            if device != "cpu":
                inputs = inputs.to(device)
        except Exception as e:
            log_event("chunk_error", chunk_index=i, error_message=f"Falha ao processar chunk: {e}")
            sys.exit(1)

        try:
            with torch.no_grad():
                generate_ids = model.generate(
                    **inputs,
                    max_new_tokens=args.max_tokens,
                    do_sample=False,
                )
            generate_ids = generate_ids[:, inputs["input_ids"].shape[1]:]
            chunk_text = processor.batch_decode(generate_ids, skip_special_tokens=True)[0]
            if chunk_text.strip():
                results.append(chunk_text.strip())
        except Exception as e:
            log_event("chunk_error", chunk_index=i, error_message=f"Falha na geração da transcrição: {e}")
            sys.exit(1)

        duration_ms = int((time.monotonic() - chunk_t0) * 1000)

        # Emite chunk_done com o texto e a duração do processamento.
        # Node vai upsertar o chunk (status='done', text, duration_ms).
        log_event(
            "chunk_done",
            chunk_index=i,
            text=(chunk_text.strip() if chunk_text else ""),
            duration_ms=duration_ms,
        )

        # Checkpoint derivado: o Node pode regenerá-lo a partir do DB, mas
        # mantemos a escrita local para retomar dentro da mesma sessão
        # (sem precisar ir ao DB a cada chunk).
        if checkpoint_path:
            save_checkpoint(checkpoint_path, {
                "audio": args.audio,
                "model": args.model,
                "total_chunks": total_chunks,
                "results": results,
            })

    if is_pretest:
        # Pré-teste terminou antes do áudio inteiro. Não marca a comparação
        # como completa: o Node usa o discriminador `pretest` no payload
        # para manter a comparação em 'pending' com os chunks já em 'done'.
        log_progress(100, f"Pré-teste concluído: {len(results)}/{total_chunks} chunk(s).")
    else:
        log_progress(100, "Transcription complete.")

    full_text = " ".join(results)
    result = {"type": "result", "text": full_text, "pretest": is_pretest}
    print(json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
