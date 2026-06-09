import { useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { Upload, FileCheck, X } from 'lucide-react'

interface FileDropzoneProps {
  icon: React.ReactNode
  title: string
  description: string
  acceptedTypes: string
  onFileSelect: () => void
  fileName?: string
  onClear?: () => void
}

export default function FileDropzone({
  icon,
  title,
  description,
  onFileSelect,
  fileName,
  onClear,
}: FileDropzoneProps) {
  const onDrop = useCallback(
    (_acceptedFiles: File[]) => {
      // No Electron renderer com contextIsolation, não temos acesso ao path
      // real do arquivo via drag-and-drop. Abrir o diálogo nativo é mais confiável.
      onFileSelect()
    },
    [onFileSelect]
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: false,
    noClick: true,
    noKeyboard: true,
  })

  return (
    <div
      {...getRootProps()}
      onClick={() => {
        if (!fileName) onFileSelect()
      }}
      className={`dropzone ${isDragActive ? 'dropzone-active' : ''} ${
        fileName ? 'border-green-400 bg-green-50 cursor-default' : 'cursor-pointer'
      }`}
    >
      <input {...getInputProps()} />

      {fileName ? (
        <div className="flex flex-col items-center gap-2 w-full">
          <div className="flex items-center gap-2">
            <FileCheck className="w-8 h-8 text-green-600" />
            {onClear && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onClear()
                }}
                className="p-1 hover:bg-green-200 rounded-full transition-colors"
                title="Remover arquivo"
              >
                <X className="w-4 h-4 text-green-700" />
              </button>
            )}
          </div>
          <span className="text-sm font-medium text-green-700 truncate max-w-full px-2">
            {fileName}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onFileSelect()
            }}
            className="text-xs text-primary-600 hover:text-primary-700 underline cursor-pointer"
          >
            Clique para trocar
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <div className="text-primary-500">{icon}</div>
          <div>
            <p className="font-medium text-gray-700">{title}</p>
            <p className="text-sm text-gray-500 mt-1">{description}</p>
          </div>
          <div className="flex items-center gap-1 text-sm text-primary-600">
            <Upload className="w-4 h-4" />
            <span>Selecionar arquivo</span>
          </div>
        </div>
      )}
    </div>
  )
}
