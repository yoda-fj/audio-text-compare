#!/usr/bin/env python3
"""Script para transcrição de áudio usando Whisper Large v3 com progresso por segmento."""

import argparse
import json
import os
import re
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
    print(json.dumps(payload), file=sys.stderr, flush=True)


def report_error(message: str) -> None:
    payload = {"type": "error", "message": message}
    print(json.dumps(payload), file=sys.stderr, flush=True)


class SegmentCapture:
    """Redireciona sys.stdout para capturar os segmentos do Whisper em tempo real."""

    def __init__(self, total_duration: float):
        self.total_duration = total_duration
        self._buffer = ""

    def write(self, text: str) -> None:
        self._buffer += text
        while "\n" in self._buffer:
            line, self._buffer = self._buffer.split("\n", 1)
            self._process_line(line)

    def flush(self) -> None:
        if self._buffer:
            self._process_line(self._buffer)
            self._buffer = ""

    def _process_line(self, line: str) -> None:
        line = line.strip()
        if not line:
            return

        if "Detecting language" in line or "Detected language" in line:
            report_progress(30, f"🔍 {line}")
            return

        # Regex que aceita tanto MM:SS.mmm quanto HH:MM:SS.mmm
        match = re.match(
            r"\[(\d+:\d+(?::\d+)?\.\d+)\s*-->\s*(\d+:\d+(?::\d+)?\.\d+)\]\s*(.*)",
            line,
        )
        if match:
            start_str, end_str, text_seg = match.groups()
            end_sec = self._parse_time(end_str)
            progress = min(95, int(30 + (end_sec / self.total_duration) * 65))
            report_progress(
                progress,
                f"[{start_str} --> {end_str}] {text_seg}",
            )
            return

    @staticmethod
    def _parse_time(t: str) -> float:
        parts = t.split(":")
        if len(parts) == 2:
            m, s = parts
            return float(m) * 60 + float(s)
        elif len(parts) == 3:
            h, m, s = parts
            return float(h) * 3600 + float(m) * 60 + float(s)
        return 0.0


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
        device = "cpu"
        if torch.cuda.is_available():
            device = "cuda"
        elif torch.backends.mps.is_available():
            device = "mps"
        report_progress(5, f"Dispositivo detectado: {device}")

        model_path = os.path.join(args.model_dir, "large-v3.pt")
        report_progress(10, "Carregando modelo Whisper...")
        model = whisper.load_model(model_path, device=device)

        report_progress(25, "Carregando áudio...")
        audio = whisper.load_audio(args.audio)
        total_duration = len(audio) / 16000.0
        report_progress(28, f"Áudio: {total_duration / 60:.1f} minutos")

        initial_prompt = args.context if args.context else None

        # Captura o stdout do Whisper para reportar segmentos em tempo real
        capture = SegmentCapture(total_duration)
        old_stdout = sys.stdout
        sys.stdout = capture

        try:
            result = model.transcribe(
                audio,
                language=args.language,
                initial_prompt=initial_prompt,
                verbose=True,  # ativa saída segmento a segmento
                fp16=False,
            )
        finally:
            sys.stdout = old_stdout
            capture.flush()

        report_progress(98, "Finalizando transcrição...")

        text = result.get("text", "").strip()
        print(json.dumps({"type": "result", "text": text}))
    except Exception as exc:
        report_error(f"Erro na transcrição com Whisper: {exc}")
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
