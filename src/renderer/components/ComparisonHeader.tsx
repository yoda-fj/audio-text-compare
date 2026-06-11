import { CheckCircle, CircleDashed, FileText, Activity, AlertCircle, X } from 'lucide-react'
import { ComparisonStatus, ComparisonStep } from '../types'

interface ComparisonHeaderProps {
  name: string
  status: ComparisonStatus
  currentStep: ComparisonStep
  lastChunkIndex?: number | null
  errorMessage?: string | null
}

const STEP_LABELS: Record<ComparisonStep, string> = {
  1: 'Documento',
  2: 'Áudio e transcrição',
  3: 'Resultado',
}

const STEP_DESCRIPTIONS: Record<ComparisonStep, string> = {
  1: 'Selecione o documento original e o intervalo de páginas.',
  2: 'Selecione o áudio, escolha o modelo e transcreva.',
  3: 'Veja o diff e a precisão da transcrição.',
}

const STATUS_STYLES: Record<ComparisonStatus, { wrap: string; icon: string; badge: string; label: string }> = {
  pending: {
    wrap: 'bg-gray-50 border-gray-200',
    icon: 'bg-gray-100 text-gray-700',
    badge: 'bg-gray-100 text-gray-800 border-gray-300',
    label: 'Pendente',
  },
  transcribing: {
    wrap: 'bg-amber-50 border-amber-200',
    icon: 'bg-amber-100 text-amber-700',
    badge: 'bg-amber-100 text-amber-800 border-amber-300',
    label: 'Em andamento',
  },
  completed: {
    wrap: 'bg-green-50 border-green-200',
    icon: 'bg-green-100 text-green-700',
    badge: 'bg-green-100 text-green-800 border-green-300',
    label: 'Concluída',
  },
  error: {
    wrap: 'bg-red-50 border-red-200',
    icon: 'bg-red-100 text-red-700',
    badge: 'bg-red-100 text-red-800 border-red-300',
    label: 'Erro',
  },
  cancelled: {
    wrap: 'bg-gray-50 border-gray-300',
    icon: 'bg-gray-100 text-gray-700',
    badge: 'bg-gray-100 text-gray-800 border-gray-300',
    label: 'Cancelada',
  },
}

export default function ComparisonHeader({
  name,
  status,
  currentStep,
  lastChunkIndex,
  errorMessage,
}: ComparisonHeaderProps) {
  const isInProgress = status === 'transcribing'
  const stepLabel = STEP_LABELS[currentStep]
  const stepDescription = STEP_DESCRIPTIONS[currentStep]
  const showChunkInfo =
    typeof lastChunkIndex === 'number' && lastChunkIndex > 0 && isInProgress
  const styles = STATUS_STYLES[status]

  return (
    <div className={`mb-4 p-4 rounded-xl border ${styles.wrap}`}>
      <div className="flex items-start gap-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${styles.icon}`}>
          {isInProgress ? (
            <CircleDashed className="w-5 h-5" />
          ) : status === 'error' ? (
            <AlertCircle className="w-5 h-5" />
          ) : status === 'cancelled' ? (
            <X className="w-5 h-5" />
          ) : (
            <CheckCircle className="w-5 h-5" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <FileText className="w-4 h-4 text-gray-400 shrink-0" />
            <h2 className="text-base font-semibold text-gray-900 truncate">
              {name || 'Comparação sem nome'}
            </h2>
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full border ${styles.badge}`}
            >
              {styles.label}
            </span>
            {showChunkInfo && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full border bg-amber-100 text-amber-900 border-amber-300 flex items-center gap-1">
                <Activity className="w-3 h-3" />
                Parou no chunk {lastChunkIndex}
              </span>
            )}
          </div>
          <p className="text-sm text-gray-600 mt-1">
            Passo <strong>{currentStep}</strong> de 3 — {stepLabel}
            <span className="hidden sm:inline"> · {stepDescription}</span>
          </p>
          {status === 'error' && errorMessage && (
            <p className="text-xs text-red-700 mt-1 break-words">
              {errorMessage}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
