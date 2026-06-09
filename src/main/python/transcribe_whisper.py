#!/usr/bin/env python3
"""Script para transcrição de áudio usando Whisper Large v3 com chunking e progresso."""

import argparse
import io
import json
import math
import os
import re
import sys
import traceback

try:
    import numpy as np
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


CHUNK_DURATION = 600  # 10 minutos por chunk
SAMPLE_RATE = 16000
OVERLAP_SECONDS = 2  # sobreposição entre chunks para não perder palavras


def report_progress(progress: int, message: str) -> None:
    payload = {"type": "progress", "progress": progress, "message": message}
    print(json.dumps(payload), file=sys.stderr)


def report_error(message: str) -> None:
    payload = {"type": "error", "message": message}
    print(json.dumps(payload), file=sys.stderr)


class ProgressCapture:
    """Intercepta o stdout do Whisper e envia progresso em JSON para o stderr."""

    def __init__(self, chunk_start: float, chunk_end: float, chunk_idx: int, total_chunks: int):
        self.chunk_start = chunk_start
        self.chunk_end = chunk_end
        self.chunk_idx = chunk_idx
        self.total_chunks = total_chunks
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

        if "Detecting language" in line:
            return  # ignora no chunking

        match = re.match(r"\[(\d+:\d+\.\d+)\s*-->\s*(\d+:\d+\.\d+)\]\s*(.*)", line)
        if match:
            _, end_str, text_seg = match.groups()
            progress_base = int((self.chunk_idx / self.total_chunks) * 90)
            progress = min(90, progress_base + 5)
            report_progress(
                progress,
                f"Chunk {self.chunk_idx + 1}/{self.total_chunks} [{self._fmt_time(self.chunk_start)} --> {self._fmt_time(self.chunk_end)}] {text_seg[:60]}{'...' if len(text_seg) > 60 else ''}",
            )
            return

    @staticmethod
    def _fmt_time(seconds: float) -> str:
        m = int(seconds // 60)
        s = int(seconds % 60)
        return f"{m:02d}:{s:02d}"


def transcribe_chunk(model, audio_chunk: np.ndarray, language: str, initial_prompt: str | None) -> str:
    """Transcreve um chunk de áudio."""
    old_stdout = sys.stdout
    sys.stdout = io.StringIO()
    try:
        result = model.transcribe(
            audio_chunk,
            language=language,
            initial_prompt=initial_prompt,
            verbose=False,
            fp16=False,
            condition_on_previous_text=True,
        )
    finally:
        sys.stdout = old_stdout
    return result.get("text", "").strip()


def main() -> None:
    parser = argparse.ArgumentParser(description="Transcrição de áudio com Whisper (chunked)")
    parser.add_argument("--audio", required=True, help="Caminho do arquivo de áudio")
    parser.add_argument("--model-dir", required=True, help="Diretório onde o modelo está salvo")
    parser.add_argument("--language", default="pt", help="Idioma do áudio (padrão: pt)")
    parser.add_argument("--context", default=None, help="Texto de contexto do documento")
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

        report_progress(20, "Carregando áudio...")
        audio = whisper.load_audio(args.audio)
        total_duration = len(audio) / SAMPLE_RATE
        report_progress(22, f"Áudio: {total_duration / 60:.1f} minutos")

        # Divide em chunks
        chunk_samples = CHUNK_DURATION * SAMPLE_RATE
        overlap_samples = OVERLAP_SECONDS * SAMPLE_RATE
        total_chunks = max(1, math.ceil((len(audio) - overlap_samples) / (chunk_samples - overlap_samples)))
        report_progress(25, f"Dividindo em {total_chunks} chunk(s) de ~{CHUNK_DURATION // 60} min...")

        all_texts = []
        prev_text = args.context if args.context else None

        for i in range(total_chunks):
            start_sample = i * (chunk_samples - overlap_samples)
            end_sample = min(start_sample + chunk_samples, len(audio))
            chunk = audio[start_sample:end_sample]

            chunk_start_sec = start_sample / SAMPLE_RATE
            chunk_end_sec = end_sample / SAMPLE_RATE

            report_progress(
                int(25 + (i / total_chunks) * 65),
                f"Chunk {i + 1}/{total_chunks} — transcrevendo ({chunk_start_sec / 60:.0f}–{chunk_end_sec / 60:.0f} min)...",
            )

            text = transcribe_chunk(model, chunk, args.language, prev_text)
            if text:
                all_texts.append(text)
                # Usa os últimos 200 chars do chunk atual como contexto para o próximo
                prev_text = text[-200:] if len(text) > 200 else text

        report_progress(95, "Finalizando transcrição...")

        full_text = "\n".join(all_texts)
        print(json.dumps({"type": "result", "text": full_text}))
    except Exception as exc:
        report_error(f"Erro na transcrição com Whisper: {exc}")
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
