import { useState, useEffect } from 'react'
import { RotateCcw } from 'lucide-react'
import { ComparisonResult, ChunkRun } from '../../types'
import ComparisonView from '../ComparisonView'
import ChunkListPanel from '../ChunkListPanel'

interface ResultStepProps {
  comparison: ComparisonResult | null
  comparisonId?: number
  chunks: ChunkRun[]
  onViewChunkDetail: (chunk: ChunkRun) => void
  onRetryChunk: (chunkIndex: number) => void
  onNewComparison: () => void
}

const getAccuracyColor = (accuracy: number) => {
  if (accuracy >= 90) return 'text-green-600'
  if (accuracy >= 70) return 'text-yellow-600'
  return 'text-red-600'
}

const getAccuracyBg = (accuracy: number) => {
  if (accuracy >= 90) return 'bg-green-50 border-green-200'
  if (accuracy >= 70) return 'bg-yellow-50 border-yellow-200'
  return 'bg-red-50 border-red-200'
}

const getAccuracyLabel = (accuracy: number) => {
  if (accuracy >= 90) return 'Excelente'
  if (accuracy >= 70) return 'Bom'
  return 'Precisa de atenção'
}

export default function ResultStep({
  comparison,
  comparisonId,
  chunks,
  onViewChunkDetail,
  onRetryChunk,
  onNewComparison,
}: ResultStepProps) {
  const [audioAvailable, setAudioAvailable] = useState(false)

  useEffect(() => {
    if (!comparisonId) return

    // Verifica disponibilidade do áudio
    window.electronAPI
      .getComparisonAudioInfo(comparisonId)
      .then((info) => setAudioAvailable(info.available))
      .catch(() => setAudioAvailable(false))
  }, [comparisonId])

  if (!comparison) {
    return (
      <div className="card p-8 text-center text-gray-500 animate-fade-in">
        Nenhum resultado disponível. Realize a comparação primeiro.
      </div>
    )
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <div
        className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border ${getAccuracyBg(comparison.accuracy)}`}
      >
        <div className="flex flex-wrap items-center gap-4">
          <div className="text-2xl font-bold">
            Precisão:{' '}
            <span className={getAccuracyColor(comparison.accuracy)}>
              {comparison.accuracy}%
            </span>
          </div>
          <span
            className={`px-2 py-1 rounded-md text-sm font-medium border ${getAccuracyBg(comparison.accuracy)} ${getAccuracyColor(comparison.accuracy)}`}
          >
            {getAccuracyLabel(comparison.accuracy)}
          </span>
          <div className="text-sm text-gray-500">
            {comparison.diff.filter((d) => d.type === 'equal').length} de{' '}
            {comparison.diff.length} segmentos corretos
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onNewComparison}
            className="btn-secondary flex items-center gap-2"
          >
            <RotateCcw className="w-4 h-4" />
            Nova comparação
          </button>
        </div>
      </div>

      {/* Painel de chunks: presente quando a transcrição foi persistida por
          chunks (Gemma ou Whisper via o chunk sintético). Comparações
          legadas (v1) não têm chunks — aí só mostramos o diff. */}
      {chunks.length > 0 && (
        <ChunkListPanel
          chunks={chunks}
          onViewDetail={onViewChunkDetail}
          onRetry={onRetryChunk}
        />
      )}

      <ComparisonView
        diff={comparison.diff}
        comparisonId={comparisonId}
        audioAvailable={audioAvailable}
      />
    </div>
  )
}
