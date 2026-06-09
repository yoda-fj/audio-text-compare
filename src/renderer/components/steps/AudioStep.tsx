import {
  FileAudio,
  ArrowLeft,
  ArrowRight,
  Mic,
  Settings,
} from 'lucide-react'
import FileDropzone from '../FileDropzone'
import ProgressBar from '../ProgressBar'

interface AudioStepProps {
  audioPath: string | null
  transcribedText: string
  selectedModel: string
  isHfTokenConfigured: boolean
  isProcessing: boolean
  progress: number
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
  isHfTokenConfigured,
  isProcessing,
  progress,
  onSelectAudio,
  onClearAudio,
  onChangeModel,
  onTranscribe,
  onCompare,
  onBack,
}: AudioStepProps) {
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
              Modelo Gemma 4:
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
          </select>

          <p className="text-xs text-gray-500 mt-2">
            A primeira transcrição pode demorar enquanto o modelo é carregado na memória. Em máquinas com 16 GB de RAM prefira o modelo <strong>E2B</strong>.
          </p>
        </div>
      </div>

      <div className="flex justify-center">
        <button
          onClick={onTranscribe}
          disabled={!audioPath || !isHfTokenConfigured || isProcessing}
          title={!audioPath ? 'Selecione um áudio' : !isHfTokenConfigured ? 'Configure o HF Token' : 'Iniciar transcrição'}
          className="btn-primary flex items-center gap-2 text-lg px-8 py-3 shadow-lg shadow-primary-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isProcessing ? (
            <>
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Processando...
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
            label="Progresso da transcrição"
            showPercentage={true}
          />
          <p className="text-center text-sm text-gray-600 font-medium">
            {progress < 30 && 'Enviando áudio para transcrição...'}
            {progress >= 30 &&
              progress < 70 &&
              `Transcrevendo áudio com ${selectedModel}...`}
            {progress >= 70 && progress < 100 && 'Comparando textos...'}
            {progress === 100 && 'Finalizado!'}
          </p>
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
