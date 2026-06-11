import { useEffect, useRef, useState } from 'react'
import { FilePlus, X } from 'lucide-react'

interface NewComparisonModalProps {
  isOpen: boolean
  onClose: () => void
  onCreate: (name: string) => void | Promise<void>
}

export default function NewComparisonModal({ isOpen, onClose, onCreate }: NewComparisonModalProps) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      setName('')
      setError(null)
      setIsSubmitting(false)
      // Foco automático no input quando o modal abre
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Informe um nome para a comparação.')
      inputRef.current?.focus()
      return
    }
    setIsSubmitting(true)
    try {
      await onCreate(trimmed)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center">
            <FilePlus className="w-5 h-5 text-primary-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-900">Nova comparação</h2>
          <button
            onClick={onClose}
            className="ml-auto text-gray-400 hover:text-gray-600"
            title="Fechar"
            type="button"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="comparison-name" className="block text-sm font-medium text-gray-700 mb-1">
              Nome da comparação
            </label>
            <input
              ref={inputRef}
              id="comparison-name"
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                if (error) setError(null)
              }}
              placeholder="Ex.: Lição 03 — v1"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-sm"
              maxLength={120}
              autoComplete="off"
            />
            {error && (
              <p className="text-xs text-red-600 mt-1.5">{error}</p>
            )}
            <p className="text-xs text-gray-500 mt-1.5">
              O nome é salvo junto com o progresso. Você pode retomá-lo depois pelo Histórico.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary"
              disabled={isSubmitting}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Criando…' : 'Criar e começar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
