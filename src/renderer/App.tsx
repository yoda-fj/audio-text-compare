import { useState, useEffect, useRef, useCallback } from 'react'
import {
  FileAudio,
  History,
  CheckCircle,
  AlertCircle,
  Trash2,
  Settings,
} from 'lucide-react'
import HistoryPanel from './components/HistoryPanel'
import SettingsModal from './components/SettingsModal'
import TranscriptionModal from './components/TranscriptionModal'
import NewComparisonModal from './components/NewComparisonModal'
import ComparisonHeader from './components/ComparisonHeader'
import ChunkDetailModal from './components/ChunkDetailModal'
import StepIndicator from './components/steps/StepIndicator'
import DocumentStep from './components/steps/DocumentStep'
import AudioStep from './components/steps/AudioStep'
import ResultStep from './components/steps/ResultStep'
import {
  ComparisonRecord,
  ComparisonResult,
  ComparisonStep,
  ChunkRun,
  DiffItem,
  PythonEvent,
} from './types'

function App() {
  // ---------------------------------------------------------------------
  // Estado principal
  // ---------------------------------------------------------------------
  const [currentComparison, setCurrentComparison] = useState<ComparisonRecord | null>(null)
  const [chunks, setChunks] = useState<ChunkRun[]>([])
  const [currentStep, setCurrentStep] = useState<ComparisonStep>(1)

  // UI
  const [showNewComparisonModal, setShowNewComparisonModal] = useState(false)
  const [resumePrompt, setResumePrompt] = useState<ComparisonRecord[] | null>(null)
  const [bootLoading, setBootLoading] = useState(true)
  const [showHistory, setShowHistory] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  // Transcrição
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [progressMessage, setProgressMessage] = useState('')

  // Arquivos (espelham o que está persistido em currentComparison)
  const [documentPath, setDocumentPath] = useState<string | null>(null)
  const [documentText, setDocumentText] = useState('')
  const [audioPath, setAudioPath] = useState<string | null>(null)
  const [audioDuration, setAudioDuration] = useState<number | null>(null)
  const [transcribedText, setTranscribedText] = useState('')
  const [comparison, setComparison] = useState<ComparisonResult | null>(null)
  const [selectedModel, setSelectedModel] = useState('whisper-large-v3')
  const [pdfPageStart, setPdfPageStart] = useState<number | ''>('')
  const [pdfPageEnd, setPdfPageEnd] = useState<number | ''>('')

  // Configuração de chunk (persistida por comparação, exceto maxChunks que
  // é só da execução atual — sempre volta a 0 ao recarregar).
  const [chunkDurationS, setChunkDurationS] = useState<number>(30)
  const [maxChunks, setMaxChunks] = useState<number>(0)

  // Misc
  const [pythonStatus, setPythonStatus] = useState<{ ready: boolean; python?: string; message: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // Chunk detail modal
  const [selectedChunk, setSelectedChunk] = useState<ChunkRun | null>(null)
  const [showChunkDetail, setShowChunkDetail] = useState(false)

  // Refs para cleanup de subscriptions e proteção contra updates após unmount
  const unsubEventRef = useRef<(() => void) | null>(null)
  const unsubProgressRef = useRef<(() => void) | null>(null)

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------
  useEffect(() => {
    void boot()
  }, [])

  // ---------------------------------------------------------------------
  // Duração do áudio: lida via IPC para mostrar "≈ N min, M chunks" no
  // passo de áudio. Cancela a leitura anterior se o usuário trocar o
  // arquivo antes do resultado chegar.
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (!audioPath) {
      setAudioDuration(null)
      return
    }
    let cancelled = false
    setAudioDuration(null)
    void window.electronAPI.getAudioDuration(audioPath).then((d) => {
      if (!cancelled) setAudioDuration(d)
    })
    return () => {
      cancelled = true
    }
  }, [audioPath])

  const boot = async () => {
    setBootLoading(true)
    try {
      const [status, active] = await Promise.all([
        window.electronAPI.checkPythonStatus(),
        window.electronAPI.getActiveComparisons(),
      ])
      setPythonStatus(status)

      if (active.length === 0) {
        setShowNewComparisonModal(true)
        return
      }

      // Há comparações pendentes ou transcribing órfãs. Pergunta ao usuário.
      setResumePrompt(active)
    } catch (err) {
      setError(`Erro ao iniciar o aplicativo: ${err}`)
      setShowNewComparisonModal(true)
    } finally {
      setBootLoading(false)
    }
  }

  /**
   * Carrega uma comparação como `currentComparison` e posiciona o usuário
   * na etapa correta: step 3 se `completed`, step 2 caso contrário.
   */
  const loadComparison = useCallback(async (c: ComparisonRecord) => {
    setCurrentComparison(c)
    setDocumentPath(c.document_path)
    setDocumentText(c.original_text ?? '')
    setAudioPath(c.audio_path)
    setTranscribedText(c.transcribed_text ?? '')
    if (c.model_used) setSelectedModel(c.model_used)
    setChunkDurationS(c.chunk_duration_s ?? 30)
    // maxChunks é parâmetro da execução, não da comparação: sempre volta a 0
    setMaxChunks(0)

    // Diff (se já concluída)
    if (c.status === 'completed' && c.diff_result) {
      try {
        const diff = JSON.parse(c.diff_result) as DiffItem[]
        setComparison({
          diff,
          accuracy: c.accuracy_score ?? 0,
          originalText: c.original_text ?? '',
          transcribedText: c.transcribed_text ?? '',
        })
      } catch {
        setComparison(null)
      }
      setCurrentStep(3)
    } else if (c.audio_path) {
      setCurrentStep(2)
    } else if (c.document_path) {
      setCurrentStep(1)
    } else {
      setCurrentStep(1)
    }

    // Carrega chunks (vazio para comparações v1 legadas ou antes da transcrição)
    try {
      const cs = await window.electronAPI.getComparisonChunks(c.id!)
      setChunks(cs)
    } catch {
      setChunks([])
    }
  }, [])

  const handleResume = async () => {
    if (!resumePrompt || resumePrompt.length === 0) return
    const target = resumePrompt[0]
    setResumePrompt(null)
    await loadComparison(target)
  }

  /**
   * Regra anti-zumbi do plano: comparações "transcribing" no boot não têm
   * processo vivo (o app acabou de abrir). Marcamos todas como `error`
   * para que nunca fiquem em `transcribing` para sempre.
   */
  const handleDeclineResume = async () => {
    if (resumePrompt) {
      for (const c of resumePrompt) {
        try {
          await window.electronAPI.markComparisonError(
            c.id!,
            'Interrompida: app foi fechado durante a transcrição'
          )
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('Falha ao marcar comparação órfã como erro:', err)
        }
      }
    }
    setResumePrompt(null)
    setShowNewComparisonModal(true)
  }

  // ---------------------------------------------------------------------
  // Criar / selecionar comparação
  // ---------------------------------------------------------------------
  const handleCreateComparison = async (name: string) => {
    const comp = await window.electronAPI.createComparison(name)
    setCurrentComparison(comp)
    setDocumentPath(null)
    setDocumentText('')
    setAudioPath(null)
    setTranscribedText('')
    setComparison(null)
    setChunks([])
    setCurrentStep(1)
    setShowNewComparisonModal(false)
  }

  const openNewComparisonModal = async () => {
    // Se há uma transcrição em andamento, cancela antes de mudar
    if (currentComparison && isProcessing) {
      try {
        await window.electronAPI.cancelComparison(currentComparison.id!)
        const updated = await window.electronAPI.getComparison(currentComparison.id!)
        if (updated) setCurrentComparison(updated)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('Falha ao cancelar transcrição:', err)
      }
    }
    setShowNewComparisonModal(true)
  }

  // ---------------------------------------------------------------------
  // Documento (step 1)
  // ---------------------------------------------------------------------
  const handleSelectDocument = async () => {
    const path = await window.electronAPI.selectFile({
      filters: [{ name: 'Documentos', extensions: ['pdf', 'docx', 'txt'] }],
    })
    if (!path) return
    setPdfPageStart('')
    setPdfPageEnd('')
    const result = await window.electronAPI.readDocument(path)
    if (result.error) {
      setError(result.error)
      return
    }
    setError(null)
    setDocumentPath(path)
    setDocumentText(result.text)

    if (currentComparison) {
      const updated = await window.electronAPI.setComparisonDocument(
        currentComparison.id!,
        path,
        path.split('/').pop() || 'document',
        result.text
      )
      if (updated) setCurrentComparison(updated)
    }
  }

  const handleApplyPageRange = async () => {
    if (!documentPath) return
    const start = pdfPageStart === '' ? undefined : Number(pdfPageStart)
    const end = pdfPageEnd === '' ? undefined : Number(pdfPageEnd)
    const result = await window.electronAPI.readDocument(documentPath, {
      pageStart: start,
      pageEnd: end,
    })
    if (result.error) {
      setError(result.error)
      return
    }
    setError(null)
    setDocumentText(result.text)

    if (currentComparison) {
      const updated = await window.electronAPI.setComparisonDocument(
        currentComparison.id!,
        documentPath,
        documentPath.split('/').pop() || 'document',
        result.text
      )
      if (updated) setCurrentComparison(updated)
    }
  }

  // ---------------------------------------------------------------------
  // Áudio e transcrição (step 2)
  // ---------------------------------------------------------------------
  const handleSelectAudio = async () => {
    const path = await window.electronAPI.selectFile({
      filters: [{ name: 'Áudio', extensions: ['wav', 'mp3', 'ogg', 'm4a', 'flac'] }],
    })
    if (!path) return
    setAudioPath(path)
    setError(null)

    if (currentComparison) {
      const updated = await window.electronAPI.setComparisonAudio(
        currentComparison.id!,
        path,
        path.split('/').pop() || 'audio'
      )
      if (updated) setCurrentComparison(updated)
    }
  }

  const refreshChunks = useCallback(async (comparisonId: number) => {
    try {
      const cs = await window.electronAPI.getComparisonChunks(comparisonId)
      setChunks(cs)
    } catch {
      // ignore
    }
  }, [])

  const refreshComparison = useCallback(async (comparisonId: number) => {
    const updated = await window.electronAPI.getComparison(comparisonId)
    if (updated) setCurrentComparison(updated)
  }, [])

  /**
   * Sincroniza o input de `chunk_duration_s` com o main process. O main
   * aplica o clamp canônico e retorna o registro atualizado — usamos
   * esse valor clampado para re-sincronizar o state (a UI nunca confia
   * apenas no valor local, que poderia estar fora do range).
   */
  const handleChangeChunkDuration = useCallback(
    async (seconds: number) => {
      setChunkDurationS(seconds)
      if (!currentComparison) return
      try {
        const updated = await window.electronAPI.setComparisonChunkDuration(
          currentComparison.id!,
          seconds
        )
        if (updated) {
          setCurrentComparison(updated)
          setChunkDurationS(updated.chunk_duration_s ?? 30)
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('Falha ao persistir chunk_duration_s:', err)
      }
    },
    [currentComparison]
  )

  /**
   * Atualiza o número de chunks a processar no pré-teste. Não é
   * persistido (parâmetro da execução).
   */
  const handleChangeMaxChunks = useCallback((n: number) => {
    const safe = Number.isFinite(n) ? n : 0
    setMaxChunks(Math.max(0, Math.min(50, Math.floor(safe))))
  }, [])

  const handleTranscribe = async (maxChunksArg?: number) => {
    if (!currentComparison || !audioPath) return

    const effectiveMaxChunks =
      typeof maxChunksArg === 'number' ? maxChunksArg : maxChunks

    setIsProcessing(true)
    setProgress(0)
    setProgressMessage('')
    setError(null)
    setSuccessMessage(null)

    // Subscribe a eventos filtrados por esta comparação
    if (unsubEventRef.current) unsubEventRef.current()
    if (unsubProgressRef.current) unsubProgressRef.current()

    unsubEventRef.current = window.electronAPI.onPythonEvent((compId, event: PythonEvent) => {
      if (compId !== currentComparison.id) return
      if (event.type === 'progress') {
        setProgress(event.progress)
        setProgressMessage(event.message)
      } else if (event.type === 'chunk_start' || event.type === 'chunk_done' || event.type === 'chunk_error') {
        // Atualiza lista de chunks a partir do DB (fonte de verdade)
        void refreshChunks(currentComparison.id!)
      }
    })

    unsubProgressRef.current = window.electronAPI.onTranscriptionProgress((compId, p, msg) => {
      if (compId !== currentComparison.id) return
      setProgress(p)
      setProgressMessage(msg)
    })

    try {
      const result = await window.electronAPI.transcribeComparison(
        currentComparison.id!,
        selectedModel,
        documentText.slice(0, 2000),
        effectiveMaxChunks,
        chunkDurationS
      )
      // Limpa subscriptions
      unsubEventRef.current?.()
      unsubProgressRef.current?.()
      unsubEventRef.current = null
      unsubProgressRef.current = null

      // Recarrega estado do DB (status, diff, chunks)
      await refreshComparison(currentComparison.id!)
      await refreshChunks(currentComparison.id!)

      if (result.success) {
        if (result.partial) {
          // Pré-teste terminou — volta para a tela de áudio (step 2) com
          // a indicação de chunks já processados. Não transita para step 3.
          const done = chunks.filter((c) => c.status === 'done').length
          const totalEstimate = chunks[0]?.total_chunks ?? null
          setSuccessMessage(
            `Pré-teste concluído: ${done} chunk(s) processado(s).`
            + (totalEstimate != null ? ` Total estimado: ${totalEstimate}.` : '')
          )
          return
        }
        const updated = await window.electronAPI.getComparison(currentComparison.id!)
        if (updated) {
          if (updated.transcribed_text) setTranscribedText(updated.transcribed_text)
          if (updated.diff_result) {
            try {
              const diff = JSON.parse(updated.diff_result) as DiffItem[]
              setComparison({
                diff,
                accuracy: updated.accuracy_score ?? 0,
                originalText: updated.original_text ?? '',
                transcribedText: updated.transcribed_text ?? '',
              })
            } catch {
              // ignore
            }
          }
          setSuccessMessage('Transcrição concluída com sucesso.')
          setCurrentStep(3)
        }
      } else if (result.error && result.error !== 'Cancelado pelo usuário') {
        setError(result.error)
      }
      // Cancelado: silencioso (DB já marca como cancelled)
    } catch (err) {
      setError(`Erro: ${err}`)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleCancelTranscription = async () => {
    if (!currentComparison) return
    try {
      await window.electronAPI.cancelComparison(currentComparison.id!)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('Falha ao cancelar transcrição:', err)
    }
    unsubEventRef.current?.()
    unsubProgressRef.current?.()
    unsubEventRef.current = null
    unsubProgressRef.current = null
    setIsProcessing(false)
    await refreshComparison(currentComparison.id!)
    await refreshChunks(currentComparison.id!)
  }

  const handleCompareFromStep = () => {
    // Step 2 → step 3: usa o que já está no DB (chunks/transcrição parcial)
    if (!currentComparison) return
    if (currentComparison.diff_result) {
      try {
        const diff = JSON.parse(currentComparison.diff_result) as DiffItem[]
        setComparison({
          diff,
          accuracy: currentComparison.accuracy_score ?? 0,
          originalText: currentComparison.original_text ?? '',
          transcribedText: currentComparison.transcribed_text ?? '',
        })
      } catch {
        // ignore
      }
    }
    setCurrentStep(3)
  }

  // ---------------------------------------------------------------------
  // Step 3 — Resultado
  // ---------------------------------------------------------------------
  const handleLoadFromHistory = async (record: ComparisonRecord) => {
    setShowHistory(false)
    await loadComparison(record)
  }

  const handleViewChunkDetail = (chunk: ChunkRun) => {
    setSelectedChunk(chunk)
    setShowChunkDetail(true)
  }

  const handleRetryChunk = async (_chunkIndex: number) => {
    // Re-rodar a transcrição: o Python vai pular os chunks `done` via
    // checkpoint regenerado pelo Node, e re-tentar o que falhou.
    await handleTranscribe()
  }

  // ---------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------
  useEffect(() => {
    return () => {
      unsubEventRef.current?.()
      unsubProgressRef.current?.()
    }
  }, [])

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------
  if (bootLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-600">Carregando…</p>
        </div>
      </div>
    )
  }

  const showHeader = currentComparison !== null
  const lastDoneChunk = [...chunks].reverse().find((c) => c.status === 'done')

  /**
   * Total de chunks do áudio. Fonte prioritária: já processado pelo Python
   * (`chunks[0].total_chunks` é a fonte de verdade após a primeira passada).
   * Fallback: estimativa via duração do áudio (cada chunk = 30s, mesmo
   * valor default do `transcribe_gemma4.py --chunk-duration`). Usado para
   * exibir a contagem no UI antes da primeira transcrição.
   */
  const estimatedTotalChunks =
    chunks[0]?.total_chunks ??
    (audioDuration != null ? Math.max(1, Math.ceil(audioDuration / 30)) : null)

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header fixo */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary-600 rounded-lg flex items-center justify-center">
              <FileAudio className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Audio Text Compare</h1>
              <p className="text-sm text-gray-500">Compare transcrição com documento original</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {pythonStatus && (
              <div
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${
                  pythonStatus.ready
                    ? 'bg-green-100 text-green-700'
                    : 'bg-yellow-100 text-yellow-700'
                }`}
                title={pythonStatus.python || ''}
              >
                {pythonStatus.ready ? (
                  <CheckCircle className="w-4 h-4" />
                ) : (
                  <AlertCircle className="w-4 h-4" />
                )}
                {pythonStatus.ready ? 'Python pronto' : pythonStatus.message}
              </div>
            )}

            {currentComparison && (
              <button
                onClick={openNewComparisonModal}
                className="btn-secondary flex items-center gap-2"
                title="Iniciar uma nova comparação"
              >
                <Trash2 className="w-4 h-4" />
                Nova comparação
              </button>
            )}

            <button
              onClick={() => setShowSettings(true)}
              className="btn-secondary flex items-center gap-2"
              title="Configurações"
            >
              <Settings className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowHistory(!showHistory)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                showHistory
                  ? 'bg-primary-100 text-primary-700'
                  : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
              }`}
            >
              <History className="w-4 h-4" />
              Histórico
            </button>
          </div>
        </div>
      </header>

      <div className="flex">
        <main className={`flex-1 p-6 transition-all ${showHistory ? 'mr-96' : ''}`}>
          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 flex items-center gap-2 animate-fade-in">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span>{error}</span>
              <button
                onClick={() => setError(null)}
                className="ml-auto text-sm underline hover:no-underline"
              >
                Fechar
              </button>
            </div>
          )}

          {successMessage && (
            <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700 flex items-center gap-2">
              <CheckCircle className="w-5 h-5 shrink-0" />
              <span>{successMessage}</span>
            </div>
          )}

          {showHeader && currentComparison && (
            <ComparisonHeader
              name={currentComparison.name}
              status={currentComparison.status}
              currentStep={currentStep}
              lastChunkIndex={lastDoneChunk?.chunk_index ?? null}
              errorMessage={currentComparison.error_message}
            />
          )}

          {!currentComparison ? (
            <div className="card p-8 text-center text-gray-500 animate-fade-in">
              <FileAudio className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p>Nenhuma comparação selecionada.</p>
              <button
                onClick={openNewComparisonModal}
                className="btn-primary mt-4"
              >
                Nova comparação
              </button>
            </div>
          ) : (
            <>
              <StepIndicator currentStep={currentStep} />

              {currentStep === 1 && (
                <DocumentStep
                  documentPath={documentPath}
                  documentText={documentText}
                  pageStart={pdfPageStart}
                  pageEnd={pdfPageEnd}
                  onSelectDocument={handleSelectDocument}
                  onClearDocument={() => {
                    setDocumentPath(null)
                    setDocumentText('')
                    setPdfPageStart('')
                    setPdfPageEnd('')
                  }}
                  onChangePageStart={setPdfPageStart}
                  onChangePageEnd={setPdfPageEnd}
                  onApplyPages={handleApplyPageRange}
                  onNext={() => setCurrentStep(2)}
                />
              )}

              {currentStep === 2 && (
                <AudioStep
                  audioPath={audioPath}
                  audioDuration={audioDuration}
                  transcribedText={transcribedText}
                  selectedModel={selectedModel}
                  isProcessing={isProcessing}
                  progress={progress}
                  progressMessage={progressMessage}
                  chunkDurationS={chunkDurationS}
                  maxChunks={maxChunks}
                  onSelectAudio={handleSelectAudio}
                  onClearAudio={() => setAudioPath(null)}
                  onChangeModel={setSelectedModel}
                  onChangeChunkDuration={handleChangeChunkDuration}
                  onChangeMaxChunks={handleChangeMaxChunks}
                  onTranscribe={(n) => handleTranscribe(n)}
                  onCompare={handleCompareFromStep}
                  onBack={() => setCurrentStep(1)}
                  doneChunksCount={chunks.filter((c) => c.status === 'done').length}
                  totalChunksEstimate={estimatedTotalChunks}
                />
              )}

              {currentStep === 3 && (
                <ResultStep
                  comparison={comparison}
                  comparisonId={currentComparison?.id}
                  chunks={chunks}
                  onViewChunkDetail={handleViewChunkDetail}
                  onRetryChunk={handleRetryChunk}
                  onNewComparison={openNewComparisonModal}
                />
              )}
            </>
          )}
        </main>

        {showHistory && (
          <HistoryPanel
            onClose={() => setShowHistory(false)}
            onLoadComparison={handleLoadFromHistory}
          />
        )}
      </div>

      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
      />

      <TranscriptionModal
        isOpen={isProcessing}
        progress={progress}
        progressMessage={progressMessage}
        onCancel={handleCancelTranscription}
      />

      <NewComparisonModal
        isOpen={showNewComparisonModal}
        onClose={() => setShowNewComparisonModal(false)}
        onCreate={handleCreateComparison}
      />

      {resumePrompt && (
        <ResumePrompt
          comparisons={resumePrompt}
          onResume={handleResume}
          onDecline={handleDeclineResume}
        />
      )}

      <ChunkDetailModal
        chunk={selectedChunk}
        totalChunks={chunks.length || selectedChunk?.total_chunks || 1}
        isOpen={showChunkDetail}
        onClose={() => {
          setShowChunkDetail(false)
          setSelectedChunk(null)
        }}
        onRetry={handleRetryChunk}
      />
    </div>
  )
}

interface ResumePromptProps {
  comparisons: ComparisonRecord[]
  onResume: () => void
  onDecline: () => void
}

function ResumePrompt({ comparisons, onResume, onDecline }: ResumePromptProps) {
  const target = comparisons[0]
  const others = comparisons.length - 1
  const transcribingCount = comparisons.filter((c) => c.status === 'transcribing').length

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-fade-in">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center">
            <AlertCircle className="w-5 h-5 text-amber-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-900">Retomar comparação?</h2>
        </div>
        <p className="text-sm text-gray-600">
          Encontramos uma comparação em andamento:
        </p>
        <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
          <p className="text-sm font-medium text-gray-900">{target.name}</p>
          <p className="text-xs text-gray-500 mt-1">
            Status: {target.status === 'transcribing' ? 'transcrevendo' : 'pendente'}
            {transcribingCount > 1 && ` (${transcribingCount} em transcribing)`}
          </p>
          {target.document_path && (
            <p className="text-xs text-gray-500 mt-0.5">Doc: {target.document_name ?? '—'}</p>
          )}
          {target.audio_path && (
            <p className="text-xs text-gray-500 mt-0.5">Áudio: {target.audio_name ?? '—'}</p>
          )}
        </div>
        {transcribingCount > 0 && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
            <strong>Anti-zumbi:</strong> se você não retomar, a comparação em
            andamento será marcada como <em>erro</em> (o processo Python não
            está mais vivo).
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onDecline} className="btn-secondary">
            Não retomar
          </button>
          <button onClick={onResume} className="btn-primary">
            {others > 0 ? `Retomar (${comparisons.length})` : 'Retomar'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default App
