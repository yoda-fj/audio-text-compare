import {
  CheckCircle2,
  Loader2,
  AlertCircle,
  Circle,
  RotateCcw,
  Search,
} from 'lucide-react'
import { ChunkRun } from '../types'

interface ChunkListPanelProps {
  chunks: ChunkRun[]
  onViewDetail?: (chunk: ChunkRun) => void
  onRetry?: (chunkIndex: number) => void
}

function formatMs(ms: number | null | undefined): string {
  if (ms == null) return '—'
  const totalSec = Math.round(ms / 1000)
  if (totalSec < 60) return `${totalSec}s`
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return s === 0 ? `${m}min` : `${m}min ${s}s`
}

/** Formata um intervalo em segundos (s) como timecode "m:ss" ou "h:mm:ss". */
function formatTimecodeS(s: number): string {
  const totalSec = Math.floor(s)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const sec = totalSec % 60
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  }
  return `${m}:${String(sec).padStart(2, '0')}`
}

function statusBadge(status: ChunkRun['status']): { label: string; className: string } {
  switch (status) {
    case 'done':
      return { label: 'Concluído', className: 'bg-green-100 text-green-700' }
    case 'transcribing':
      return { label: 'Em execução', className: 'bg-blue-100 text-blue-700' }
    case 'error':
      return { label: 'Erro', className: 'bg-red-100 text-red-700' }
    case 'pending':
    default:
      return { label: 'Pendente', className: 'bg-gray-100 text-gray-600' }
  }
}

export default function ChunkListPanel({
  chunks,
  onViewDetail,
  onRetry,
}: ChunkListPanelProps) {
  if (chunks.length === 0) return null

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">
          Chunks ({chunks.length})
        </h3>
        <p className="text-xs text-gray-500">
          Cada chunk leva ~10 min no MPS. Você pode reexecutar um chunk com erro sem reiniciar os outros.
        </p>
      </div>

      {/* Header da tabela (desktop) */}
      <div className="hidden md:grid md:grid-cols-[3rem_1fr_8rem_6rem_2fr_6rem] gap-3 px-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">
        <div>#</div>
        <div>Intervalo</div>
        <div>Status</div>
        <div>Duração</div>
        <div>Prévia</div>
        <div className="text-right">Ações</div>
      </div>

      <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg overflow-hidden">
        {chunks.map((chunk) => {
          const badge = statusBadge(chunk.status)
          const preview = (chunk.text || chunk.error_message || '').trim()
          const previewText = preview.length > 100 ? preview.slice(0, 100) + '…' : preview
          return (
            <div
              key={chunk.id}
              className="grid grid-cols-1 md:grid-cols-[3rem_1fr_8rem_6rem_2fr_6rem] gap-3 px-2 py-3 items-center hover:bg-gray-50"
            >
              {/* # */}
              <div className="flex items-center gap-2 text-sm font-mono text-gray-700">
                {chunk.status === 'done' && (
                  <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                )}
                {chunk.status === 'transcribing' && (
                  <Loader2 className="w-4 h-4 text-blue-600 animate-spin shrink-0" />
                )}
                {chunk.status === 'error' && (
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                )}
                {chunk.status === 'pending' && (
                  <Circle className="w-4 h-4 text-gray-400 shrink-0" />
                )}
                <span>{chunk.chunk_index + 1}</span>
              </div>

              {/* Intervalo */}
              <div className="text-sm text-gray-700 font-mono">
                {formatTimecodeS(chunk.chunk_start_s)} → {formatTimecodeS(chunk.chunk_end_s)}
              </div>

              {/* Status (badge) */}
              <div>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${badge.className}`}
                  title={chunk.error_message ?? undefined}
                >
                  {badge.label}
                </span>
              </div>

              {/* Duração */}
              <div className="text-xs text-gray-600 font-mono">
                {formatMs(chunk.duration_ms)}
              </div>

              {/* Prévia */}
              <div className="text-xs text-gray-600 truncate" title={preview}>
                {chunk.status === 'error' && chunk.error_message ? (
                  <span className="text-red-600">{previewText}</span>
                ) : chunk.text ? (
                  <span>{previewText}</span>
                ) : (
                  <span className="text-gray-400 italic">—</span>
                )}
              </div>

              {/* Ações */}
              <div className="flex items-center justify-end gap-1">
                {chunk.status === 'error' && onRetry && (
                  <button
                    onClick={() => onRetry(chunk.chunk_index)}
                    className="p-1.5 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded transition-colors"
                    title="Reexecutar este chunk"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={() => onViewDetail?.(chunk)}
                  className="p-1.5 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded transition-colors"
                  title="Ver detalhes do chunk"
                >
                  <Search className="w-4 h-4" />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
