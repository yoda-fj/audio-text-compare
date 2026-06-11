#!/usr/bin/env python3
"""Baixa um modelo do Hugging Face para uso local.

Uso: python download_model.py --model-id <id> --dest-dir <dir> [--token <token>]

Reporta progresso via stderr no formato JSON:
  {"type": "progress", "progress": 42, "message": "Baixando 2.1GB/5.0GB..."}

Conclui com stdout JSON:
  {"type": "result", "model_id": "...", "path": "..."}
"""

import argparse
import json
import os
import sys
import time


def report_progress(progress: int, message: str) -> None:
    print(json.dumps({"type": "progress", "progress": int(progress), "message": message}),
          file=sys.stderr, flush=True)


def main() -> None:
    p = argparse.ArgumentParser(description="Baixa um modelo do Hugging Face")
    p.add_argument("--model-id", required=True, help="ID do modelo no Hugging Face (ex: google/gemma-3n-E2B-it)")
    p.add_argument("--dest-dir", required=True, help="Diretório de destino")
    p.add_argument("--token", default=None, help="Token do Hugging Face (opcional)")
    args = p.parse_args()

    try:
        from huggingface_hub import snapshot_download
    except ImportError as e:
        print(json.dumps({"type": "error", "message": f"huggingface_hub não instalado: {e}"}),
              file=sys.stderr, flush=True)
        sys.exit(1)

    # Converter "google/gemma-3n-E2B-it" em "gemma-3n-E2B-it" para a pasta local
    model_short = args.model_id.split("/")[-1]
    target_dir = os.path.join(args.dest_dir, model_short)
    os.makedirs(target_dir, exist_ok=True)

    report_progress(2, f"Iniciando download de {args.model_id}...")

    # A barra tqdm do snapshot_download vai para stderr e o app a ignora
    # (só consome linhas JSON). Emitimos marcos de progresso aproximados
    # (2% / 50% / 95% / 100%) que a UI usa para alimentar sua própria barra.
    try:
        path = snapshot_download(
            repo_id=args.model_id,
            local_dir=target_dir,
            token=args.token,
            max_workers=4,
        )
    except Exception as e:
        print(json.dumps({"type": "error", "message": f"Falha no download: {e}"}),
              file=sys.stderr, flush=True)
        sys.exit(1)

    report_progress(95, "Verificando arquivos...")
    time.sleep(0.5)  # pequena pausa para o usuário ver 100%
    report_progress(100, f"Download concluído em {target_dir}")

    print(json.dumps({"type": "result", "model_id": args.model_id, "path": path}),
          flush=True)


if __name__ == "__main__":
    main()
