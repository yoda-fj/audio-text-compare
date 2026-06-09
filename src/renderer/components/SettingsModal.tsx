import { Settings, X } from 'lucide-react'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-fade-in">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center">
            <Settings className="w-5 h-5 text-primary-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-900">Configurações</h2>
          <button
            onClick={onClose}
            className="ml-auto text-gray-400 hover:text-gray-600"
            title="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-medium text-gray-700">Modelos disponíveis</h3>
          <p className="text-xs text-gray-500">
            Os modelos de transcrição são embutidos no instalador do app.
          </p>
          <ul className="text-xs text-gray-600 list-disc list-inside space-y-1">
            <li>Whisper Large v3 (OpenAI)</li>
            <li>Gemma 4 E2B / E4B / 12B (Google)</li>
          </ul>
        </div>

        <div className="flex justify-end pt-2">
          <button onClick={onClose} className="btn-primary">
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}
