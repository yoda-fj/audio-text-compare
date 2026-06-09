import { useState, useEffect } from 'react'
import {
  FileAudio,
  ArrowLeft,
  ArrowRight,
  Mic,
  Settings,
  RotateCcw,
  Trash2,
  AlertCircle,
} from 'lucide-react'
import FileDropzone from '../FileDropzone'
import ProgressBar from '../ProgressBar'

interface AudioStepProps {
  audioPath: string | null
  transcribedText: string
  selectedModel: string
  isProcessing: boolean
  progress: number
  progressMessage?: string
  onSelectAudio: () => void
  onClearAudio: () => void
  onChangeModel: (model: string) => void
  onTranscribe: () => void
  onCompare: () => void
  onBack: () => void
}

export default function AudioStep({
  audioPath,
  transcribedText,
  selectedModel,
  isProcessing,
  progress,
  progressMessage,
  onSelectAudio,
  onClearAudio,
  onChangeModel,
  onTranscribe,
  onCompare,
  onBack,
}: AudioStepProps) {
  const [checkpoint, setCheckpoint] = useState<{ exists: boolean; completedChunks?: number; totalChunks?: number } | null>(null)

  useEffect(() => {
    if (!audioPath) {
      setCheckpoint(null)
      return
    }
    let cancelled = false
    window.electronAPI.getCheckpointStatus(audioPath, selectedModel).then((status) => {
      if (!cancelled) setCheckpoint(status)
    }).catch(() => {
      if (!cancelled) setCheckpoint(null)
    })
    return () => { cancelled = true }
  }, [audioPath, selectedModel])

  const handleDiscard = async () => {
    if (!audioPath) return
    await window.electronAPI.deleteCheckpoint(audioPath, selectedModel)
    setCheckpoint(null)
  }
  return (
    <div className="animate-fade-in space-y-6">
      <FileDropzone
        icon={<FileAudio className="w-8 h-8" />}
        title="Áudio para Transcrever"
        description="Arraste ou clique para selecionar WAV, MP3, OGG, M4A ou FLAC"
        acceptedTypes=".wav,.mp3,.ogg,.m4a,.flac"
        onFileSelect={() => onSelectAudio()}
        fileName={audioPath?.split('/').pop()}
        onClear={onClearAudio}
      />

      <div className="card p-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-gray-500" />
            <label className="text-sm font-medium text-gray-700">
              Modelo de transcrição:
            </label>
          </div>
          <select
            value={selectedModel}
            onChange={(e) => onChangeModel(e.target.value)}
            disabled={isProcessing}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-white disabled:opacity-50"
          >
            <option value="google/gemma-4-E2B-it">Gemma 4 E2B — recomendado para 16 GB RAM</option>
            <option value="google/gemma-4-E4B-it">Gemma 4 E4B — equilibrado</option>
            <option value="google/gemma-4-12B-it">Gemma 4 12B — exige mais RAM/VRAM</option>
            <option value="whisper-large-v3">Whisper Large v3 — OpenAI (mais rápido, sem HF Token)</option>
          </select>

          {selectedModel === 'whisper-large-v3' ? (
            <p className="text-xs text-gray-500 mt-2">
              O Whisper processa o áudio inteiro de uma vez (sem chunking). Mais rápido e não requer token do Hugging Face.
            </p>
          ) : (
            <p className="text-xs text-gray-500 mt-2">
              A primeira transcrição pode demorar enquanto o modelo é carregado na memória. Em máquinas com 16 GB de RAM prefira o modelo <strong>E2B</strong>.
            </p>
          )}
        </div>
      </div>

      {selectedModel !== 'whisper-large-v3' && checkpoint && checkpoint.exists && !isProcessing && (
        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg space-y-3">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-yellow-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-yellow-800">
                Transcrição anterior interrompida
              </p>
              <p className="text-sm text-yellow-700 mt-1">
                {checkpoint.completedChunks} de {checkpoint.totalChunks} chunk(s) já processado(s).
                Clique em <strong>Retomar</strong> para continuar de onde parou.
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={onTranscribe}
              className="btn-primary flex items-center gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              Retomar transcrição
            </button>
            <button
              onClick={handleDiscard}
              className="btn-secondary flex items-center gap-2 text-red-600 border-red-200 hover:bg-red-50"
            >
              <Trash2 className="w-4 h-4" />
              Descartar e recomeçar
            </button>
          </div>
        </div>
      )}

      <div className="flex justify-center">
        <button
          onClick={onTranscribe}
          disabled={!audioPath || isProcessing}
          title={!audioPath ? 'Selecione um áudio' : 'Iniciar transcrição'}
          className="btn-primary flex items-center gap-2 text-lg px-8 py-3 shadow-lg shadow-primary-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isProcessing ? (
            <>
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Processando...
            </>
          ) : selectedModel !== 'whisper-large-v3' && checkpoint && checkpoint.exists ? (
            <>
              <RotateCcw className="w-5 h-5" />
              Retomar transcrição
            </>
          ) : (
            <>
              <Mic className="w-5 h-5" />
              Transcrever áudio
            </>
          )}
        </button>
      </div>

      {isProcessing && (
        <div className="card space-y-3">
          <ProgressBar
            progress={progress}
            label={progressMessage || 'Progresso da transcrição'}
            showPercentage={true}
          />
          <p className="text-center text-sm text-gray-600 font-medium">
            {progressMessage || 'Processando...'}
          </p>
          {selectedModel === 'whisper-large-v3' ? (
            <p className="text-center text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded-lg p-2">
              O Whisper está processando o áudio completo. Isso pode levar alguns minutos dependendo do tamanho do arquivo.
              Não feche o aplicativo durante a transcrição.
            </p>
          ) : (
            <p className="text-center text-xs text-yellow-600 bg-yellow-50 border border-yellow-200 rounded-lg p-2">
              ⚠️ Cada chunk pode levar <strong>2–5 minutos</strong> dependendo do hardware.
              Não feche o aplicativo nem deixe a máquina dormir durante a transcrição.
            </p>
          )}
        </div>
      )}

      {transcribedText && !isProcessing && (
        <div className="card p-4 space-y-3">
          <label className="block text-sm font-medium text-gray-700">
            Texto transcrito do áudio
          </label>
          <textarea
            readOnly
            value={transcribedText}
            className="w-full h-40 px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-sm font-mono resize-y focus:outline-none"
          />
        </div>
      )}

      <div className="flex justify-between">
        <button
          onClick={onBack}
          className="btn-secondary flex items-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Voltar
        </button>
        <button
          onClick={onCompare}
          disabled={!transcribedText || isProcessing}
          className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Comparar
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
