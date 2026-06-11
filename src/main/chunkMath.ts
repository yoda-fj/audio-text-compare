/**
 * Helpers puros para aritmética de chunks. Sem dependência de Electron ou
 * do DB — testáveis diretamente com Vitest.
 *
 * Esses números são a **fonte canônica** do clamp/default usado por:
 *   - main/index.ts (IPC setter `set-comparison-chunk-duration`)
 *   - main/index.ts (handler `transcribe-comparison` como fallback)
 *   - pythonClient.ts (cálculo do `--clip-end-s` para Whisper)
 *   - renderer (sincronização do valor clampado)
 *
 * Se você mudar MIN/MAX aqui, atualize os testes correspondentes.
 */

/** Limite inferior do `chunk_duration_s` configurável. */
export const MIN_CHUNK_DURATION_S = 5
/** Limite superior do `chunk_duration_s` configurável. */
export const MAX_CHUNK_DURATION_S = 120
/** Default aplicado quando o valor é null/undefined/0 (legado). */
export const DEFAULT_CHUNK_DURATION_S = 30

/**
 * Faz o clamp do `chunk_duration_s` configurado pelo usuário dentro da
 * faixa [MIN, MAX]. Valores fracionários são truncados para baixo
 * (`Math.floor`); valores inválidos (< MIN) sobem para o MIN.
 *
 * Idempotente: aplicar o clamp duas vezes produz o mesmo resultado.
 */
export function clampChunkDuration(seconds: number): number {
  if (!Number.isFinite(seconds)) return MIN_CHUNK_DURATION_S
  return Math.max(MIN_CHUNK_DURATION_S, Math.min(MAX_CHUNK_DURATION_S, Math.floor(seconds)))
}

/**
 * Calcula o `end_s` efetivo do pré-teste (Whisper) ou da janela de
 * transcrição (Gemma com `max_chunks`).
 *
 * - `maxChunks <= 0` → transcrição completa: retorna `audioDurationS`.
 * - caso contrário → `min(audioDurationS, maxChunks × chunkDurationS)`,
 *   com `chunkDurationS` caindo para `DEFAULT_CHUNK_DURATION_S` se for
 *   null/undefined/<= 0.
 */
export function computeClipEndS(
  audioDurationS: number,
  maxChunks: number,
  chunkDurationS: number | null | undefined
): number {
  if (maxChunks <= 0) return audioDurationS
  const dur = chunkDurationS && chunkDurationS > 0 ? chunkDurationS : DEFAULT_CHUNK_DURATION_S
  return Math.min(audioDurationS, maxChunks * dur)
}
