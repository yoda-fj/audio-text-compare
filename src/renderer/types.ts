export interface DiffItem {
  type: 'equal' | 'added' | 'removed' | 'changed'
  value?: string
  original?: string
  transcribed?: string
}

export interface ComparisonResult {
  diff: DiffItem[]
  accuracy: number
  originalText: string
  transcribedText: string
}

export interface ComparisonRecord {
  id: number
  created_at: string
  document_name: string
  audio_name: string
  original_text: string
  transcribed_text: string
  diff_result: string
  accuracy_score: number
  model_used: string
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
