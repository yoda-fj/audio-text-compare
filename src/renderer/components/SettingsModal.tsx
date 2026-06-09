import { useEffect, useState } from 'react'
import { Settings, Eye, EyeOff, X } from 'lucide-react'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  onSaved?: () => void
}

export default function SettingsModal({ isOpen, onClose, onSaved }: SettingsModalProps) {
  const [token, setToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    const load = async () => {
      try {
        const value = await window.electronAPI.getSetting('hf_token')
        if (!cancelled) setToken(value || '')
      } catch {
        if (!cancelled) setToken('')
      }
    }
    load()
    setSaved(false)
    return () => {
      cancelled = true
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleSave = async () => {
    setSaving(true)
    try {
      await window.electronAPI.saveSetting('hf_token', token)
      setSaved(true)
      onSaved?.()
      setTimeout(() => {
        onClose()
      }, 600)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Erro ao salvar configuração:', err)
    } finally {
      setSaving(false)
    }
  }

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
          <label htmlFor="hf-token" className="block text-sm font-medium text-gray-700">
            Hugging Face Token
          </label>
          <div className="relative">
            <input
              id="hf-token"
              type={showToken ? 'text' : 'password'}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="hf_..."
              className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-sm"
            />
            <button
              type="button"
              onClick={() => setShowToken((v) => !v)}
              className="absolute inset-y-0 right-0 px-3 text-gray-500 hover:text-gray-700"
              title={showToken ? 'Ocultar token' : 'Mostrar token'}
            >
              {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-xs text-gray-500">
            O token é necessário para os modelos Gemma 4. Crie um token em{' '}
            <a
              href="https://huggingface.co/settings/tokens"
              target="_blank"
              rel="noreferrer"
              className="text-primary-600 hover:underline"
            >
              huggingface.co/settings/tokens
            </a>{' '}
            e aceite a licença do modelo.
          </p>
        </div>

        <div className="space-y-2 pt-2 border-t border-gray-200">
          <h3 className="text-sm font-medium text-gray-700">Modelos disponíveis</h3>
          <p className="text-xs text-gray-500">
            Os modelos de transcrição são embutidos no instalador do app.
          </p>
          <ul className="text-xs text-gray-600 list-disc list-inside space-y-1">
            <li>Whisper Large v3 (OpenAI)</li>
            <li>Gemma 4 E2B / E4B / 12B (Google)</li>
          </ul>
          <p className="text-xs text-gray-500">
            O Hugging Face Token é necessário apenas para os modelos Gemma 4.
          </p>
        </div>

        {saved && (
          <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
            Configuração salva com sucesso!
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={onClose}
            className="btn-secondary"
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-primary"
          >
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}
