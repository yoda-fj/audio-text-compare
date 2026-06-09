#!/usr/bin/env python3
"""Script para download do modelo Whisper Large v3."""

import argparse
import json
import os
import sys
import traceback

try:
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
    parser = argparse.ArgumentParser(description="Download do modelo Whisper Large v3")
    parser.add_argument(
        "--model-dir",
        required=True,
        help="Diretório para salvar o modelo",
    )
    args = parser.parse_args()

    try:
        report_progress(10, "Baixando modelo Whisper large-v3...")
        whisper.load_model("large-v3", download_root=args.model_dir)

        # Verifica se o arquivo foi salvo no local esperado
        model_path = os.path.join(args.model_dir, "large-v3.pt")
        if not os.path.exists(model_path):
            raise FileNotFoundError(f"Modelo não encontrado em {model_path}")

        report_progress(100, "Modelo pronto")
    except Exception as exc:
        report_error(f"Erro ao baixar modelo Whisper: {exc}")
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
