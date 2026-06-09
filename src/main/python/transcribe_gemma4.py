#!/usr/bin/env python3
"""CLI script for audio transcription using Gemma 4 with chunking and checkpoint support."""

import argparse
import json
import math
import os
import sys

import librosa
import torch


def log_progress(progress: int, message: str) -> None:
    print(json.dumps({"type": "progress", "progress": progress, "message": message}), file=sys.stderr, flush=True)


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
    parser.add_argument("--hf-token", default="", help="Hugging Face token (ou use env HF_TOKEN)")
    parser.add_argument("--hf-token-stdin", action="store_true", help="Ler HF Token do stdin")
    args = parser.parse_args()

    if not os.path.exists(args.audio):
        log_error(f"Arquivo de áudio não encontrado: {args.audio}")
        sys.exit(1)

    hf_token = None
    if args.hf_token_stdin:
        try:
            hf_token = sys.stdin.read().strip()
        except Exception as e:
            log_error(f"Falha ao ler HF token do stdin: {e}")
            sys.exit(1)
    else:
        hf_token = args.hf_token or os.environ.get("HF_TOKEN", None)

    if not hf_token:
        log_error("Hugging Face Token é obrigatório. Configure o token no aplicativo.")
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
        processor = Gemma4Processor.from_pretrained(args.model, token=hf_token)
        if not checkpoint and not low_memory:
            log_progress(30, "Processor loaded. Loading model weights...")

        load_kwargs: dict = {
            "torch_dtype": dtype,
            "token": hf_token,
            "low_cpu_mem_usage": True,
        }
        if device != "cpu":
            if low_memory:
                # Força mais camadas para o disco quando há pouca RAM
                load_kwargs["device_map"] = "auto"
                load_kwargs["offload_folder"] = offload_dir
                load_kwargs["offload_state_dict"] = True
                load_kwargs["max_memory"] = {0: "4GiB", "cpu": "6GiB"}
            else:
                load_kwargs["device_map"] = "auto"
                load_kwargs["offload_folder"] = offload_dir
        model = Gemma4ForConditionalGeneration.from_pretrained(args.model, **load_kwargs)
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

    for i in range(completed_count, total_chunks):
        start = i * chunk_samples
        end = min(start + chunk_samples, total_samples)
        chunk = audio[start:end]

        progress_start = 60
        progress_end = 95
        chunk_progress = progress_start + int(((i + 1) / total_chunks) * (progress_end - progress_start))
        log_progress(chunk_progress, f"Chunk {i + 1}/{total_chunks} — transcrevendo...")

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
            log_error(f"Falha ao processar chunk {i + 1}: {e}")
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
            log_error(f"Falha na geração da transcrição no chunk {i + 1}: {e}")
            sys.exit(1)

        # Save checkpoint after each chunk
        if checkpoint_path:
            save_checkpoint(checkpoint_path, {
                "audio": args.audio,
                "model": args.model,
                "total_chunks": total_chunks,
                "results": results,
            })

    log_progress(100, "Transcription complete.")

    full_text = " ".join(results)
    result = {"type": "result", "text": full_text}
    print(json.dumps(result), flush=True)


if __name__ == "__main__":
    main()
