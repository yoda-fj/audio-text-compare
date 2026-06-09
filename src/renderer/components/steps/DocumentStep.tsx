import { FileText, ArrowRight, BookOpen } from 'lucide-react'
import FileDropzone from '../FileDropzone'

interface DocumentStepProps {
  documentPath: string | null
  documentText: string
  pageStart: number | ''
  pageEnd: number | ''
  onSelectDocument: () => void
  onClearDocument: () => void
  onChangePageStart: (val: number | '') => void
  onChangePageEnd: (val: number | '') => void
  onApplyPages: () => void
  onNext: () => void
}

export default function DocumentStep({
  documentPath,
  documentText,
  pageStart,
  pageEnd,
  onSelectDocument,
  onClearDocument,
  onChangePageStart,
  onChangePageEnd,
  onApplyPages,
  onNext,
}: DocumentStepProps) {
  return (
    <div className="animate-fade-in space-y-6">
      <FileDropzone
        icon={<FileText className="w-8 h-8" />}
        title="Documento Original"
        description="Arraste ou clique para selecionar PDF, DOCX ou TXT"
        acceptedTypes=".pdf,.docx,.txt"
        onFileSelect={() => onSelectDocument()}
        fileName={documentPath?.split('/').pop()}
        onClear={onClearDocument}
      />

      {documentPath && (
        <div className="card p-4 space-y-4">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-primary-600" />
            <span className="text-sm font-medium text-gray-700">
              Intervalo de páginas
            </span>
          </div>
          <p className="text-xs text-gray-500">
            Funciona nativamente para PDF. Para TXT, o arquivo deve conter quebras
            de página (\f). DOCX extrai o texto completo.
          </p>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-1">
                Página inicial
              </label>
              <input
                type="number"
                min={1}
                value={pageStart}
                onChange={(e) =>
                  onChangePageStart(
                    e.target.value === '' ? '' : Number(e.target.value)
                  )
                }
                placeholder="1"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-sm"
              />
            </div>
            <span className="text-gray-400 pt-5">até</span>
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-1">
                Página final
              </label>
              <input
                type="number"
                min={1}
                value={pageEnd}
                onChange={(e) =>
                  onChangePageEnd(
                    e.target.value === '' ? '' : Number(e.target.value)
                  )
                }
                placeholder="última"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-sm"
              />
            </div>
            <button onClick={onApplyPages} className="btn-primary text-sm mt-5">
              Aplicar
            </button>
          </div>
        </div>
      )}

      {documentText && (
        <div className="card p-4 space-y-3">
          <label className="block text-sm font-medium text-gray-700">
            Texto extraído do documento
          </label>
          <textarea
            readOnly
            value={documentText}
            className="w-full h-40 px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-sm font-mono resize-y focus:outline-none"
          />
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={onNext}
          disabled={!documentText}
          className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Próximo
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
