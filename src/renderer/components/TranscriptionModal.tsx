import { useEffect, useRef } from 'react'
import { Mic, X } from 'lucide-react'
import ProgressBar from './ProgressBar'

interface TranscriptionModalProps {
  isOpen: boolean
  progress: number
  progressMessage: string
  onCancel?: () => void
}

export default function TranscriptionModal({
  isOpen,
  progress,
  progressMessage,
  onCancel,
}: TranscriptionModalProps) {
  const logRef = useRef<HTMLDivElement>(null)
  const messagesRef = useRef<string[]>([])

  // Guarda histórico de mensagens únicas
  useEffect(() => {
    if (progressMessage && !messagesRef.current.includes(progressMessage)) {
      messagesRef.current.push(progressMessage)
      // Limita a 200 mensagens para não consumir memória
      if (messagesRef.current.length > 200) {
        messagesRef.current = messagesRef.current.slice(-200)
      }
    }
  }, [progressMessage])

  // Auto-scroll para o final
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [progressMessage, isOpen])

  // Limpa histórico ao fechar
  useEffect(() => {
    if (!isOpen) {
      messagesRef.current = []
    }
  }, [isOpen])

  if (!isOpen) return null

  const recentMessages = messagesRef.current.slice(-50)
  const lastMessage = recentMessages[recentMessages.length - 1] || 'Iniciando...'

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100">
          <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center animate-pulse">
            <Mic className="w-5 h-5 text-primary-600" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-bold text-gray-900">Transcrevendo áudio</h2>
            <p className="text-sm text-gray-500">Processando em tempo real...</p>
          </div>
          {onCancel && (
            <button
              onClick={onCancel}
              className="text-gray-400 hover:text-red-500 transition-colors"
              title="Cancelar transcrição"
            >
              <X className="w-6 h-6" />
            </button>
          )}
        </div>

        {/* Progress */}
        <div className="px-6 py-4 space-y-3">
          <ProgressBar progress={progress} label="Progresso" showPercentage={true} />
          <p className="text-sm font-medium text-primary-700 text-center">
            {progressMessage || 'Processando...'}
          </p>
        </div>

        {/* Last segment highlight */}
        <div className="px-6 py-3 bg-primary-50 border-y border-primary-100">
          <p className="text-xs font-semibold text-primary-600 uppercase tracking-wide mb-1">
            Último trecho transcrito
          </p>
          <p className="text-sm text-gray-800 leading-relaxed font-mono">
            {lastMessage}
          </p>
        </div>

        {/* Log scrollable */}
        <div className="flex-1 min-h-0 px-6 py-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
            Histórico ({recentMessages.length} segmentos)
          </p>
          <div
            ref={logRef}
            className="h-48 overflow-y-auto space-y-1 pr-2 scrollbar-thin"
          >
            {recentMessages.map((msg, i) => (
              <div
                key={i}
                className={`text-xs font-mono px-2 py-1 rounded ${
                  i === recentMessages.length - 1
                    ? 'bg-primary-50 text-primary-800'
                    : 'text-gray-600'
                }`}
              >
                {msg}
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-100 text-center">
          <p className="text-xs text-gray-400">
            Não feche o aplicativo durante a transcrição
          </p>
        </div>
      </div>
    </div>
  )
}
