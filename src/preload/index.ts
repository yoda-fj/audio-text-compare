import { contextBridge, ipcRenderer } from 'electron'
import type {
  ChunkRun,
  ComparisonRecord,
  DiffItemWithChunk,
  PythonEvent,
  ReadDocumentOptions,
  WhisperSegment,
} from '../renderer/types'

export interface IElectronAPI {
  // -------------------------------------------------------------------
  // Arquivos
  // -------------------------------------------------------------------
  selectFile: (options: { filters: { name: string; extensions: string[] }[] }) => Promise<string | null>
  readDocument: (filePath: string, options?: ReadDocumentOptions) => Promise<{ text: string; error?: string }>

  // -------------------------------------------------------------------
  // Comparação legada (v1) — mantido para HistoryPanel
  // -------------------------------------------------------------------
  compareTexts: (original: string, transcribed: string) => Promise<any[]>
  saveComparison: (data: any) => Promise<number>
  getComparisons: () => Promise<ComparisonRecord[]>
  getComparison: (id: number) => Promise<ComparisonRecord | undefined>
  deleteComparison: (id: number) => Promise<void>

  // -------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------
  saveSetting: (key: string, value: string) => Promise<void>
  getSetting: (key: string) => Promise<string | null>

  // -------------------------------------------------------------------
  // Python / ambiente
  // -------------------------------------------------------------------
  checkPythonStatus: () => Promise<{ ready: boolean; python?: string; message: string }>
  /**
   * Retorna se o modelo Whisper Large v3 já está baixado localmente.
   */
  getWhisperModelStatus: () => Promise<{ downloaded: boolean }>
  /**
   * Inicia o download do modelo Whisper Large v3.
   */
  downloadWhisperModel: () => Promise<{ downloaded: boolean }>
  /**
   * Lê a duração (em segundos) de um arquivo de áudio. Retorna `null` em
   * caso de falha. Usado para exibir a estimativa de chunks no UI.
   */
  getAudioDuration: (audioPath: string) => Promise<number | null>

  // -------------------------------------------------------------------
  // Fluxo "comparação como projeto" (v2)
  // -------------------------------------------------------------------
  createComparison: (name: string) => Promise<ComparisonRecord>
  getActiveComparisons: () => Promise<ComparisonRecord[]>
  setComparisonDocument: (
    id: number,
    documentPath: string,
    documentName: string,
    documentText: string
  ) => Promise<ComparisonRecord | undefined>
  setComparisonAudio: (
    id: number,
    audioPath: string,
    audioName: string
  ) => Promise<ComparisonRecord | undefined>
  /**
   * Persiste a duração configurada de cada chunk (em segundos). O main
   * process aplica o clamp canônico [5, 120]s antes de gravar.
   */
  setComparisonChunkDuration: (id: number, seconds: number) => Promise<ComparisonRecord | undefined>
  getComparisonChunks: (id: number) => Promise<ChunkRun[]>
  markComparisonError: (id: number, errorMessage: string) => Promise<ComparisonRecord | undefined>
  cancelComparison: (id: number) => Promise<ComparisonRecord | undefined>
  transcribeComparison: (
    id: number,
    model: string,
    context?: string,
    maxChunks?: number,
    chunkDurationS?: number
  ) => Promise<{ success: boolean; partial?: boolean; error?: string }>

  // -------------------------------------------------------------------
  // Diff com chunks (v4)
  // -------------------------------------------------------------------
  getComparisonDiffChunks: (id: number) => Promise<DiffItemWithChunk[] | null>
  getComparisonAudioInfo: (id: number) => Promise<{ available: boolean; reason?: string }>

  // -------------------------------------------------------------------
  // Whisper segments (v5)
  // -------------------------------------------------------------------
  getComparisonWhisperSegments: (id: number) => Promise<WhisperSegment[] | null>

  // -------------------------------------------------------------------
  // Streams de eventos
  // -------------------------------------------------------------------
  /** Subscribe a `python-event` filtrado por `comparisonId`. */
  onPythonEvent: (callback: (comparisonId: number, event: PythonEvent) => void) => () => void
  /** Subscribe a `transcription-progress` (formato legado). */
  onTranscriptionProgress: (
    callback: (comparisonId: number, progress: number, message: string) => void
  ) => () => void
  /** Subscribe a progresso do download do Whisper. */
  onWhisperDownloadProgress: (
    callback: (progress: number, message: string) => void
  ) => () => void
}

const api: IElectronAPI = {
  // Arquivos
  selectFile: (options) => ipcRenderer.invoke('select-file', options),
  readDocument: (filePath, options) => ipcRenderer.invoke('read-document', filePath, options),

  // Comparação legada
  compareTexts: (original, transcribed) => ipcRenderer.invoke('compare-texts', original, transcribed),
  saveComparison: (data) => ipcRenderer.invoke('save-comparison', data),
  getComparisons: () => ipcRenderer.invoke('get-comparisons'),
  getComparison: (id) => ipcRenderer.invoke('get-comparison', id),
  deleteComparison: (id) => ipcRenderer.invoke('delete-comparison', id),

  // Settings
  saveSetting: (key, value) => ipcRenderer.invoke('save-setting', key, value),
  getSetting: (key) => ipcRenderer.invoke('get-setting', key),

  // Python
  checkPythonStatus: () => ipcRenderer.invoke('check-python-status'),
  getWhisperModelStatus: () => ipcRenderer.invoke('get-whisper-model-status'),
  downloadWhisperModel: () => ipcRenderer.invoke('download-whisper-model'),
  getAudioDuration: (audioPath) => ipcRenderer.invoke('get-audio-duration', audioPath),

  // Fluxo v2
  createComparison: (name) => ipcRenderer.invoke('create-comparison', name),
  getActiveComparisons: () => ipcRenderer.invoke('get-active-comparisons'),
  setComparisonDocument: (id, documentPath, documentName, documentText) =>
    ipcRenderer.invoke('set-comparison-document', id, documentPath, documentName, documentText),
  setComparisonAudio: (id, audioPath, audioName) =>
    ipcRenderer.invoke('set-comparison-audio', id, audioPath, audioName),
  setComparisonChunkDuration: (id, seconds) =>
    ipcRenderer.invoke('set-comparison-chunk-duration', id, seconds),
  getComparisonChunks: (id) => ipcRenderer.invoke('get-comparison-chunks', id),
  markComparisonError: (id, errorMessage) => ipcRenderer.invoke('mark-comparison-error', id, errorMessage),
  cancelComparison: (id) => ipcRenderer.invoke('cancel-comparison', id),
  transcribeComparison: (id, model, context, maxChunks, chunkDurationS) =>
    ipcRenderer.invoke('transcribe-comparison', id, model, context, maxChunks, chunkDurationS),

  // Diff com chunks (v4)
  getComparisonDiffChunks: (id) => ipcRenderer.invoke('get-comparison-diff-chunks', id),
  getComparisonAudioInfo: (id) => ipcRenderer.invoke('get-comparison-audio-info', id),

  // Whisper segments (v5)
  getComparisonWhisperSegments: (id) => ipcRenderer.invoke('get-comparison-whisper-segments', id),

  // Streams
  onPythonEvent: (callback) => {
    const handler = (_: unknown, comparisonId: number, event: PythonEvent) =>
      callback(comparisonId, event)
    ipcRenderer.on('python-event', handler)
    return () => ipcRenderer.removeListener('python-event', handler)
  },
  onTranscriptionProgress: (callback) => {
    const handler = (_: unknown, comparisonId: number, progress: number, message: string) =>
      callback(comparisonId, progress, message)
    ipcRenderer.on('transcription-progress', handler)
    return () => ipcRenderer.removeListener('transcription-progress', handler)
  },
  onWhisperDownloadProgress: (callback) => {
    const handler = (_: unknown, progress: number, message: string) =>
      callback(progress, message)
    ipcRenderer.on('whisper-download-progress', handler)
    return () => ipcRenderer.removeListener('whisper-download-progress', handler)
  },
}

contextBridge.exposeInMainWorld('electronAPI', api)

declare global {
  interface Window {
    electronAPI: IElectronAPI
  }
}
