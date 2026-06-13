#!/usr/bin/env python3
"""Baixa o modelo Whisper via openai-whisper.

Uso: python download_whisper.py --model-dir <dir> --model-name <name>

Reporta progresso via stderr no formato JSON:
  {"type": "progress", "progress": 10, "message": "Iniciando download..."}

Conclui com stdout JSON:
  {"type": "result", "path": "..."}
"""

import argparse
import json
import os
import sys


def report_progress(progress: int, message: str) -> None:
    print(json.dumps({"type": "progress", "progress": int(progress), "message": message}),
          file=sys.stderr, flush=True)


def report_error(message: str) -> None:
    print(json.dumps({"type": "error", "message": message}),
          file=sys.stderr, flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Baixa um modelo Whisper")
    parser.add_argument("--model-dir", required=True, help="Diretório de destino")
    parser.add_argument("--model-name", default="large-v3", help="Nome do modelo Whisper")
    args = parser.parse_args()

    try:
        import whisper
    except ImportError as e:
        report_error(f"openai-whisper não instalado: {e}")
        sys.exit(1)

    os.makedirs(args.model_dir, exist_ok=True)

    report_progress(10, f"Iniciando download do Whisper {args.model_name}...")

    try:
        # whisper.load_model faz o download automático se o arquivo não existir
        # em download_root. O nome do arquivo esperado é <model-name>.pt.
        report_progress(50, "Baixando modelo (≈3 GB). Isso pode levar alguns minutos...")
        model = whisper.load_model(args.model_name, download_root=args.model_dir)
    except Exception as e:
        report_error(f"Falha ao baixar modelo Whisper: {e}")
        sys.exit(1)

    model_path = os.path.join(args.model_dir, f"{args.model_name}.pt")
    if not os.path.isfile(model_path):
        report_error(f"Arquivo do modelo não encontrado após download: {model_path}")
        sys.exit(1)

    report_progress(100, f"Download concluído: {model_path}")
    print(json.dumps({"type": "result", "path": model_path}),
          flush=True)


if __name__ == "__main__":
    main()
