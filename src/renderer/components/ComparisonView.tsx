import React, { useRef, useState, useEffect, useCallback } from 'react'
import {
  DiffItem,
  WhisperSegment,
} from '../types'
import {
  Check,
  Plus,
  Minus,
  ArrowRightLeft,
  AlignLeft,
  Columns,
  Play as PlayIcon,
  Square,
  RotateCcw,
} from 'lucide-react'

interface ComparisonViewProps {
  diff: DiffItem[]
  /** ID da comparação para buscar segments e áudio */
  comparisonId?: number
  /** Se o áudio está disponível para tocar */
  audioAvailable?: boolean
}

type ViewMode = 'side-by-side' | 'inline'

/**
 * Margem de segurança ANTES do trecho da palavra clicada, em segundos.
 * Ao clicar numa palavra, o player volta este tanto antes do início do
 * segmento para o usuário ouvir a frase completa (com contexto), não
 * só a palavra isolada. O auto-stop continua no `end` do segmento.
 */
const MARGIN_BEFORE_S = 5

const ComparisonView: React.FC<ComparisonViewProps> = ({
  diff,
  comparisonId,
  audioAvailable,
}) => {
  const [viewMode, setViewMode] = React.useState<ViewMode>('side-by-side')
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [wordTimings, setWordTimings] = useState<Array<{ start: number; end: number }> | null>(null)

  // Estado do player único
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [audioDuration, setAudioDuration] = useState(0)
  // Se veio de um clique em palavra, guarda o `end` para auto-parar lá
  const [autoStopAt, setAutoStopAt] = useState<number | null>(null)

  const stats = {
    equal: diff.filter((d) => d.type === 'equal').length,
    added: diff.filter((d) => d.type === 'added').length,
    removed: diff.filter((d) => d.type === 'removed').length,
    changed: diff.filter((d) => d.type === 'changed').length,
  }

  const totalWords = stats.equal + stats.removed + stats.changed
  const totalTranscribed = stats.equal + stats.added + stats.changed

  // Busca segments do Whisper
  useEffect(() => {
    if (!comparisonId || !audioAvailable) {
      return
    }
    window.electronAPI
      .getComparisonWhisperSegments(comparisonId)
      .then((segs) => {
        if (segs && segs.length > 0) {
          const timings = mapDiffToSegments(diff, segs)
          setWordTimings(timings)
        }
      })
      .catch(() => {
        // ignore
      })
  }, [comparisonId, audioAvailable, diff])

  // Listeners globais no <audio>: instalados UMA VEZ.
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onTime = () => {
      setCurrentTime(audio.currentTime)
      // Auto-stop se chegou no end programado
      setAutoStopAt((target) => {
        if (target != null && audio.currentTime >= target) {
          audio.pause()
          return null
        }
        return target
      })
    }
    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    const onLoaded = () => setAudioDuration(audio.duration || 0)
    const onEnded = () => {
      setIsPlaying(false)
      setAutoStopAt(null)
    }
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('loadedmetadata', onLoaded)
    audio.addEventListener('ended', onEnded)
    return () => {
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('loadedmetadata', onLoaded)
      audio.removeEventListener('ended', onEnded)
    }
  }, [])

  /**
   * Garante que o áudio está carregado com o `src` correto. Resolve
   * assim que os metadados estão prontos, ou imediatamente se já estavam.
   */
  const ensureLoaded = useCallback(async (): Promise<boolean> => {
    const audio = audioRef.current
    if (!audio || !comparisonId) return false
    const expectedSrc = `app-audio://${comparisonId}`
    // `audio.src` retorna a URL RESOLVIDA (ex.: "app-audio://5/" com barra
    // final), nunca idêntica à string atribuída. Comparação tolerante para
    // não reatribuir o src (e recarregar o áudio) a cada clique em palavra.
    const currentSrc = audio.src.replace(/\/+$/, '')
    if (currentSrc !== expectedSrc) {
      audio.src = expectedSrc
    }
    if (audio.readyState >= 1) return true
    return new Promise<boolean>((resolve) => {
      const onReady = () => {
        audio.removeEventListener('loadedmetadata', onReady)
        resolve(true)
      }
      audio.addEventListener('loadedmetadata', onReady)
      audio.load()
    })
  }, [comparisonId])

  /**
   * Toca o trecho do áudio referente a uma palavra do diff.
   * Começa `MARGIN_BEFORE_S` segundos ANTES do início do segmento (para
   * pegar a frase completa) e auto-pausa no fim do trecho.
   */
  const seekToWord = useCallback(
    async (wordIndex: number) => {
      const audio = audioRef.current
      if (!audio || !comparisonId) return
      const timing = wordTimings?.[wordIndex]
      if (!timing) return

      const start = Math.max(0, timing.start - MARGIN_BEFORE_S)
      const end = timing.end

      const ok = await ensureLoaded()
      if (!ok) return

      // Pausa ANTES do seek e só arma o auto-stop DEPOIS de posicionar o
      // currentTime. Se o auto-stop fosse armado antes, um `timeupdate`
      // residual da posição antiga (possivelmente > end) dispararia a
      // parada automática na hora e cancelaria o playback do trecho.
      audio.pause()
      audio.currentTime = start
      setCurrentTime(start)
      setAutoStopAt(end)
      setAudioDuration(audio.duration || 0)
      try {
        await audio.play()
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[Player] play() falhou', e)
      }
    },
    [wordTimings, comparisonId, ensureLoaded]
  )

  const togglePlay = useCallback(async () => {
    const audio = audioRef.current
    if (!audio || !comparisonId) return
    const ok = await ensureLoaded()
    if (!ok) return
    setAutoStopAt(null)
    if (audio.paused) {
      try {
        await audio.play()
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[Player] play() falhou', e)
      }
    } else {
      audio.pause()
    }
  }, [comparisonId, ensureLoaded])

  const stopPlayback = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.pause()
    audio.currentTime = 0
    setCurrentTime(0)
    setAutoStopAt(null)
  }, [])

  /**
   * Seek para um tempo arbitrário (clique na barra de progresso).
   */
  const seekTo = useCallback(async (seconds: number) => {
    const audio = audioRef.current
    if (!audio) return
    const ok = await ensureLoaded()
    if (!ok) return
    audio.currentTime = Math.max(0, Math.min(seconds, audio.duration || seconds))
    setCurrentTime(audio.currentTime)
    setAutoStopAt(null)
  }, [ensureLoaded])

  const hasTimings = wordTimings != null && wordTimings.length > 0
  const canUsePlayer = audioAvailable && !!comparisonId

  // Componente de palavra: NÃO adiciona nenhum elemento extra ao DOM.
  // O tempo do trecho fica apenas no `title` (tooltip nativo do browser) —
  // nada aparece no fluxo do texto, então o wrap das linhas é estável
  // mesmo antes/depois de `wordTimings` carregar.
  const WordWithPlay = ({
    item,
    idx,
    className,
    tooltip,
  }: {
    item: DiffItem
    idx: number
    className: string
    tooltip?: string
  }) => {
    const timing = hasTimings ? wordTimings[idx] : null
    const canPlay = hasTimings && timing != null
    // Mostra o intervalo que SERÁ tocado (já com a margem de 5s antes,
    // clampada em 0 para palavras no começo do áudio).
    const timeLabel = canPlay && timing
      ? `${formatTime(Math.max(0, timing.start - MARGIN_BEFORE_S))} – ${formatTime(timing.end)}`
      : null

    // Tooltip composto: tipo da palavra + tempo (se disponível)
    const fullTitle = [
      tooltip,
      canPlay ? `▶ ${timeLabel}` : null,
    ].filter(Boolean).join(' · ')

    return (
      <span
        onClick={() => {
          if (canPlay) void seekToWord(idx)
        }}
        title={fullTitle || 'Sem mapeamento de tempo (reprocesse a transcrição)'}
        className={`${className} ${
          canPlay ? 'cursor-pointer hover:underline decoration-dotted' : 'cursor-help'
        }`}
      >
        {item.value}{' '}
      </span>
    )
  }

  return (
    <div className="space-y-4">
      <audio ref={audioRef} preload="metadata" className="hidden" />

      {/* Player único de áudio — sempre visível. Altura fixa para não
          empurrar o texto abaixo quando o estado muda. */}
      <div className="card p-4 bg-white border border-gray-200 shadow-sm min-h-[88px]">
        <div className="flex items-center gap-4">
          {/* Botão play/stop — vira stop enquanto toca */}
          <button
            onClick={togglePlay}
            disabled={!canUsePlayer}
            className={`w-12 h-12 rounded-full text-white flex items-center justify-center shrink-0 transition-colors ${
              !canUsePlayer
                ? 'bg-gray-300 cursor-not-allowed'
                : isPlaying
                  ? 'bg-primary-700 hover:bg-primary-800'
                  : 'bg-primary-600 hover:bg-primary-700'
            }`}
            title={
              !canUsePlayer
                ? 'Áudio não disponível'
                : isPlaying
                  ? 'Parar'
                  : 'Tocar'
            }
          >
            {isPlaying ? (
              <Square className="w-5 h-5 fill-current" />
            ) : (
              <PlayIcon className="w-5 h-5 fill-current ml-0.5" />
            )}
          </button>

          {/* Bloco central: barra de progresso + tempos */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between text-xs text-gray-500 tabular-nums mb-1">
              <span className="font-mono">{formatTime(currentTime)}</span>
              <span className="font-mono">
                {audioDuration > 0
                  ? formatTime(audioDuration)
                  : (audioAvailable ? '—:—' : 'sem áudio')}
              </span>
            </div>
            {/* Barra de progresso clicável */}
            <div
              className="h-2 bg-gray-200 rounded-full overflow-hidden cursor-pointer relative"
              onClick={(e) => {
                if (!canUsePlayer || audioDuration <= 0) return
                const rect = e.currentTarget.getBoundingClientRect()
                const ratio = (e.clientX - rect.left) / rect.width
                void seekTo(ratio * audioDuration)
              }}
              title={canUsePlayer && audioDuration > 0 ? 'Clique para pular' : ''}
            >
              <div
                className="h-full bg-primary-500 transition-all pointer-events-none"
                style={{ width: `${audioDuration > 0 ? Math.min(100, (currentTime / audioDuration) * 100) : 0}%` }}
              />
              {/* Marcador da posição atual (bolinha) */}
              {audioDuration > 0 && (
                <div
                  className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-primary-700 rounded-full shadow pointer-events-none"
                  style={{ left: `calc(${Math.min(100, (currentTime / audioDuration) * 100)}% - 6px)` }}
                />
              )}
            </div>
            <div className="text-xs text-gray-500 mt-1.5 truncate h-4">
              {isPlaying
                ? '▶ Tocando…'
                : autoStopAt != null
                  ? `⏸ Pausado em ${formatTime(currentTime)} (parada automática no fim do trecho)`
                  : canUsePlayer
                    ? 'Pronto. Clique numa palavra marcada para tocar o trecho, ou use ▶.'
                    : audioAvailable
                      ? 'Áudio disponível, mas sem mapeamento de tempo. Reprocesse a transcrição.'
                      : 'Áudio não disponível para esta comparação.'}
            </div>
          </div>

          {/* Botão voltar ao início */}
          <button
            onClick={stopPlayback}
            disabled={!canUsePlayer || currentTime === 0}
            className="btn-secondary text-xs flex items-center gap-1.5 shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Voltar ao início"
          >
            <RotateCcw className="w-3 h-3" />
            Início
          </button>
        </div>
      </div>

      {/* Mensagem explicando o fluxo do player */}
      <div className={`p-3 rounded-lg border text-sm ${
        hasTimings
          ? 'bg-blue-50 border-blue-200 text-blue-800'
          : audioAvailable
            ? 'bg-amber-50 border-amber-200 text-amber-800'
            : 'bg-gray-50 border-gray-200 text-gray-700'
      }`}>
        {hasTimings ? (
          <>
            <strong>Como usar:</strong> passe o mouse sobre uma palavra omitida/adicionada/alterada
            para ver a faixa de tempo. <strong>Clique na palavra</strong> para
            pular o player até o trecho e tocar — a reprodução começa{' '}
            <strong>{MARGIN_BEFORE_S}s antes</strong> do trecho, para você ouvir
            a frase completa, e para automaticamente no fim dele.
          </>
        ) : audioAvailable ? (
          <>
            <strong>Sem mapeamento palavra↔tempo.</strong> Os segments do Whisper
            não foram salvos nesta comparação. Volte ao passo de áudio e clique
            em "Transcrever áudio" novamente para reprocessar.
          </>
        ) : (
          <strong>Áudio não disponível para esta comparação.</strong>
        )}
      </div>

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
        {hasTimings && (
          <span className="text-xs text-gray-500 ml-auto">
            Passe o mouse sobre as palavras marcadas para ouvir o trecho
          </span>
        )}
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
          {/* Cabeçalho das colunas */}
          <div className="grid grid-cols-2 gap-4 mb-2 pb-2 border-b border-gray-300">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-gray-400" />
              <h4 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">
                Documento Original
              </h4>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-primary-500" />
              <h4 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">
                Áudio Transcrito
              </h4>
            </div>
          </div>
          {/* Layout em grid 2-colunas: cada LINHA começa sempre num `equal`
              — ou seja, a primeira palavra da linha é a MESMA nas duas
              colunas. Palavras omitidas/adicionadas/alteradas NUNCA causam
              quebra: fluem inline dentro da linha corrente (cada uma na sua
              coluna). A quebra só acontece num ponto de sincronização
              (`equal`) e somente depois que a linha atingiu um tamanho
              alvo — assim o texto fica denso, sem uma linha por diferença. */}
          <div className="grid grid-cols-2 gap-x-4 text-sm leading-relaxed">
            {groupDiffIntoRows(diff).flatMap((row, rowIdx) => {
              // Coluna esquerda (documento): equal + removed + changed.original
              const leftContent = row
                .map(({ item, idx }) => {
                  if (item.type === 'equal') {
                    return (
                      <span key={idx} className="diff-equal">
                        {item.value}{' '}
                      </span>
                    )
                  }
                  if (item.type === 'removed') {
                    return (
                      <WordWithPlay
                        key={idx}
                        idx={idx}
                        item={item}
                        className="diff-removed"
                        tooltip="Omitido no áudio"
                      />
                    )
                  }
                  if (item.type === 'changed') {
                    return (
                      <span key={idx} className="diff-removed">
                        {item.original}{' '}
                      </span>
                    )
                  }
                  return null // `added` não aparece na coluna do documento
                })
                .filter(Boolean)

              // Coluna direita (áudio): equal + added + changed.value
              const rightContent = row
                .map(({ item, idx }) => {
                  if (item.type === 'equal') {
                    return (
                      <span key={idx} className="diff-equal">
                        {item.value}{' '}
                      </span>
                    )
                  }
                  if (item.type === 'added') {
                    return (
                      <WordWithPlay
                        key={idx}
                        idx={idx}
                        item={item}
                        className="diff-added"
                        tooltip="Adicionado no áudio"
                      />
                    )
                  }
                  if (item.type === 'changed') {
                    return (
                      <WordWithPlay
                        key={idx}
                        idx={idx}
                        item={item}
                        className="diff-changed"
                        tooltip={`Original: "${item.original}"`}
                      />
                    )
                  }
                  return null // `removed` não aparece na coluna do áudio
                })
                .filter(Boolean)

              // py-0.5 dá respiro vertical entre linhas. As células são
              // blocos normais para o texto poder quebrar internamente.
              return [
                <div key={`sl-${rowIdx}`} className="py-0.5">
                  {leftContent.length > 0 ? (
                    leftContent
                  ) : (
                    <span className="text-gray-300 select-none">·</span>
                  )}
                </div>,
                <div key={`sr-${rowIdx}`} className="py-0.5">
                  {rightContent.length > 0 ? (
                    rightContent
                  ) : (
                    <span className="text-gray-300 select-none">·</span>
                  )}
                </div>,
              ]
            })}
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-800">Visualização Inline</h3>
            <div className="text-xs text-gray-500">Passe o mouse para ver detalhes e ouvir</div>
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
                    <WordWithPlay
                      key={idx}
                      idx={idx}
                      item={item}
                      className="diff-added"
                      tooltip="Adicionado no áudio"
                    />
                  )
                case 'removed':
                  return (
                    <WordWithPlay
                      key={idx}
                      idx={idx}
                      item={item}
                      className="diff-removed"
                      tooltip="Omitido no áudio"
                    />
                  )
                case 'changed':
                  return (
                    <WordWithPlay
                      key={idx}
                      idx={idx}
                      item={item}
                      className="diff-changed"
                      tooltip={`Original: "${item.original}"`}
                    />
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

/**
 * Mapeia cada palavra do diff para o segmento do Whisper correspondente.
 */
function mapDiffToSegments(
  diff: DiffItem[],
  segments: WhisperSegment[]
): Array<{ start: number; end: number }> {
  const normalize = (s: string) =>
    s.toLowerCase().replace(/[\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim()
  const tokenize = (s: string) => normalize(s).split(/\s+/).filter((w) => w.length > 0)

  // Pré-calcula o acumulado de palavras por segmento
  const boundaries: number[] = []
  let cumulative = 0
  for (const seg of segments) {
    const segWords = tokenize(seg.text)
    cumulative += segWords.length
    boundaries.push(cumulative)
  }

  const findSegmentIndex = (wordIndex: number): number => {
    for (let i = 0; i < boundaries.length; i++) {
      if (wordIndex < boundaries[i]) return i
    }
    return Math.max(0, boundaries.length - 1)
  }

  const result: Array<{ start: number; end: number }> = []
  let transcribedWordCount = 0

  for (const item of diff) {
    if (item.type === 'removed') {
      const prevIndex = Math.max(0, transcribedWordCount - 1)
      const segIdx = findSegmentIndex(prevIndex)
      const seg = segments[segIdx] || segments[0] || { start: 0, end: 0 }
      result.push({ start: seg.start, end: seg.end })
    } else {
      const segIdx = findSegmentIndex(transcribedWordCount)
      const seg = segments[segIdx] || segments[segments.length - 1] || { start: 0, end: 0 }
      result.push({ start: seg.start, end: seg.end })
      transcribedWordCount++
    }
  }

  return result
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/**
 * Agrupa o diff em "linhas" para o layout side-by-side.
 *
 * Regras:
 *   - Uma linha só pode COMEÇAR num item `equal` (ponto de sincronização),
 *     garantindo que a primeira palavra da linha é a MESMA nas duas colunas.
 *   - Diferenças (removed/added/changed) NUNCA causam quebra: fluem inline
 *     dentro da linha corrente, cada uma na sua coluna.
 *   - A quebra acontece no primeiro `equal` encontrado DEPOIS que a linha
 *     atingiu `TARGET_WORDS_PER_ROW` itens — assim as linhas têm tamanho
 *     aproximadamente uniforme e o texto fica denso, em vez de gerar uma
 *     linha nova a cada diferença isolada.
 *   - Se uma sequência de diferenças atravessa o tamanho alvo, a linha
 *     simplesmente cresce até o próximo `equal` (nunca quebra no meio de
 *     uma diferença).
 *
 * Cada entrada carrega o índice original no `diff`, para o WordWithPlay
 * achar o timing certo sem precisar de `diff.indexOf` (O(n²)).
 */
type SideBySideRow = Array<{ item: DiffItem; idx: number }>

/** Tamanho alvo (em itens do diff) de cada linha do side-by-side. */
const TARGET_WORDS_PER_ROW = 12

function groupDiffIntoRows(diff: DiffItem[]): SideBySideRow[] {
  const rows: SideBySideRow[] = []
  let current: SideBySideRow = []

  diff.forEach((item, idx) => {
    // Quebra apenas num ponto de sincronização (`equal`) e somente quando
    // a linha atual já atingiu o tamanho alvo. O `equal` vira a PRIMEIRA
    // palavra da próxima linha — idêntica nas duas colunas.
    if (
      item.type === 'equal' &&
      current.length >= TARGET_WORDS_PER_ROW
    ) {
      rows.push(current)
      current = []
    }
    current.push({ item, idx })
  })

  if (current.length > 0) {
    rows.push(current)
  }
  return rows
}

export default ComparisonView
