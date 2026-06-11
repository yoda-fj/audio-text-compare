import React, { useState, useEffect } from 'react'
import { X, Trash2, Clock, FileText, FileAudio, Percent, ChevronRight, RotateCcw } from 'lucide-react'
import { ComparisonRecord } from '../types'

interface HistoryPanelProps {
  onClose: () => void
  /**
   * Carrega uma comparação do histórico. Recebe o `ComparisonRecord`
   * completo; o caller (App.tsx) é responsável por popular o estado da
   * UI a partir dele, incluindo a busca de chunks.
   */
  onLoadComparison?: (record: ComparisonRecord) => void
}

const HistoryPanel: React.FC<HistoryPanelProps> = ({ onClose, onLoadComparison }) => {
  const [comparisons, setComparisons] = useState<ComparisonRecord[]>([])
  const [selectedComparison, setSelectedComparison] = useState<ComparisonRecord | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    loadComparisons()
  }, [])

  const loadComparisons = async () => {
    setIsLoading(true)
    try {
      const data = await window.electronAPI.getComparisons()
      setComparisons(data || [])
    } catch (err) {
      console.error('Erro ao carregar histórico:', err)
      setComparisons([])
    } finally {
      setIsLoading(false)
    }
  }

  const handleDelete = async (id: number) => {
    await window.electronAPI.deleteComparison(id)
    if (selectedComparison?.id === id) setSelectedComparison(null)
    loadComparisons()
  }

  const handleSelect = async (id: number) => {
    const comparison = await window.electronAPI.getComparison(id)
    setSelectedComparison(comparison ?? null)
  }

  /**
   * Restaura a comparação no painel principal. No novo modelo, basta
   * passar o record para o App.tsx — ele se encarrega de popular o
   * estado, incluindo a busca de chunks.
   */
  const handleRestore = () => {
    if (!selectedComparison || !onLoadComparison) return
    onLoadComparison(selectedComparison)
    onClose()
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const getStatusBadge = (status: ComparisonRecord['status']) => {
    switch (status) {
      case 'pending':
        return { label: 'Pendente', className: 'bg-gray-100 text-gray-700 border-gray-300' }
      case 'transcribing':
        return { label: 'Em andamento', className: 'bg-amber-100 text-amber-800 border-amber-300' }
      case 'completed':
        return { label: 'Concluída', className: 'bg-green-100 text-green-800 border-green-300' }
      case 'error':
        return { label: 'Erro', className: 'bg-red-100 text-red-800 border-red-300' }
      case 'cancelled':
        return { label: 'Cancelada', className: 'bg-gray-100 text-gray-700 border-gray-300' }
      default:
        return { label: status, className: 'bg-gray-100 text-gray-700 border-gray-300' }
    }
  }

  const getAccuracyColor = (score: number | null) => {
    if (score == null) return 'text-gray-500 bg-gray-50 border-gray-200'
    if (score >= 90) return 'text-green-600 bg-green-50 border-green-200'
    if (score >= 70) return 'text-yellow-600 bg-yellow-50 border-yellow-200'
    return 'text-red-600 bg-red-50 border-red-200'
  }

  return (
    <>
      <div className="sidebar-overlay" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-96 bg-white border-l border-gray-200 shadow-xl overflow-y-auto z-50 flex flex-col">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between z-10">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-gray-500" />
            <h2 className="text-lg font-semibold text-gray-900">Histórico</h2>
            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
              {comparisons.length}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={loadComparisons}
              className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
              title="Atualizar"
            >
              <RotateCcw className="w-4 h-4 text-gray-500" />
            </button>
            <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>
        </div>

        <div className="flex-1 p-4 space-y-3">
          {isLoading ? (
            <div className="text-center py-8 text-gray-500">
              <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              <p>Carregando...</p>
            </div>
          ) : comparisons.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Clock className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p className="font-medium">Nenhuma comparação salva</p>
              <p className="text-sm mt-1">As comparações aparecerão aqui</p>
            </div>
          ) : (
            comparisons.map((comp) => {
              const statusBadge = getStatusBadge(comp.status)
              return (
                <div
                  key={comp.id}
                  className={`border rounded-lg p-3 cursor-pointer transition-all ${
                    selectedComparison?.id === comp.id
                      ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-500'
                      : 'border-gray-200 hover:border-gray-300 hover:shadow-sm'
                  }`}
                  onClick={() => handleSelect(comp.id!)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <FileText className="w-4 h-4 text-gray-400 shrink-0" />
                        <span className="text-sm font-medium truncate">{comp.name}</span>
                      </div>
                      <div className="flex items-center gap-2 mb-2">
                        <FileAudio className="w-4 h-4 text-gray-400 shrink-0" />
                        <span className="text-sm text-gray-600 truncate">
                          {comp.audio_name ?? comp.document_name ?? '—'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs flex-wrap">
                        {comp.accuracy_score != null && (
                          <span
                            className={`flex items-center gap-1 px-2 py-0.5 rounded-full border font-medium ${getAccuracyColor(
                              comp.accuracy_score
                            )}`}
                          >
                            <Percent className="w-3 h-3" />
                            {comp.accuracy_score}%
                          </span>
                        )}
                        <span
                          className={`flex items-center gap-1 px-2 py-0.5 rounded-full border font-medium ${statusBadge.className}`}
                        >
                          {statusBadge.label}
                        </span>
                        {comp.model_used && (
                          <>
                            <span className="text-gray-400">·</span>
                            <span className="text-gray-500">{comp.model_used}</span>
                          </>
                        )}
                        <span className="text-gray-400">·</span>
                        <span className="text-gray-500">{formatDate(comp.created_at)}</span>
                      </div>
                      {comp.error_message && (
                        <p className="text-xs text-red-600 mt-1 truncate" title={comp.error_message}>
                          {comp.error_message}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {selectedComparison?.id === comp.id && onLoadComparison && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleRestore()
                          }}
                          className="p-1.5 bg-primary-100 hover:bg-primary-200 rounded-lg text-primary-700 transition-colors"
                          title="Carregar no painel principal"
                        >
                          <RotateCcw className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDelete(comp.id!)
                        }}
                        className="p-1.5 hover:bg-red-100 rounded-lg text-gray-400 hover:text-red-600 transition-colors"
                        title="Excluir"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {selectedComparison?.id === comp.id && (
                    <div className="mt-3 pt-3 border-t border-gray-200">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                          Visualização resumida
                        </span>
                        {onLoadComparison && (
                          <button
                            onClick={handleRestore}
                            className="text-xs flex items-center gap-1 text-primary-600 hover:text-primary-700 font-medium"
                          >
                            <ChevronRight className="w-3 h-3" />
                            Carregar no painel
                          </button>
                        )}
                      </div>
                      {comp.original_text && (
                        <div className="text-sm text-gray-700 line-clamp-3">
                          {comp.original_text.substring(0, 200)}
                          {comp.original_text.length > 200 && '...'}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>
    </>
  )
}

export default HistoryPanel
