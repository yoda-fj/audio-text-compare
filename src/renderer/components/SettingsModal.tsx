import { useEffect, useState } from 'react'
import { Settings, Eye, EyeOff, X, Download, CheckCircle, AlertCircle } from 'lucide-react'
import ProgressBar from './ProgressBar'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  onSaved?: () => void
}

const MODEL_OPTIONS = [
  'google/gemma-4-12B-it',
  'google/gemma-4-E2B-it',
  'google/gemma-4-E4B-it',
]

export default function SettingsModal({ isOpen, onClose, onSaved }: SettingsModalProps) {
  const [token, setToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const [model, setModel] = useState(MODEL_OPTIONS[0])
  const [downloading, setDownloading] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [downloadMessage, setDownloadMessage] = useState('')
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [downloadSuccess, setDownloadSuccess] = useState(false)

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
    setDownloadError(null)
    setDownloadSuccess(false)
    setDownloadProgress(0)
    setDownloadMessage('')
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

  const handleDownload = async () => {
    setDownloading(true)
    setDownloadProgress(0)
    setDownloadMessage('')
    setDownloadError(null)
    setDownloadSuccess(false)

    // Ensure the token is persisted before downloading; the backend reads it from the encrypted store.
    if (!token.trim()) {
      setDownloadError('Informe o Hugging Face Token antes de baixar o modelo.')
      setDownloading(false)
      return
    }
    try {
      await window.electronAPI.saveSetting('hf_token', token)
      onSaved?.()
    } catch (err) {
      setDownloadError('Não foi possível salvar o token. Tente novamente.')
      setDownloading(false)
      return
    }

    const unsubscribe = window.electronAPI.onDownloadProgress((progress, message) => {
      setDownloadProgress(progress)
      setDownloadMessage(message)
    })

    try {
      const result = await window.electronAPI.downloadModel(model)
      unsubscribe()
      if (!result.success) {
        throw new Error(result.error || 'Falha no download do modelo.')
      }
      setDownloadSuccess(true)
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : String(err))
    } finally {
      setDownloading(false)
      unsubscribe()
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
            O token é necessário para baixar o modelo Gemma 4. Crie um token em{' '}
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

        <div className="space-y-2">
          <label htmlFor="model-select" className="block text-sm font-medium text-gray-700">
            Modelo Gemma 4
          </label>
          <select
            id="model-select"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={downloading}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-sm bg-white"
          >
            {MODEL_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <button
            onClick={handleDownload}
            disabled={downloading || !token.trim()}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            {downloading ? (
              <>Baixando...</>
            ) : (
              <>
                <Download className="w-4 h-4" />
                Baixar modelo
              </>
            )}
          </button>

          {downloading && (
            <div className="pt-1">
              <ProgressBar progress={downloadProgress} label={downloadMessage || 'Progresso do download'} />
            </div>
          )}

          {downloadError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{downloadError}</span>
            </div>
          )}

          {downloadSuccess && (
            <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm flex items-start gap-2">
              <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Modelo baixado com sucesso!</span>
            </div>
          )}
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
