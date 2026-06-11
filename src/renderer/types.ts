export interface DiffItem {
  type: 'equal' | 'added' | 'removed' | 'changed'
  value?: string
  original?: string
  transcribed?: string
}

/**
 * Item de diff enriquecido com o índice do chunk de origem.
 * Usado no modo "Por Chunk" para agrupar palavras por trecho de áudio.
 */
export interface DiffItemWithChunk {
  type: 'equal' | 'added' | 'removed' | 'changed'
  value?: string
  original?: string
  transcribed?: string
  /** Índice do chunk (0-based) ao qual esta palavra pertence. */
  chunkIndex: number
}

/**
 * Segmento de transcrição do Whisper com timestamps.
 */
export interface WhisperSegment {
  start: number
  end: number
  text: string
}

export interface ComparisonResult {
  diff: DiffItem[]
  accuracy: number
  originalText: string
  transcribedText: string
}

/**
 * Status único de uma comparação em todo o sistema (DB ↔ IPC ↔ React).
 * O DB é a fonte de verdade; o `DEFAULT 'completed'` no schema cobre as
 * linhas legadas da v1. Renomear aqui exige `ALTER TABLE` e backfill.
 */
export type ComparisonStatus =
  | 'pending'
  | 'transcribing'
  | 'completed'
  | 'error'
  | 'cancelled'

/** Status de um chunk individual dentro de uma comparação. */
export type ChunkStatus = 'pending' | 'transcribing' | 'done' | 'error'

/** Etapas do wizard. */
export type ComparisonStep = 1 | 2 | 3

/**
 * Registro completo de uma comparação. Espelha `ComparisonRecord` em
 * `main/database.ts`. Os campos legados (original_text, diff_result etc.)
 * são preenchidos quando a comparação vira `completed`; ficam `null` durante
 * o fluxo de "nova comparação" criado via `NewComparisonModal`.
 */
export interface ComparisonRecord {
  id?: number
  created_at: string
  updated_at: string
  name: string
  status: ComparisonStatus
  document_path: string | null
  audio_path: string | null
  document_name: string | null
  audio_name: string | null
  original_text: string | null
  transcribed_text: string | null
  diff_result: string | null
  accuracy_score: number | null
  model_used: string | null
  error_message: string | null
  /**
   * Duração configurada de cada chunk em segundos. Usada tanto pelo Gemma
   * (tamanho real do chunk) quanto pelo Whisper (janela do pré-teste).
   * NULL para comparações legadas; o renderer aplica `?? 30` como default.
   */
  chunk_duration_s: number | null
}

/** Um chunk de áudio persistido durante a transcrição. */
export interface ChunkRun {
  id?: number
  comparison_id: number
  chunk_index: number
  total_chunks: number
  /** Início do chunk em segundos. */
  chunk_start_s: number
  /** Fim do chunk em segundos. */
  chunk_end_s: number
  status: ChunkStatus
  text: string | null
  error_message: string | null
  /** Duração do processamento em ms (quando `status === 'done'`). */
  duration_ms: number | null
  created_at: string
  updated_at: string
}

export interface TranscriptionResult {
  text: string
  error?: string
}

export interface DocumentResult {
  text: string
  error?: string
}

export interface ReadDocumentOptions {
  pageStart?: number
  pageEnd?: number
}

export type DiffType = 'equal' | 'added' | 'removed' | 'changed'

/**
 * Eventos estruturados emitidos pelo script Python via stderr (1 JSON por
 * linha). Substitui o antigo par `(progress, message)` com um único
 * callback tipado.
 */
export type PythonEvent =
  | {
      type: 'progress'
      progress: number
      message: string
      event?: string
      chunk_index?: number
      chunk_start_s?: number
      chunk_end_s?: number
      total_chunks?: number
      duration?: number
    }
  | {
      type: 'chunk_start'
      chunk_index: number
      chunk_start_s: number
      chunk_end_s: number
      total_chunks: number
      progress: number
      message: string
    }
  | {
      type: 'chunk_done'
      chunk_index: number
      text: string
      duration_ms: number
      progress: number
      message: string
    }
  | {
      type: 'chunk_error'
      chunk_index: number
      error_message: string
      progress: number
      message: string
    }
  | {
      type: 'error'
      message: string
    }
