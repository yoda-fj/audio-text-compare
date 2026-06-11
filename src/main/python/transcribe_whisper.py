#!/usr/bin/env python3
"""Script para transcrição de áudio usando Whisper Large v3 com progresso por segmento.

Protocolo de saída:
  - stderr: linhas JSON com {"type": "progress"|"error", ...} (uma por linha)
  - stdout: ao final, uma linha JSON com {"type": "result", "text": ..., "language": ..., "segments": [...]}
"""

import argparse
import contextlib
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
        flush=True,
    )
    sys.exit(1)

SAMPLE_RATE = 16_000

# Marcos de progresso (0-100)
PROGRESS_DEVICE = 5
PROGRESS_LOAD_MODEL = 10
PROGRESS_LOAD_AUDIO = 25
PROGRESS_AUDIO_INFO = 28
PROGRESS_TRANSCRIBE_START = 30
PROGRESS_TRANSCRIBE_END = 95
PROGRESS_FINALIZE = 98

# O Whisper usa apenas os últimos ~224 tokens do initial_prompt.
# ~4 chars/token em pt-BR → margem segura de ~1000 caracteres.
MAX_CONTEXT_CHARS = 1000

SEGMENT_RE = re.compile(
    r"\[(\d+:\d+(?::\d+)?\.\d+)\s*-->\s*(\d+:\d+(?::\d+)?\.\d+)\]\s*(.*)"
)


def report_progress(progress: int, message: str) -> None:
    payload = {"type": "progress", "progress": progress, "message": message}
    print(json.dumps(payload, ensure_ascii=False), file=sys.stderr, flush=True)


def report_error(message: str, detail: str | None = None) -> None:
    payload = {"type": "error", "message": message}
    if detail:
        # Traceback vai DENTRO do JSON para não quebrar o parser de linhas no consumidor
        payload["detail"] = detail
    print(json.dumps(payload, ensure_ascii=False), file=sys.stderr, flush=True)


def parse_timestamp(t: str) -> float:
    """Converte 'MM:SS.mmm' ou 'HH:MM:SS.mmm' para segundos."""
    parts = t.split(":")
    try:
        if len(parts) == 2:
            m, s = parts
            return float(m) * 60 + float(s)
        if len(parts) == 3:
            h, m, s = parts
            return float(h) * 3600 + float(m) * 60 + float(s)
    except ValueError:
        pass
    return 0.0


class SegmentCapture:
    """File-like que intercepta o stdout do Whisper (verbose=True) e converte
    cada segmento impresso em um evento de progresso JSON no stderr."""

    def __init__(self, total_duration: float):
        # Evita divisão por zero em áudios vazios/corrompidos
        self.total_duration = max(total_duration, 0.001)
        self._buffer = ""

    # --- interface file-like mínima ---------------------------------------
    def write(self, text: str) -> int:
        self._buffer += text
        while "\n" in self._buffer:
            line, self._buffer = self._buffer.split("\n", 1)
            self._process_line(line)
        return len(text)

    def flush(self) -> None:
        if self._buffer:
            self._process_line(self._buffer)
            self._buffer = ""

    def isatty(self) -> bool:
        return False

    def fileno(self) -> int:
        raise OSError("SegmentCapture não possui file descriptor")

    @property
    def encoding(self) -> str:
        return "utf-8"

    # -----------------------------------------------------------------------
    def _process_line(self, line: str) -> None:
        line = line.strip()
        if not line:
            return

        if "Detecting language" in line or "Detected language" in line:
            report_progress(PROGRESS_TRANSCRIBE_START, f"🔍 {line}")
            return

        match = SEGMENT_RE.match(line)
        if match:
            start_str, end_str, text_seg = match.groups()
            end_sec = parse_timestamp(end_str)
            span = PROGRESS_TRANSCRIBE_END - PROGRESS_TRANSCRIBE_START
            progress = min(
                PROGRESS_TRANSCRIBE_END,
                int(PROGRESS_TRANSCRIBE_START + (end_sec / self.total_duration) * span),
            )
            report_progress(progress, f"[{start_str} --> {end_str}] {text_seg}")


def detect_device() -> tuple[str, bool]:
    """Retorna (device, fp16). fp16 só compensa em CUDA; em CPU não é suportado
    e em MPS o openai-whisper tem operações instáveis."""
    if torch.cuda.is_available():
        return "cuda", True
    mps = getattr(torch.backends, "mps", None)
    if mps is not None and mps.is_available():
        return "mps", False
    return "cpu", False


def load_model_with_fallback(model_path: str, device: str):
    """Carrega o modelo no device pedido; se MPS falhar (limitação conhecida
    do openai-whisper), cai para CPU em vez de abortar."""
    try:
        return whisper.load_model(model_path, device=device), device
    except (RuntimeError, NotImplementedError):
        if device != "mps":
            raise
        report_progress(
            PROGRESS_LOAD_MODEL,
            "MPS indisponível para este modelo, usando CPU como fallback...",
        )
        return whisper.load_model(model_path, device="cpu"), "cpu"


def main() -> None:
    parser = argparse.ArgumentParser(description="Transcrição de áudio com Whisper")
    parser.add_argument("--audio", required=True, help="Caminho do arquivo de áudio")
    parser.add_argument(
        "--model-dir", required=True, help="Diretório onde o modelo está salvo"
    )
    parser.add_argument(
        "--model-name",
        default="large-v3",
        help="Nome do arquivo do modelo sem extensão (padrão: large-v3)",
    )
    parser.add_argument("--language", default="pt", help="Idioma do áudio (padrão: pt)")
    parser.add_argument(
        "--context",
        default=None,
        help="Texto de contexto do documento para initial_prompt",
    )
    parser.add_argument(
        "--no-condition-on-previous",
        action="store_true",
        help="Desativa condition_on_previous_text (reduz loops de alucinação em áudios longos)",
    )
    args = parser.parse_args()

    try:
        # --- validações antecipadas, com mensagens claras ------------------
        if not os.path.isfile(args.audio):
            report_error(f"Arquivo de áudio não encontrado: {args.audio}")
            sys.exit(1)

        model_path = os.path.join(args.model_dir, f"{args.model_name}.pt")
        if not os.path.isfile(model_path):
            report_error(f"Modelo não encontrado: {model_path}")
            sys.exit(1)

        device, fp16 = detect_device()
        report_progress(PROGRESS_DEVICE, f"Dispositivo detectado: {device}")

        report_progress(PROGRESS_LOAD_MODEL, "Carregando modelo Whisper...")
        model, device = load_model_with_fallback(model_path, device)
        if device == "cpu":
            fp16 = False

        report_progress(PROGRESS_LOAD_AUDIO, "Carregando áudio...")
        audio = whisper.load_audio(args.audio)
        total_duration = len(audio) / SAMPLE_RATE
        if total_duration < 0.1:
            report_error("Áudio vazio ou corrompido (duração ~0s)")
            sys.exit(1)
        report_progress(
            PROGRESS_AUDIO_INFO, f"Áudio: {total_duration / 60:.1f} minutos"
        )

        # Whisper só aproveita o final do prompt; truncamos pelo fim
        initial_prompt = None
        if args.context:
            initial_prompt = args.context[-MAX_CONTEXT_CHARS:]

        capture = SegmentCapture(total_duration)
        with contextlib.redirect_stdout(capture):
            try:
                result = model.transcribe(
                    audio,
                    language=args.language,
                    initial_prompt=initial_prompt,
                    verbose=True,  # ativa saída segmento a segmento
                    fp16=fp16,
                    condition_on_previous_text=not args.no_condition_on_previous,
                )
            finally:
                capture.flush()

        report_progress(PROGRESS_FINALIZE, "Finalizando transcrição...")

        text = result.get("text", "").strip()
        if not text:
            report_progress(
                PROGRESS_FINALIZE, "⚠️ Transcrição vazia (áudio sem fala detectável?)"
            )

        # Campos extras são aditivos: consumidores antigos que só leem "text"
        # continuam funcionando.
        segments = [
            {
                "start": round(seg.get("start", 0.0), 3),
                "end": round(seg.get("end", 0.0), 3),
                "text": seg.get("text", "").strip(),
            }
            for seg in result.get("segments", [])
        ]
        print(
            json.dumps(
                {
                    "type": "result",
                    "text": text,
                    "language": result.get("language", args.language),
                    "duration": round(total_duration, 2),
                    "segments": segments,
                },
                ensure_ascii=False,
            )
        )
    except Exception as exc:
        report_error(
            f"Erro na transcrição com Whisper: {exc}",
            detail=traceback.format_exc(),
        )
        sys.exit(1)


if __name__ == "__main__":
    main()