import React from 'react'
import { DiffItemWithChunk, ChunkRun } from '../types'
import AudioPlayer from './AudioPlayer'

interface ChunkComparisonViewProps {
  /** Diff enriquecido com chunkIndex */
  diffItems: DiffItemWithChunk[]
  /** Lista de chunks com seus tempos */
  chunks: ChunkRun[]
  /** ID da comparação para o protocolo app-audio:// */
  comparisonId: number
  /** Índice do chunk atualmente em reprodução (para highlight) */
  playingChunkIndex?: number | null
  /** Callback quando o usuário inicia a reprodução de um chunk */
  onPlayChunk?: (chunkIndex: number) => void
}

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/**
 * Agrupa itens do diff por chunkIndex e renderiza um card por chunk,
 * com player de áudio no cabeçalho.
 */
const ChunkComparisonView: React.FC<ChunkComparisonViewProps> = ({
  diffItems,
  chunks,
  comparisonId,
  playingChunkIndex,
  onPlayChunk,
}) => {
  // Agrupa por chunkIndex
  const grouped = React.useMemo(() => {
    const map = new Map<number, DiffItemWithChunk[]>()
    for (const item of diffItems) {
      const list = map.get(item.chunkIndex) || []
      list.push(item)
      map.set(item.chunkIndex, list)
    }
    return map
  }, [diffItems])

  if (!diffItems.length) {
    return (
      <div className="card p-8 text-center text-gray-500">
        Nenhum diff com chunks disponível para esta comparação.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {chunks.map((chunk) => {
        const items = grouped.get(chunk.chunk_index) || []
        const isPlaying = playingChunkIndex === chunk.chunk_index

        return (
          <div
            key={chunk.chunk_index}
            className={`card transition-all ${
              isPlaying ? 'ring-2 ring-primary-400 shadow-lg' : ''
            }`}
          >
            {/* Header do chunk */}
            <div className="flex items-center gap-3 mb-3 pb-3 border-b border-gray-200">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-700">
                    Chunk {chunk.chunk_index + 1}
                  </span>
                  <span className="text-xs text-gray-500">
                    {formatTime(chunk.chunk_start_s)} – {formatTime(chunk.chunk_end_s)}
                  </span>
                </div>
              </div>
              <div className="w-48">
                <AudioPlayer
                  src={`app-audio://${comparisonId}`}
                  startS={chunk.chunk_start_s}
                  endS={chunk.chunk_end_s}
                  onPlayStateChange={(playing) => {
                    if (playing) onPlayChunk?.(chunk.chunk_index)
                  }}
                  onEnded={() => {
                    onPlayChunk?.(null as unknown as number)
                  }}
                />
              </div>
            </div>

            {/* Body: palavras do diff */}
            <div className="leading-relaxed text-sm">
              {items.length === 0 ? (
                <span className="text-gray-400 italic">— sem fala detectada —</span>
              ) : (
                items.map((item, idx) => {
                  switch (item.type) {
                    case 'equal':
                      return (
                        <span key={idx} className="diff-equal">
                          {item.value}{' '}
                        </span>
                      )
                    case 'added':
                      return (
                        <span key={idx} className="diff-added">
                          {item.value}{' '}
                        </span>
                      )
                    case 'removed':
                      return (
                        <span key={idx} className="diff-removed">
                          {item.value}{' '}
                        </span>
                      )
                    case 'changed':
                      return (
                        <span key={idx} className="relative group inline">
                          <span className="diff-changed">{item.transcribed}</span>
                          <span className="absolute -top-9 left-0 bg-yellow-600 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 shadow-lg">
                            Original: "{item.original}"
                          </span>
                          {' '}
                        </span>
                      )
                    default:
                      return null
                  }
                })
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default ChunkComparisonView
