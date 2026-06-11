"""Helpers compartilhados pelos scripts de transcrição com Whisper (Sub-etapa 3.2).

Centraliza:
- emissão de progresso (JSON em stderr) com campos extras opcionais
- leitura/escrita de checkpoint
- patch MPS para openai-whisper.timing.dtw
- kwargs fixos do Whisper para transcrição de áudio longo

Mantido deliberadamente sem dependências externas (apenas stdlib) para que
possa ser importado por `transcribe_chunk.py` e reutilizado em etapas
futuras sem custo adicional.
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any


def report_progress(
    progress: int,
    message: str,
    duration: float | None = None,
    event: str | None = None,
    **extra: Any,
) -> None:
    """Emite um evento de progresso em stderr como JSON de uma linha.

    Campos sempre presentes: type="progress", progress (int), message (str).
    Campos opcionais: duration (float), event (str) e quaisquer extras (ex:
    chunk_index, chunk_start_s, total_chunks).
    """
    payload: dict[str, Any] = {
        "type": "progress",
        "progress": int(progress),
        "message": str(message),
    }
    if duration is not None:
        payload["duration"] = float(duration)
    if event is not None:
        payload["event"] = str(event)
    for k, v in extra.items():
        # Não sobrescreve campos fixos
        if k in payload:
            continue
        payload[k] = v
    print(json.dumps(payload), file=sys.stderr, flush=True)


def report_error(message: str) -> None:
    """Emite um erro estruturado em stderr como JSON."""
    payload = {"type": "error", "message": str(message)}
    print(json.dumps(payload), file=sys.stderr, flush=True)


def load_checkpoint(checkpoint_path: str) -> dict:
    """Lê um checkpoint JSON. Retorna {} se inexistente/inválido."""
    if not checkpoint_path or not os.path.exists(checkpoint_path):
        return {}
    try:
        with open(checkpoint_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def save_checkpoint(checkpoint_path: str, data: dict) -> None:
    """Salva um checkpoint JSON. Falhas são reportadas mas não interrompem."""
    if not checkpoint_path:
        return
    try:
        with open(checkpoint_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as exc:  # noqa: BLE001
        report_error(f"Falha ao salvar checkpoint: {exc}")


def apply_mps_dtw_patch() -> None:
    """Aplica monkey-patch em `whisper.timing.dtw` para MPS.

    Bug do openai-whisper: `whisper.timing.dtw` chama `x.double()` em tensor
    MPS, mas MPS não suporta float64. Corrigido em PR upstream, mas ainda não
    lançado. Workaround: mover para CPU antes do .double() e usar a versão
    CPU do dtw.
    """
    try:
        from whisper import timing as _whisper_timing  # type: ignore

        _original_dtw = _whisper_timing.dtw

        def _dtw_mps_fix(x):  # noqa: ANN001
            if x.device.type == "mps":
                return _whisper_timing.dtw_cpu(x.cpu().double().numpy())
            return _original_dtw(x)

        _whisper_timing.dtw = _dtw_mps_fix
    except (ImportError, AttributeError) as exc:
        report_error(f"Falha ao aplicar patch MPS dtw: {exc}")
        raise


def build_transcribe_kwargs(
    language: str,
    initial_prompt: str | None,
    clip_timestamps: str,
) -> dict:
    """Retorna o dict fixo de kwargs para `whisper.model.transcribe`.

    Replica exatamente os parâmetros usados pelo script legado
    `transcribe_whisper.py` para evitar regressões em alucinações e qualidade.
    """
    return dict(
        language=language,
        verbose=False,
        fp16=False,
        # Greedy decoding: evita o fallback de temperatura que pode desestabilizar
        # áudios longos (até 1.0) e gerar alucinações
        temperature=0,
        # Desliga o condicionamento no texto anterior: principal causa do loop
        # "O perfeito" * N visto em áudios com seções de baixa confiança
        condition_on_previous_text=False,
        # Habilita word_timestamps para podermos usar hallucination_silence_threshold,
        # que filtra segmentos alucinados cercados de silêncio
        word_timestamps=True,
        hallucination_silence_threshold=0.5,
        # Mantém os defaults do Whisper para os demais filtros
        compression_ratio_threshold=2.4,
        logprob_threshold=-1.0,
        no_speech_threshold=0.6,
        initial_prompt=initial_prompt,
        clip_timestamps=clip_timestamps,
    )
