import { useEffect } from 'react'
import { Search, X, RotateCcw, AlertCircle } from 'lucide-react'
import { ChunkRun, ChunkStatus } from '../types'

interface ChunkDetailModalProps {
  chunk: ChunkRun | null
  totalChunks: number
  isOpen: boolean
  onClose: () => void
  onRetry?: (chunkIndex: number) => void
}

/** Formata um intervalo em segundos (s) como timecode "m:ss" ou "h:mm:ss". */
const formatTimeS = (s: number): string => {
  const totalSec = Math.floor(s)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const sec = totalSec % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${m}:${String(sec).padStart(2, '0')}`
}

const formatDuration = (ms: number | null | undefined): string => {
  if (!ms || ms <= 0) return '—'
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  if (m > 0) return s > 0 ? `${m}min ${s}s` : `${m}min`
  return `${s}s`
}

const STATUS_LABELS: Record<ChunkStatus, { label: string; color: string }> = {
  pending: { label: 'Pendente', color: 'bg-gray-100 text-gray-700 border-gray-300' },
  transcribing: { label: 'Em andamento', color: 'bg-blue-100 text-blue-700 border-blue-300' },
  done: { label: 'Concluído', color: 'bg-green-100 text-green-700 border-green-300' },
  error: { label: 'Erro', color: 'bg-red-100 text-red-700 border-red-300' },
}

export default function ChunkDetailModal({
  chunk,
  totalChunks,
  isOpen,
  onClose,
  onRetry,
}: ChunkDetailModalProps) {
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  if (!isOpen || !chunk) return null

  const statusInfo = STATUS_LABELS[chunk.status]
  const chunkDuration = chunk.chunk_end_s - chunk.chunk_start_s

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-fade-in p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl max-w-2xl w-full p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center shrink-0">
            <Search className="w-5 h-5 text-primary-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl font-bold text-gray-900">
                Chunk {chunk.chunk_index + 1}/{totalChunks}
              </h2>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${statusInfo.color}`}>
                {statusInfo.label}
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-0.5">
              {formatTimeS(chunk.chunk_start_s)} → {formatTimeS(chunk.chunk_end_s)}
              {' · '}
              duração: {formatDuration(chunkDuration * 1000)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 shrink-0"
            title="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Stats row */}
        <div className="flex flex-wrap gap-4 text-xs text-gray-600 bg-gray-50 rounded-lg p-3">
          <div>
            Início: <strong className="text-gray-800">{formatTimeS(chunk.chunk_start_s)}</strong>
          </div>
          <div>
            Fim: <strong className="text-gray-800">{formatTimeS(chunk.chunk_end_s)}</strong>
          </div>
          <div>
            Processado em: <strong className="text-gray-800">{formatDuration(chunk.duration_ms)}</strong>
          </div>
        </div>

        {/* Texto transcrito */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Texto transcrito
          </label>
          {chunk.text ? (
            <textarea
              readOnly
              value={chunk.text}
              className="w-full h-64 px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          ) : (
            <div className="w-full h-64 px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-sm text-gray-500 italic flex items-center justify-center">
              {chunk.status === 'pending' && 'Chunk ainda não processado.'}
              {chunk.status === 'transcribing' && 'Processando...'}
              {chunk.status === 'error' && 'Sem texto — veja o erro abaixo.'}
              {chunk.status === 'done' && '(texto vazio)'}
            </div>
          )}
        </div>

        {/* Mensagem de erro */}
        {chunk.error_message && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-red-800">Erro</p>
              <p className="text-sm text-red-700 mt-1 break-words whitespace-pre-wrap">
                {chunk.error_message}
              </p>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-end gap-2 pt-2">
          {chunk.status === 'error' && onRetry && (
            <button
              onClick={() => onRetry(chunk.chunk_index)}
              className="btn-primary flex items-center gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              Reexecutar
            </button>
          )}
          <button onClick={onClose} className="btn-secondary">
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}
