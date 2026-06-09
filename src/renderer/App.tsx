import { useState, useEffect } from 'react'
import { FileAudio, History, CheckCircle, AlertCircle, Trash2, Settings } from 'lucide-react'
import HistoryPanel from './components/HistoryPanel'
import SettingsModal from './components/SettingsModal'
import StepIndicator from './components/steps/StepIndicator'
import DocumentStep from './components/steps/DocumentStep'
import AudioStep from './components/steps/AudioStep'
import ResultStep from './components/steps/ResultStep'
import { ComparisonResult } from './types'

function App() {
  const [documentPath, setDocumentPath] = useState<string | null>(null)
  const [audioPath, setAudioPath] = useState<string | null>(null)
  const [documentText, setDocumentText] = useState('')
  const [transcribedText, setTranscribedText] = useState('')
  const [comparison, setComparison] = useState<ComparisonResult | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [progressMessage, setProgressMessage] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [pythonStatus, setPythonStatus] = useState<{ ready: boolean; python?: string; message: string } | null>(null)
  const [selectedModel, setSelectedModel] = useState('google/gemma-4-E2B-it')
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [hasHfToken, setHasHfToken] = useState(false)
  const [pdfPageStart, setPdfPageStart] = useState<number | ''>('')
  const [pdfPageEnd, setPdfPageEnd] = useState<number | ''>('')
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1)

  useEffect(() => {
    checkPython()
    checkHfToken()
  }, [])

  const checkPython = async () => {
    const status = await window.electronAPI.checkPythonStatus()
    setPythonStatus(status)
  }

  const checkHfToken = async () => {
    try {
      const value = await window.electronAPI.getSetting('hf_token')
      setHasHfToken(Boolean(value && value.trim()))
    } catch {
      setHasHfToken(false)
    }
  }

  const clearDocument = () => {
    setDocumentPath(null)
    setDocumentText('')
    setPdfPageStart('')
    setPdfPageEnd('')
    setComparison(null)
  }

  const clearAudio = () => {
    setAudioPath(null)
    setComparison(null)
  }

  const handleSelectDocument = async () => {
    const path = await window.electronAPI.selectFile({
      filters: [{ name: 'Documentos', extensions: ['pdf', 'docx', 'txt'] }],
    })
    if (path) {
      setDocumentPath(path)
      setPdfPageStart('')
      setPdfPageEnd('')
      const result = await window.electronAPI.readDocument(path)
      if (result.error) {
        setError(result.error)
      } else {
        setDocumentText(result.text)
        setError(null)
      }
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
    } else {
      setDocumentText(result.text)
      setError(null)
    }
  }

  const handleSelectAudio = async () => {
    const path = await window.electronAPI.selectFile({
      filters: [{ name: 'Áudio', extensions: ['wav', 'mp3', 'ogg', 'm4a', 'flac'] }],
    })
    if (path) {
      setAudioPath(path)
      setError(null)
    }
  }

  const handleTranscribe = async () => {
    if (!audioPath) return

    setIsProcessing(true)
    setProgress(0)
    setError(null)
    setSuccessMessage(null)

    const unsubscribe = window.electronAPI.onTranscriptionProgress((p, msg) => {
      setProgress(p)
      setProgressMessage(msg)
    })

    try {
      const transcription = await window.electronAPI.transcribeAudio(audioPath, selectedModel)
      unsubscribe()

      if (transcription.error) {
        setError(transcription.error)
        setIsProcessing(false)
        return
      }

      setTranscribedText(transcription.text)
      setProgress(80)
    } catch (err) {
      setError(`Erro: ${err}`)
    } finally {
      setIsProcessing(false)
      unsubscribe()
    }
  }

  const handleCompareFromStep = async () => {
    if (!documentText || !transcribedText) return

    setIsProcessing(true)
    setProgress(80)
    setError(null)

    try {
      const diff = await window.electronAPI.compareTexts(documentText, transcribedText)
      setProgress(100)

      const total = diff.length
      const correct = diff.filter((d: any) => d.type === 'equal').length
      const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0

      setComparison({
        diff,
        accuracy,
        originalText: documentText,
        transcribedText: transcribedText,
      })
      setCurrentStep(3)
    } catch (err) {
      setError(`Erro: ${err}`)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleSave = async () => {
    if (!comparison || !documentPath || !audioPath) return

    try {
      const id = await window.electronAPI.saveComparison({
        created_at: new Date().toISOString(),
        document_name: documentPath.split('/').pop() || 'document',
        audio_name: audioPath.split('/').pop() || 'audio',
        original_text: comparison.originalText,
        transcribed_text: comparison.transcribedText,
        diff_result: JSON.stringify(comparison.diff),
        accuracy_score: comparison.accuracy,
        model_used: selectedModel,
      })
      setSuccessMessage(`Comparação salva com sucesso! (ID: ${id})`)
      setTimeout(() => setSuccessMessage(null), 4000)
    } catch (err) {
      setError(`Erro ao salvar: ${err}`)
    }
  }

  const handleLoadComparison = (result: ComparisonResult) => {
    setComparison(result)
    setDocumentText(result.originalText)
    setTranscribedText(result.transcribedText)
    setCurrentStep(3)
  }

  const handleReset = () => {
    setDocumentPath(null)
    setAudioPath(null)
    setDocumentText('')
    setTranscribedText('')
    setComparison(null)
    setError(null)
    setSuccessMessage(null)
    setProgress(0)
    setCurrentStep(1)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
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
                {pythonStatus.ready ? 'Gemma/Python pronto' : pythonStatus.message}
              </div>
            )}
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${
                hasHfToken ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
              }`}
              title={hasHfToken ? 'HF Token configurado' : 'HF Token não configurado'}
            >
              {hasHfToken ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
              {hasHfToken ? 'HF Token configurado' : 'HF Token não configurado'}
            </div>
            <button
              onClick={handleReset}
              className="btn-secondary flex items-center gap-2"
              title="Limpar tudo"
            >
              <Trash2 className="w-4 h-4" />
              Limpar
            </button>
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
        {/* Main Content */}
        <main className={`flex-1 p-6 transition-all ${showHistory ? 'mr-96' : ''}`}>
          {/* Error */}
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

          {/* Success */}
          {successMessage && (
            <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700 flex items-center gap-2">
              <CheckCircle className="w-5 h-5 shrink-0" />
              <span>{successMessage}</span>
            </div>
          )}

          <StepIndicator currentStep={currentStep} />

          {currentStep === 1 && (
            <DocumentStep
              documentPath={documentPath}
              documentText={documentText}
              pageStart={pdfPageStart}
              pageEnd={pdfPageEnd}
              onSelectDocument={handleSelectDocument}
              onClearDocument={clearDocument}
              onChangePageStart={setPdfPageStart}
              onChangePageEnd={setPdfPageEnd}
              onApplyPages={handleApplyPageRange}
              onNext={() => setCurrentStep(2)}
            />
          )}

          {currentStep === 2 && (
            <AudioStep
              audioPath={audioPath}
              transcribedText={transcribedText}
              selectedModel={selectedModel}
              isHfTokenConfigured={hasHfToken}
              isProcessing={isProcessing}
              progress={progress}
              progressMessage={progressMessage}
              onSelectAudio={handleSelectAudio}
              onClearAudio={clearAudio}
              onChangeModel={setSelectedModel}
              onTranscribe={handleTranscribe}
              onCompare={handleCompareFromStep}
              onBack={() => setCurrentStep(1)}
            />
          )}

          {currentStep === 3 && (
            <ResultStep
              comparison={comparison}
              selectedModel={selectedModel}
              documentPath={documentPath}
              audioPath={audioPath}
              onSave={handleSave}
              onNewComparison={handleReset}
            />
          )}
        </main>

        {/* History Sidebar */}
        {showHistory && (
          <HistoryPanel
            onClose={() => setShowHistory(false)}
            onLoadComparison={handleLoadComparison}
          />
        )}
      </div>

      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        onSaved={checkHfToken}
      />
    </div>
  )
}

export default App
