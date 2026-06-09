#!/usr/bin/env python3
"""Script para transcrição de áudio usando Whisper Large v3."""

import argparse
import json
import os
import sys
import traceback

try:
    import torch
    import whisper
except ImportError:
    print(
        json.dumps(
            {"type": "error", "message": "Biblioteca openai-whisper não instalada"}
        ),
        file=sys.stderr,
    )
    sys.exit(1)


def report_progress(progress: int, message: str) -> None:
    payload = {"type": "progress", "progress": progress, "message": message}
    print(json.dumps(payload), file=sys.stderr)


def report_error(message: str) -> None:
    payload = {"type": "error", "message": message}
    print(json.dumps(payload), file=sys.stderr)


def main() -> None:
    parser = argparse.ArgumentParser(description="Transcrição de áudio com Whisper")
    parser.add_argument("--audio", required=True, help="Caminho do arquivo de áudio")
    parser.add_argument(
        "--model-dir", required=True, help="Diretório onde o modelo está salvo"
    )
    parser.add_argument(
        "--language", default="pt", help="Idioma do áudio (padrão: pt)"
    )
    parser.add_argument(
        "--context",
        default=None,
        help="Texto de contexto do documento para initial_prompt",
    )
    args = parser.parse_args()

    try:
        # Detecta MPS (Apple Silicon) ou CUDA, senão CPU
        device = "cpu"
        if torch.cuda.is_available():
            device = "cuda"
        elif torch.backends.mps.is_available():
            device = "mps"
        report_progress(5, f"Dispositivo detectado: {device}")

        model_path = os.path.join(args.model_dir, "large-v3.pt")
        report_progress(10, "Carregando modelo Whisper...")
        model = whisper.load_model(model_path, device=device)

        report_progress(30, "Transcrevendo áudio...")
        audio = whisper.load_audio(args.audio)

        initial_prompt = args.context if args.context else None

        result = model.transcribe(
            audio,
            language=args.language,
            initial_prompt=initial_prompt,
            verbose=False,
            fp16=False,  # necessário para MPS/CPU
        )

        report_progress(80, "Finalizando...")

        text = result.get("text", "").strip()
        print(json.dumps({"type": "result", "text": text}))
    except Exception as exc:
        report_error(f"Erro na transcrição com Whisper: {exc}")
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
