#!/usr/bin/env python3
"""Script para transcrição de áudio usando Whisper Large v3 com chunking e progresso por segmento."""

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
OVERLAP_SECONDS = 2


def report_progress(progress: int, message: str) -> None:
    payload = {"type": "progress", "progress": progress, "message": message}
    print(json.dumps(payload), file=sys.stderr, flush=True)


def report_error(message: str) -> None:
    payload = {"type": "error", "message": message}
    print(json.dumps(payload), file=sys.stderr, flush=True)


class SegmentReporter:
    """Captura os segmentos do Whisper e envia para o stderr com offset de tempo do chunk."""

    def __init__(self, chunk_offset_sec: float, chunk_idx: int, total_chunks: int):
        self.chunk_offset_sec = chunk_offset_sec
        self.chunk_idx = chunk_idx
        self.total_chunks = total_chunks
        self._buffer = ""
        self.segments = []

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

        # Ignora "Detecting language"
        if "Detecting language" in line:
            return

        # Segmento: [00:00.000 --> 00:05.000]  Texto...
        match = re.match(r"\[(\d+:\d+\.\d+)\s*-->\s*(\d+:\d+\.\d+)\]\s*(.*)", line)
        if match:
            start_str, end_str, text_seg = match.groups()
            start_sec = self._time_to_seconds(start_str) + self.chunk_offset_sec
            end_sec = self._time_to_seconds(end_str) + self.chunk_offset_sec
            self.segments.append(text_seg)

            progress = min(95, int(25 + ((self.chunk_idx + (end_sec - self.chunk_offset_sec) / CHUNK_DURATION) / self.total_chunks) * 65))
            report_progress(
                progress,
                f"[{self._fmt_time(start_sec)} --> {self._fmt_time(end_sec)}] {text_seg}",
            )

    @staticmethod
    def _time_to_seconds(t: str) -> float:
        parts = t.split(":")
        if len(parts) == 2:
            m, s = parts
            return float(m) * 60 + float(s)
        elif len(parts) == 3:
            h, m, s = parts
            return float(h) * 3600 + float(m) * 60 + float(s)
        return 0.0

    @staticmethod
    def _fmt_time(seconds: float) -> str:
        h = int(seconds // 3600)
        m = int((seconds % 3600) // 60)
        s = int(seconds % 60)
        if h > 0:
            return f"{h:02d}:{m:02d}:{s:02d}"
        return f"{m:02d}:{s:02d}"


def transcribe_chunk(model, audio_chunk: np.ndarray, language: str, initial_prompt: str | None, reporter: SegmentReporter) -> str:
    """Transcreve um chunk de áudio reportando cada segmento."""
    old_stdout = sys.stdout
    sys.stdout = reporter
    try:
        result = model.transcribe(
            audio_chunk,
            language=language,
            initial_prompt=initial_prompt,
            verbose=True,  # ativa saída segmento a segmento
            fp16=False,
            condition_on_previous_text=True,
        )
    finally:
        sys.stdout = old_stdout
        reporter.flush()
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
            chunk_offset_sec = start_sample / SAMPLE_RATE

            report_progress(
                int(25 + (i / total_chunks) * 65),
                f"Chunk {i + 1}/{total_chunks} — iniciando ({chunk_offset_sec / 60:.0f} min)...",
            )

            reporter = SegmentReporter(chunk_offset_sec, i, total_chunks)
            text = transcribe_chunk(model, chunk, args.language, prev_text, reporter)
            if text:
                all_texts.append(text)
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
