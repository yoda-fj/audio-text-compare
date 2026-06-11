#!/usr/bin/env python3
"""Retorna a duração de um arquivo de áudio em segundos.

Não carrega o modelo Whisper inteiro — só lê o suficiente para descobrir
a duração. Usa `wave` (stdlib) para arquivos WAV puros e cai para
`whisper.load_audio` nos demais formatos (MP3, OGG, M4A, FLAC, etc).

Uso: python get_audio_duration.py --audio <path>
Saída (stdout): {"type": "result", "duration": 123.45}
"""

import argparse
import json
import os
import sys


def main() -> None:
    p = argparse.ArgumentParser(description="Retorna a duração de um áudio em segundos")
    p.add_argument("--audio", required=True, help="Caminho do arquivo de áudio")
    args = p.parse_args()

    if not os.path.isfile(args.audio):
        print(json.dumps({"type": "error", "message": f"Arquivo não encontrado: {args.audio}"}),
              file=sys.stderr, flush=True)
        sys.exit(1)

    duration = None

    # Fast path: arquivos WAV puros (sem compressão). Usa wave do stdlib.
    ext = os.path.splitext(args.audio)[1].lower()
    if ext == ".wav":
        try:
            import wave
            with wave.open(args.audio, "rb") as wf:
                frames = wf.getnframes()
                rate = wf.getframerate()
                if rate > 0:
                    duration = frames / float(rate)
        except Exception:
            pass

    # Para outros formatos, usa whisper.load_audio (mais lento, mas confiável).
    if duration is None:
        try:
            import whisper
            audio = whisper.load_audio(args.audio)
            # whisper.load_audio retorna np.ndarray a 16kHz mono
            duration = len(audio) / 16000.0
        except ImportError:
            print(json.dumps({"type": "error", "message": "whisper não disponível"}),
                  file=sys.stderr, flush=True)
            sys.exit(1)
        except Exception as e:
            print(json.dumps({"type": "error", "message": f"Falha ao ler áudio: {e}"}),
                  file=sys.stderr, flush=True)
            sys.exit(1)

    if duration is None or duration <= 0:
        print(json.dumps({"type": "error", "message": "Não foi possível determinar a duração"}),
              file=sys.stderr, flush=True)
        sys.exit(1)

    print(json.dumps({"type": "result", "duration": float(duration)}), flush=True)


if __name__ == "__main__":
    main()
