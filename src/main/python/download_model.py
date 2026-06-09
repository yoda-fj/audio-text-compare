#!/usr/bin/env python3
"""Download Gemma 4 model weights from Hugging Face with progress reporting."""

import argparse
import json
import os
import sys
import threading
import time

try:
    from huggingface_hub import snapshot_download
except ImportError as e:
    print(json.dumps({"type": "error", "message": f"huggingface_hub not installed: {e}"}), file=sys.stderr, flush=True)
    sys.exit(1)


def log_progress(progress: int, message: str) -> None:
    print(json.dumps({"type": "progress", "progress": progress, "message": message}), file=sys.stderr, flush=True)


def log_error(message: str) -> None:
    print(json.dumps({"type": "error", "message": message}), file=sys.stderr, flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Baixa pesos do modelo Gemma 4")
    parser.add_argument("--model", required=True, help="ID do modelo no Hugging Face")
    parser.add_argument("--hf-token-stdin", action="store_true", help="Ler HF Token do stdin")
    parser.add_argument("--hf-token", default="", help="HF Token (legado)")
    parser.add_argument("--cache-dir", default="", help="Diretório de cache do Hugging Face (para modelos embutidos no pacote)")
    args = parser.parse_args()

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
        log_error("Hugging Face Token é obrigatório.")
        sys.exit(1)

    log_progress(0, "Iniciando download...")

    # snapshot_download may not expose fine-grained progress in all versions,
    # so we emit time-based milestones to keep the UI responsive.
    milestones = [10, 25, 50, 75, 90]
    stop_event = {"stop": False}

    def reporter() -> None:
        idx = 0
        while not stop_event["stop"]:
            time.sleep(5)
            if stop_event["stop"]:
                break
            if idx < len(milestones):
                log_progress(milestones[idx], f"Baixando modelo... ({milestones[idx]}%)")
                idx += 1

    reporter_thread = threading.Thread(target=reporter, daemon=True)

    try:
        reporter_thread.start()
        download_kwargs: dict = {
            "repo_id": args.model,
            "token": hf_token,
            "resume_download": True,
            "repo_type": "model",
        }
        if args.cache_dir:
            download_kwargs["cache_dir"] = args.cache_dir
        snapshot_download(**download_kwargs)
    except Exception as e:
        stop_event["stop"] = True
        log_error(f"Falha no download: {e}")
        sys.exit(1)
    finally:
        stop_event["stop"] = True

    log_progress(100, "Download concluído.")
    print(json.dumps({"type": "result", "status": "downloaded"}), flush=True)


if __name__ == "__main__":
    main()
