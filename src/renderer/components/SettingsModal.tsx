import { useEffect, useState } from 'react'
import { CheckCircle, Download, Settings, X } from 'lucide-react'
import ProgressBar from './ProgressBar'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [downloaded, setDownloaded] = useState<boolean | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return

    setDownloaded(null)
    setError(null)
    setProgress(0)
    setMessage('')

    void window.electronAPI.getWhisperModelStatus().then((status) => {
      setDownloaded(status.downloaded)
    })
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || !downloading) return

    const unsubscribe = window.electronAPI.onWhisperDownloadProgress((p, msg) => {
      setProgress(p)
      setMessage(msg)
    })

    return () => {
      unsubscribe()
    }
  }, [isOpen, downloading])

  const handleDownload = async () => {
    setDownloading(true)
    setError(null)
    setProgress(10)
    setMessage('Iniciando download do Whisper Large v3...')

    try {
      const result = await window.electronAPI.downloadWhisperModel()
      setDownloaded(result.downloaded)
      if (!result.downloaded) {
        setError('O modelo não foi encontrado após o download.')
      }
    } catch (err) {
      setError(`Falha ao baixar o modelo: ${err}`)
      setProgress(0)
      setMessage('')
    } finally {
      setDownloading(false)
    }
  }

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

        <div className="border-t border-gray-200 pt-4 space-y-3">
          <h3 className="text-sm font-medium text-gray-700">Modelo Whisper Large v3</h3>
          <p className="text-xs text-gray-500">
            Necessário para transcrição com Whisper. O arquivo tem aproximadamente 3 GB.
          </p>

          {downloaded === null && (
            <p className="text-xs text-gray-500">Verificando status do modelo... </p>
          )}

          {downloaded === false && !downloading && (
            <button
              onClick={handleDownload}
              className="btn-primary flex items-center gap-2 w-full justify-center"
            >
              <Download className="w-4 h-4" />
              Baixar Whisper Large v3
            </button>
          )}

          {downloading && (
            <div className="space-y-2">
              <ProgressBar progress={progress} label={message} showPercentage />
              <p className="text-xs text-gray-500">Aguarde. Não feche o aplicativo.</p>
            </div>
          )}

          {downloaded === true && !downloading && (
            <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              <CheckCircle className="w-4 h-4" />
              Whisper Large v3 baixado
            </div>
          )}

          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
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
