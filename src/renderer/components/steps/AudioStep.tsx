import {
  FileAudio,
  ArrowLeft,
  ArrowRight,
  Mic,
  Settings,
  RotateCcw,
  AlertCircle,
  Clock,
} from 'lucide-react'
import FileDropzone from '../FileDropzone'
import ProgressBar from '../ProgressBar'

interface AudioStepProps {
  audioPath: string | null
  /**
   * Duração do áudio em segundos. `null` enquanto a leitura Python
   * não termina ou se falhou. Usado para exibir "≈ N min, M chunks"
   * no cabeçalho do áudio.
   */
  audioDuration: number | null
  transcribedText: string
  selectedModel: string
  isProcessing: boolean
  progress: number
  progressMessage?: string
  /**
   * Duração configurada de cada chunk em segundos (Gemma: tamanho real
   * do chunk; Whisper: janela do pré-teste). Persistido por comparação.
   */
  chunkDurationS: number
  /**
   * Número de chunks a processar no pré-teste. 0 = áudio inteiro. Não
   * persistido (parâmetro da execução).
   */
  maxChunks: number
  onSelectAudio: () => void
  onClearAudio: () => void
  onChangeModel: (model: string) => void
  onChangeChunkDuration: (seconds: number) => void
  onChangeMaxChunks: (n: number) => void
  /** Recebe o número de chunks a processar (0 = áudio inteiro). */
  onTranscribe: (maxChunks: number) => void
  onCompare: () => void
  onBack: () => void
  /**
   * Chunks da comparação atual (vazio para comparações recém-criadas).
   * Quando há pelo menos um chunk `done`, mostramos um aviso de retomada
   * — o Node vai regenerar o checkpoint a partir do DB e o Python vai
   * pular os chunks já processados.
   */
  doneChunksCount?: number
  totalChunksEstimate?: number | null
}

export default function AudioStep({
  audioPath,
  audioDuration,
  transcribedText,
  selectedModel,
  isProcessing,
  progress,
  progressMessage,
  chunkDurationS,
  maxChunks,
  onSelectAudio,
  onClearAudio,
  onChangeModel,
  onChangeChunkDuration,
  onChangeMaxChunks,
  onTranscribe,
  onCompare,
  onBack,
  doneChunksCount = 0,
  totalChunksEstimate = null,
}: AudioStepProps) {
  const canResume = doneChunksCount > 0
  const isWhisper = selectedModel === 'whisper-large-v3'
  /**
   * O input de duração é bloqueado após o primeiro chunk `done` ou
   * durante uma transcrição em andamento: mudar a duração com chunks já
   * persistidos geraria índices inconsistentes no DB.
   */
  const chunkDurationLocked = doneChunksCount > 0 || isProcessing

  /** Formata segundos em "Xmin Ys" ou "Xh Ymin". */
  const formatDuration = (seconds: number): string => {
    const s = Math.max(0, Math.round(seconds))
    if (s < 60) return `${s}s`
    const m = Math.floor(s / 60)
    const rem = s % 60
    if (m < 60) return rem === 0 ? `${m} min` : `${m} min ${rem}s`
    const h = Math.floor(m / 60)
    const remM = m % 60
    return remM === 0 ? `${h}h` : `${h}h ${remM}min`
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

      {audioPath && (audioDuration != null || totalChunksEstimate != null) && (
        <div className="flex items-center gap-4 text-sm text-gray-600 px-1">
          {audioDuration != null && (
            <div className="flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-gray-400" />
              <span>
                Duração: <strong className="text-gray-800">{formatDuration(audioDuration)}</strong>
              </span>
            </div>
          )}
          {totalChunksEstimate != null && (
            <div className="flex items-center gap-1.5">
              <FileAudio className="w-4 h-4 text-gray-400" />
              <span>
                {isWhisper ? (
                  'O Whisper processa o áudio inteiro de uma vez (sem chunks)'
                ) : (
                  <>
                    ≈ <strong className="text-gray-800">{totalChunksEstimate}</strong> chunk(s) de {chunkDurationS}s
                  </>
                )}
              </span>
            </div>
          )}
        </div>
      )}

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
            <option value="whisper-large-v3">Whisper Large v3 — OpenAI (mais rápido, recomendado)</option>
            <option value="google/gemma-4-E2B-it">Gemma 4 E2B — para 16 GB RAM</option>
            <option value="google/gemma-4-E4B-it">Gemma 4 E4B — equilibrado</option>
            <option value="google/gemma-4-12B-it">Gemma 4 12B — exige mais RAM/VRAM</option>
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

      <div className="card p-4 space-y-4">
        <div>
          <label
            htmlFor="chunk-duration"
            className="block text-sm font-medium text-gray-700"
            title={
              'No Gemma, é o tamanho real de cada chunk. ' +
              'No Whisper, é a janela de cada chunk do pré-teste ' +
              '(multiplicada pelo número de chunks abaixo).'
            }
          >
            Duração de cada chunk (segundos)
          </label>
          <div className="flex items-center gap-2 mt-1">
            <input
              id="chunk-duration"
              type="number"
              min={5}
              max={120}
              step={1}
              value={chunkDurationS}
              onChange={(e) => onChangeChunkDuration(Number(e.target.value))}
              disabled={chunkDurationLocked}
              title={
                chunkDurationLocked
                  ? 'Não é possível alterar após iniciar a transcrição'
                  : 'No Gemma: tamanho real de cada chunk. No Whisper: janela de cada chunk do pré-teste.'
              }
              className="w-24 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-white disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <span className="text-xs text-gray-500">5 a 120s (padrão 30)</span>
          </div>
        </div>

        <div>
          <label
            htmlFor="max-chunks"
            className="block text-sm font-medium text-gray-700"
            title={
              canResume
                ? `Cumulativo: processa mais N chunks a partir dos ${doneChunksCount} já feitos. ` +
                  'Use 0 para retomar o áudio inteiro a partir do próximo chunk não processado.'
                : 'Pré-teste: processa apenas os primeiros N chunks. ' +
                  'Útil para validar a configuração antes de rodar o áudio inteiro.'
            }
          >
            {canResume ? 'Adicionar mais N chunks' : 'Pré-teste (N chunks)'}
          </label>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-sm text-gray-600">
              {canResume ? 'Adicionar apenas mais' : 'Processar apenas os primeiros'}
            </span>
            <input
              id="max-chunks"
              type="number"
              min={0}
              max={50}
              step={1}
              value={maxChunks}
              onChange={(e) => onChangeMaxChunks(Number(e.target.value))}
              disabled={isProcessing}
              className="w-20 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-white disabled:opacity-50"
            />
            <span className="text-sm text-gray-600">
              {canResume ? 'chunks (0 = retomar do próximo)' : 'chunks (0 = áudio inteiro)'}
            </span>
          </div>
        </div>
      </div>

      {canResume && !isProcessing && (
        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg space-y-3">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-yellow-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-yellow-800">
                Transcrição anterior interrompida
              </p>
              <p className="text-sm text-yellow-700 mt-1">
                <strong>{doneChunksCount}</strong>
                {totalChunksEstimate != null && (
                  <> de <strong>{totalChunksEstimate}</strong></>
                )} chunk(s) já processado(s) (cada um com {chunkDurationS}s).
              </p>
              <p className="text-sm text-yellow-700 mt-1">
                {maxChunks > 0 ? (
                  <>
                    Com <strong>Adicionar mais {maxChunks} chunk(s)</strong> você chega a{' '}
                    <strong>{doneChunksCount + maxChunks}</strong>
                    {totalChunksEstimate != null && (
                      <> de <strong>{totalChunksEstimate}</strong></>
                    )}{' '}
                    processados. Use <strong>0</strong> no campo acima para retomar o áudio
                    inteiro (próximo chunk não processado em diante).
                  </>
                ) : (
                  <>
                    Deixe <strong>0</strong> em "Adicionar mais N chunks" para retomar o
                    áudio inteiro do próximo chunk não processado em diante, ou preencha
                    com um número para pedir mais alguns e revisar antes.
                  </>
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
        <button
          onClick={() => onTranscribe(maxChunks)}
          disabled={!audioPath || isProcessing}
          title={!audioPath ? 'Selecione um áudio' : 'Iniciar transcrição'}
          className="btn-primary flex items-center gap-2 text-lg px-8 py-3 shadow-lg shadow-primary-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isProcessing ? (
            <>
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Processando...
            </>
          ) : canResume && maxChunks > 0 ? (
            <>
              <RotateCcw className="w-5 h-5" />
              Continuar + {maxChunks} chunk(s)
            </>
          ) : canResume ? (
            <>
              <RotateCcw className="w-5 h-5" />
              Continuar transcrição
            </>
          ) : maxChunks > 0 ? (
            <>
              <Mic className="w-5 h-5" />
              Pré-teste: {maxChunks} chunk(s)
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
              O Whisper está processando o áudio. Isso pode levar alguns minutos dependendo do tamanho do arquivo.
              Não feche o aplicativo durante a transcrição.
            </p>
          ) : (
            <p className="text-center text-xs text-yellow-600 bg-yellow-50 border border-yellow-200 rounded-lg p-2">
              Cada chunk pode levar <strong>2–5 minutos</strong> dependendo do hardware.
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
