import React from 'react'
import { DiffItem } from '../types'
import { Check, Plus, Minus, ArrowRightLeft, AlignLeft, Columns } from 'lucide-react'

interface ComparisonViewProps {
  diff: DiffItem[]
}

type ViewMode = 'side-by-side' | 'inline'

const ComparisonView: React.FC<ComparisonViewProps> = ({ diff }) => {
  const [viewMode, setViewMode] = React.useState<ViewMode>('side-by-side')

  const stats = {
    equal: diff.filter((d) => d.type === 'equal').length,
    added: diff.filter((d) => d.type === 'added').length,
    removed: diff.filter((d) => d.type === 'removed').length,
    changed: diff.filter((d) => d.type === 'changed').length,
  }

  const totalWords = stats.equal + stats.removed + stats.changed
  const totalTranscribed = stats.equal + stats.added + stats.changed

  return (
    <div className="space-y-4">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
          <div className="flex items-center justify-center gap-1 text-green-700 mb-1">
            <Check className="w-4 h-4" />
            <span className="font-bold text-lg">{stats.equal}</span>
          </div>
          <span className="text-xs text-green-600">Corretas</span>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
          <div className="flex items-center justify-center gap-1 text-red-700 mb-1">
            <Minus className="w-4 h-4" />
            <span className="font-bold text-lg">{stats.removed}</span>
          </div>
          <span className="text-xs text-red-600">Omitidas</span>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-center">
          <div className="flex items-center justify-center gap-1 text-blue-700 mb-1">
            <Plus className="w-4 h-4" />
            <span className="font-bold text-lg">{stats.added}</span>
          </div>
          <span className="text-xs text-blue-600">Adicionadas</span>
        </div>
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-center">
          <div className="flex items-center justify-center gap-1 text-yellow-700 mb-1">
            <ArrowRightLeft className="w-4 h-4" />
            <span className="font-bold text-lg">{stats.changed}</span>
          </div>
          <span className="text-xs text-yellow-600">Alteradas</span>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 text-sm bg-gray-50 rounded-lg p-3">
        <span className="font-medium text-gray-700">Legenda:</span>
        <span className="diff-equal px-2 py-1 rounded border border-transparent">Correto</span>
        <span className="diff-removed px-2 py-1 rounded border border-red-200">Omitido no áudio</span>
        <span className="diff-added px-2 py-1 rounded border border-blue-200">Adicionado no áudio</span>
        <span className="diff-changed px-2 py-1 rounded border border-yellow-200">Alterado</span>
      </div>

      {/* View Mode Toggle */}
      <div className="flex items-center justify-end gap-2">
        <span className="text-sm text-gray-500">Modo de visualização:</span>
        <div className="flex bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => setViewMode('side-by-side')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
              viewMode === 'side-by-side'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Columns className="w-4 h-4" />
            Lado a Lado
          </button>
          <button
            onClick={() => setViewMode('inline')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
              viewMode === 'inline'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <AlignLeft className="w-4 h-4" />
            Inline
          </button>
        </div>
      </div>

      {viewMode === 'side-by-side' ? (
        <div className="card bg-gray-50 border-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-800">Comparação Lado a Lado</h3>
            <div className="text-xs text-gray-500">
              Documento: {totalWords} palavras · Áudio: {totalTranscribed} palavras
            </div>
          </div>
          <div className="flex gap-6">
            {/* Original Column */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-3 pb-2 border-b border-gray-200">
                <div className="w-3 h-3 rounded-full bg-gray-400" />
                <h4 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">
                  Documento Original
                </h4>
              </div>
              <div className="leading-relaxed text-sm">
                {diff.map((item, idx) => {
                  if (item.type === 'equal')
                    return (
                      <span key={`orig-${idx}`} className="diff-equal">
                        {item.value}
                        {' '}
                      </span>
                    )
                  if (item.type === 'removed')
                    return (
                      <span key={`orig-${idx}`} className="diff-removed">
                        {item.value}
                        {' '}
                      </span>
                    )
                  if (item.type === 'changed')
                    return (
                      <span key={`orig-${idx}`} className="diff-removed">
                        {item.original}
                        {' '}
                      </span>
                    )
                  return null
                })}
              </div>
            </div>

            {/* Divider */}
            <div className="w-px bg-gray-300 shrink-0" />

            {/* Transcribed Column */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-3 pb-2 border-b border-gray-200">
                <div className="w-3 h-3 rounded-full bg-primary-500" />
                <h4 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">
                  Áudio Transcrito
                </h4>
              </div>
              <div className="leading-relaxed text-sm">
                {diff.map((item, idx) => {
                  if (item.type === 'equal')
                    return (
                      <span key={`trans-${idx}`} className="diff-equal">
                        {item.value}
                        {' '}
                      </span>
                    )
                  if (item.type === 'added')
                    return (
                      <span key={`trans-${idx}`} className="diff-added">
                        {item.value}
                        {' '}
                      </span>
                    )
                  if (item.type === 'changed')
                    return (
                      <span key={`trans-${idx}`} className="diff-changed">
                        {item.transcribed}
                        {' '}
                      </span>
                    )
                  return null
                })}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-800">Visualização Inline</h3>
            <div className="text-xs text-gray-500">Passe o mouse para ver detalhes</div>
          </div>
          <div className="leading-relaxed">
            {diff.map((item, idx) => {
              switch (item.type) {
                case 'equal':
                  return (
                    <span key={idx} className="text-gray-700">
                      {item.value}{' '}
                    </span>
                  )
                case 'added':
                  return (
                    <span key={idx} className="relative group inline">
                      <span className="diff-added">{item.value}</span>
                      <span className="absolute -top-7 left-0 bg-blue-600 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 shadow-lg">
                        Adicionado no áudio
                      </span>
                      {' '}
                    </span>
                  )
                case 'removed':
                  return (
                    <span key={idx} className="relative group inline">
                      <span className="diff-removed">{item.value}</span>
                      <span className="absolute -top-7 left-0 bg-red-600 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 shadow-lg">
                        Omitido no áudio
                      </span>
                      {' '}
                    </span>
                  )
                case 'changed':
                  return (
                    <span key={idx} className="relative group inline">
                      <span className="diff-changed">{item.transcribed}</span>
                      <span className="absolute -top-9 left-0 bg-yellow-600 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 shadow-lg">
                        Original: "{item.original}"
                      </span>
                      {' '}
                    </span>
                  )
                default:
                  return null
              }
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export default ComparisonView