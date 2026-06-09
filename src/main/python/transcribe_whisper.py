#!/usr/bin/env python3
"""Script para transcrição de áudio usando Whisper Large v3."""

import argparse
import json
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
        report_progress(10, "Carregando modelo Whisper...")
        model = whisper.load_model("large-v3", download_root=args.model_dir)

        report_progress(30, "Transcrevendo áudio...")
        audio = whisper.load_audio(args.audio)

        initial_prompt = args.context if args.context else None

        result = model.transcribe(
            audio,
            language=args.language,
            initial_prompt=initial_prompt,
            verbose=False,
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
