#!/usr/bin/env python3
"""Transcrição de UM ÚNICO CHUNK de áudio usando Whisper Large v3.

Diferente do script legado `transcribe_whisper.py` (que processa o áudio
inteiro em um loop interno), este script é single-shot: processa apenas o
intervalo [--chunk-start-ms, --chunk-end-ms] e imprime o resultado no stdout
como JSON, deixando o loop e o controle de estado para o lado Node.js (que
persiste cada chunk na tabela `chunk_runs` do SQLite).

Comunicação:
  - stderr: progresso (JSON por linha) — `report_progress(...)` de _whisper_common
  - stdout: linha final com `{"type": "chunk_done", "chunk_index": N, "text": "..."}`

Checkpoint: ao terminar com sucesso, atualiza --checkpoint-file mesclando o
texto deste chunk aos previamente salvos (idempotente em re-execuções).
"""

from __future__ import annotations

import argparse
import json
import sys
import traceback

from _whisper_common import (
    apply_mps_dtw_patch,
    build_transcribe_kwargs,
    load_checkpoint,
    report_error,
    report_progress,
    save_checkpoint,
)


def detect_device() -> str:
    """Detecta o melhor device disponível (CUDA > MPS > CPU)."""
    import torch  # import lazy para falhar rápido só se necessário

    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Transcrição de um único chunk de áudio com Whisper",
    )
    parser.add_argument("--audio", required=True, help="Caminho do arquivo de áudio")
    parser.add_argument("--chunk-index", required=True, type=int, help="Índice (0-based) do chunk")
    parser.add_argument("--chunk-start-ms", required=True, type=int, help="Início do chunk em ms")
    parser.add_argument("--chunk-end-ms", required=True, type=int, help="Fim do chunk em ms")
    parser.add_argument("--model-dir", required=True, help="Diretório do modelo Whisper")
    parser.add_argument("--language", default="pt", help="Idioma do áudio (padrão: pt)")
    parser.add_argument("--context", default=None, help="Texto de contexto do documento para initial_prompt")
    parser.add_argument("--checkpoint-file", default=None, help="Arquivo JSON de checkpoint")
    parser.add_argument(
        "--total-chunks",
        type=int,
        default=0,
        help="Total de chunks do áudio (apenas para mensagens de progresso)",
    )
    args = parser.parse_args()

    chunk_index = int(args.chunk_index)
    chunk_start_ms = int(args.chunk_start_ms)
    chunk_end_ms = int(args.chunk_end_ms)
    start_s = chunk_start_ms / 1000.0
    end_s = chunk_end_ms / 1000.0
    total_chunks = int(args.total_chunks) or 0

    try:
        import torch  # noqa: F401  (garantir torch carregado antes do patch)
        import whisper
    except ImportError as exc:
        report_error(f"Biblioteca openai-whisper não instalada: {exc}")
        sys.exit(1)

    try:
        apply_mps_dtw_patch()
    except Exception:
        # report_error já chamado pelo helper
        sys.exit(1)

    try:
        device = detect_device()
        report_progress(5, f"Dispositivo: {device}")

        model_path = f"{args.model_dir.rstrip('/')}/large-v3.pt"
        report_progress(10, "Carregando modelo Whisper...")
        model = whisper.load_model(model_path, device=device)

        # Reporta início do chunk (formato consumido por TranscriptionModal/ChunkListPanel)
        total_label = total_chunks if total_chunks > 0 else "?"
        report_progress(
            20,
            f"Chunk {chunk_index + 1}/{total_label} — {start_s:.0f}s → {end_s:.0f}s",
            event="chunk_start",
            chunk_index=chunk_index,
            chunk_start_s=start_s,
            chunk_end_s=end_s,
            total_chunks=total_chunks,
        )

        # Carrega checkpoint existente para preservar chunks anteriores
        checkpoint = load_checkpoint(args.checkpoint_file)
        if checkpoint and checkpoint.get("audio") not in (None, args.audio):
            checkpoint = {}

        # Mantém o initial_prompt dentro do limite de 2000 chars do Whisper
        initial_prompt = args.context if args.context else None

        transcribe_kwargs = build_transcribe_kwargs(
            language=args.language,
            initial_prompt=initial_prompt,
            clip_timestamps=f"{start_s},{end_s}",
        )

        result = model.transcribe(args.audio, **transcribe_kwargs)
        text = (result.get("text") or "").strip()

        # Atualiza checkpoint: remove entrada anterior com mesmo start (idempotência),
        # e adiciona a nova.
        completed_chunks = [
            c for c in checkpoint.get("completed_chunks", []) if abs(c.get("start", -1) - start_s) >= 0.5
        ]
        completed_chunks.append(
            {"index": chunk_index, "start": start_s, "end": end_s, "text": text}
        )
        # Mantém o checkpoint pequeno e ordenável
        completed_chunks.sort(key=lambda c: c.get("start", 0))

        save_checkpoint(
            args.checkpoint_file,
            {
                "audio": args.audio,
                "model": "whisper-large-v3",
                "total_chunks": total_chunks,
                "completed_chunks": completed_chunks,
            },
        )

        # Linha final no stdout — Node faz parse dessa linha para resolver a Promise.
        print(
            json.dumps(
                {"type": "chunk_done", "chunk_index": chunk_index, "text": text},
                ensure_ascii=False,
            ),
            flush=True,
        )
    except Exception as exc:
        report_error(f"Erro no chunk {chunk_index + 1}: {exc}")
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
