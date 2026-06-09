#!/usr/bin/env python3
"""CLI script for audio transcription using Gemma 4 with chunking support."""

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


def main() -> None:
    parser = argparse.ArgumentParser(description="Transcreve áudio usando Gemma 4")
    parser.add_argument("--audio", required=True, help="Caminho do arquivo de áudio")
    parser.add_argument("--model", default="google/gemma-4-12B-it", help="ID do modelo no Hugging Face")
    parser.add_argument("--max-tokens", type=int, default=512, help="Número máximo de tokens a gerar por chunk")
    parser.add_argument("--chunk-duration", type=int, default=30, help="Duração de cada chunk de áudio em segundos")
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

    log_progress(10, "Loading model...")

    # Diretório temporário para offload de pesos quando a memória não for suficiente
    offload_dir = os.path.join(os.path.dirname(__file__), "model_offload")
    os.makedirs(offload_dir, exist_ok=True)

    try:
        processor = Gemma4Processor.from_pretrained(args.model, token=hf_token)
        log_progress(30, "Processor loaded. Loading model weights...")

        load_kwargs: dict = {
            "torch_dtype": dtype,
            "token": hf_token,
            "low_cpu_mem_usage": True,
        }
        if device != "cpu":
            load_kwargs["device_map"] = "auto"
            load_kwargs["offload_folder"] = offload_dir
        model = Gemma4ForConditionalGeneration.from_pretrained(args.model, **load_kwargs)
        if device == "cpu":
            model = model.to(device)
    except Exception as e:
        log_error(f"Falha ao carregar modelo: {e}")
        sys.exit(1)

    log_progress(50, "Model loaded. Loading audio...")

    try:
        audio, sr = librosa.load(args.audio, sr=16000, mono=True)
    except Exception as e:
        log_error(f"Falha ao carregar áudio: {e}")
        sys.exit(1)

    total_samples = len(audio)
    chunk_samples = args.chunk_duration * sr
    total_chunks = max(1, math.ceil(total_samples / chunk_samples))

    log_progress(55, f"Áudio de {total_samples / sr:.0f}s dividido em {total_chunks} chunk(s) de {args.chunk_duration}s...")

    system_prompt = "Transcreva o conteúdo deste áudio em português, palavra por palavra."
    transcriptions: list[str] = []

    for i in range(total_chunks):
        start = i * chunk_samples
        end = min(start + chunk_samples, total_samples)
        chunk = audio[start:end]

        progress_start = 60
        progress_end = 95
        chunk_progress = progress_start + int(((i + 1) / total_chunks) * (progress_end - progress_start))
        log_progress(chunk_progress, f"Transcrevendo chunk {i + 1}/{total_chunks}...")

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
                transcriptions.append(chunk_text.strip())
        except Exception as e:
            log_error(f"Falha na geração da transcrição no chunk {i + 1}: {e}")
            sys.exit(1)

    log_progress(100, "Transcription complete.")

    full_text = " ".join(transcriptions)
    result = {"type": "result", "text": full_text}
    print(json.dumps(result), flush=True)


if __name__ == "__main__":
    main()
