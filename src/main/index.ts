import { app, BrowserWindow, ipcMain, dialog, protocol } from 'electron'
import path from 'path'
import { DatabaseManager } from './database'
import { FileProcessor } from './fileProcessor'
import { PythonClient } from './pythonClient'
import { clampChunkDuration, computeClipEndS } from './chunkMath'
import type { ChunkRun, ComparisonRecord, PythonEvent } from '../renderer/types'

app.setName('audio-text-compare')

let mainWindow: BrowserWindow | null = null
const db = new DatabaseManager()
const fileProcessor = new FileProcessor()
const pythonClient = new PythonClient()

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  // Protocolo customizado para servir arquivos de áudio ao renderer de
  // forma segura. O renderer usa `app-audio://<comparisonId>` — o main
  // resolve o `audio_path` do banco e valida que o arquivo existe antes
  // de servir. Isso evita expor o sistema de arquivos arbitrariamente.
  protocol.registerFileProtocol('app-audio', (request, callback) => {
    const url = new URL(request.url)
    const comparisonId = parseInt(url.hostname, 10)
    if (Number.isNaN(comparisonId)) {
      callback({ error: -6 }) // net::ERR_FILE_NOT_FOUND
      return
    }
    const comp = db.getComparison(comparisonId)
    if (!comp?.audio_path) {
      callback({ error: -6 })
      return
    }
    try {
      const fs = require('fs')
      if (!fs.existsSync(comp.audio_path)) {
        callback({ error: -6 })
        return
      }
    } catch {
      callback({ error: -6 })
      return
    }
    callback({ path: comp.audio_path })
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

/** Envia um PythonEvent para o renderer (filtra por comparisonId). */
function sendPythonEvent(comparisonId: number, event: PythonEvent) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('python-event', comparisonId, event)
}

/** Envia um progresso legada (progress 0-100, message) para o renderer. */
function sendProgress(comparisonId: number, progress: number, message: string) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('transcription-progress', comparisonId, progress, message)
}

// ---------------------------------------------------------------------
// IPC: arquivos / documento / comparação legada
// ---------------------------------------------------------------------

ipcMain.handle('select-file', async (_, options) => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile'],
    filters: options.filters,
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('read-document', async (_, filePath: string, options?: { pageStart?: number; pageEnd?: number }) => {
  return fileProcessor.readDocument(filePath, options)
})

ipcMain.handle('compare-texts', async (_, original: string, transcribed: string) => {
  return fileProcessor.compareTexts(original, transcribed)
})

ipcMain.handle('save-comparison', async (_, data) => {
  return db.saveComparison(data)
})

ipcMain.handle('get-comparisons', async () => {
  return db.getComparisons()
})

ipcMain.handle('get-comparison', async (_, id: number) => {
  return db.getComparison(id)
})

ipcMain.handle('delete-comparison', async (_, id: number) => {
  db.deleteComparison(id)
  pythonClient.deleteCheckpoint(id)
})

ipcMain.handle('save-setting', async (_, key: string, value: string) => {
  return db.saveEncryptedSetting(key, value)
})

ipcMain.handle('get-setting', async (_, key: string) => {
  return db.getDecryptedSetting(key)
})

ipcMain.handle('check-python-status', async () => {
  return pythonClient.checkStatus()
})

ipcMain.handle('get-whisper-model-status', async () => {
  return { downloaded: pythonClient.isWhisperModelDownloaded() }
})

ipcMain.handle('download-whisper-model', async () => {
  await pythonClient.downloadWhisperModel({
    onEvent: (event) => {
      if (event.type === 'progress') {
        sendWhisperDownloadProgress(event.progress, event.message)
      } else if (event.type === 'error') {
        sendWhisperDownloadProgress(0, event.message)
      }
    },
  })
  return { downloaded: pythonClient.isWhisperModelDownloaded() }
})

/**
 * Envia progresso do download do Whisper para o renderer.
 */
function sendWhisperDownloadProgress(progress: number, message: string) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('whisper-download-progress', progress, message)
}

/**
 * Lê a duração (em segundos) de um arquivo de áudio via script Python.
 * Retorna `null` em caso de falha (venv indisponível, formato não suportado).
 * Usado pela UI para exibir "≈ N min, M chunks estimados" no passo de áudio.
 */
ipcMain.handle('get-audio-duration', async (_, audioPath: string): Promise<number | null> => {
  return pythonClient.getAudioDuration(audioPath)
})

// ---------------------------------------------------------------------
// IPC: diff com chunks (v4)
// ---------------------------------------------------------------------

ipcMain.handle('get-comparison-diff-chunks', async (_, id: number) => {
  return db.getComparisonDiffChunks(id)
})

ipcMain.handle('get-comparison-audio-info', async (_, id: number) => {
  const comp = db.getComparison(id)
  if (!comp?.audio_path) {
    return { available: false, reason: 'Áudio original não disponível para esta comparação' }
  }
  try {
    const fs = require('fs')
    if (!fs.existsSync(comp.audio_path)) {
      return { available: false, reason: `Arquivo de áudio não encontrado em ${comp.audio_path}` }
    }
  } catch {
    return { available: false, reason: 'Erro ao verificar arquivo de áudio' }
  }
  return { available: true }
})

// ---------------------------------------------------------------------
// IPC: whisper segments (v5)
// ---------------------------------------------------------------------

ipcMain.handle('get-comparison-whisper-segments', async (_, id: number) => {
  return db.getComparisonWhisperSegments(id)
})

// ---------------------------------------------------------------------
// IPC: fluxo de "comparação como projeto"
// ---------------------------------------------------------------------

ipcMain.handle('create-comparison', async (_, name: string): Promise<ComparisonRecord> => {
  const trimmed = (name ?? '').trim()
  if (!trimmed) {
    throw new Error('Nome da comparação é obrigatório')
  }
  return db.createComparison(trimmed)
})

ipcMain.handle('get-active-comparisons', async (): Promise<ComparisonRecord[]> => {
  return db.getActiveComparisons()
})

ipcMain.handle('set-comparison-document', async (
  _,
  id: number,
  documentPath: string,
  documentName: string,
  documentText: string
): Promise<ComparisonRecord | undefined> => {
  db.setComparisonDocument(id, documentPath, documentName, documentText)
  return db.getComparison(id)
})

ipcMain.handle('set-comparison-audio', async (
  _,
  id: number,
  audioPath: string,
  audioName: string
): Promise<ComparisonRecord | undefined> => {
  db.setComparisonAudio(id, audioPath, audioName)
  return db.getComparison(id)
})

/**
 * Persiste a duração de chunk configurada pelo usuário. Aplica o clamp
 * canônico [5, 120]s antes de gravar. Retorna o registro atualizado
 * (com o valor já clampado) para que o renderer sincronize o input.
 */
ipcMain.handle('set-comparison-chunk-duration', async (
  _,
  id: number,
  seconds: number
): Promise<ComparisonRecord | undefined> => {
  const clamped = clampChunkDuration(seconds)
  db.setComparisonChunkDuration(id, clamped)
  return db.getComparison(id)
})

ipcMain.handle('get-comparison-chunks', async (_, id: number): Promise<ChunkRun[]> => {
  // Mapear do shape do DB (start_s/end_s) para o shape do renderer
  // (chunk_start_s/chunk_end_s) — a UI nunca deve saber do schema.
  return db.getChunksForComparison(id).map((c) => ({
    id: c.id,
    comparison_id: c.comparison_id,
    chunk_index: c.chunk_index,
    total_chunks: c.total_chunks,
    chunk_start_s: c.start_s,
    chunk_end_s: c.end_s,
    status: c.status,
    text: c.text,
    error_message: c.error_message,
    duration_ms: c.duration_ms,
    created_at: c.created_at,
    updated_at: c.updated_at,
  }))
})

/**
 * Marca uma comparação "transcribing" órfã (sem processo vivo) como
 * "error". Chamado no boot pelo renderer ao recusar a retomada. Evita
 * o estado zumbi descrito na seção 4 do plano.
 */
ipcMain.handle('mark-comparison-error', async (
  _,
  id: number,
  errorMessage: string
): Promise<ComparisonRecord | undefined> => {
  db.setComparisonStatus(id, 'error', errorMessage)
  db.resetInFlightChunks(id)
  pythonClient.deleteCheckpoint(id)
  return db.getComparison(id)
})

/**
 * Cancela uma transcrição em andamento. Mata o processo, marca in-flight
 * chunks como `pending`, status da comparação = `cancelled`, apaga o
 * checkpoint. Idempotente: se não houver processo vivo, só ajusta o DB.
 */
ipcMain.handle('cancel-comparison', async (_, id: number): Promise<ComparisonRecord | undefined> => {
  const current = db.getComparison(id)
  if (!current) return undefined

  if (pythonClient.isBusy()) {
    pythonClient.cancel()
  }
  db.resetInFlightChunks(id)
  db.setComparisonStatus(id, 'cancelled', null)
  pythonClient.deleteCheckpoint(id)
  return db.getComparison(id)
})

/**
 * Inicia/retoma a transcrição de uma comparação. Orquestra a
 * persistência DB↔eventos Python e o checkpoint derivado.
 *
 * O Renderer recebe dois tipos de mensagens:
 *   - `python-event` (evento estruturado)
 *   - `transcription-progress` (progresso genérico, mantido por
 *     compatibilidade com a TranscriptionModal)
 *
 * O Promise do handler resolve com `{ success, error? }` — usado pelo
 * renderer para fechar a modal e transitar de step.
 */
ipcMain.handle(
  'transcribe-comparison',
  async (
    _,
    id: number,
    model: string,
    context?: string,
    maxChunks?: number,
    chunkDurationS?: number
  ): Promise<{ success: boolean; partial?: boolean; error?: string }> => {
    const comparison = db.getComparison(id)
    if (!comparison) {
      return { success: false, error: `Comparação ${id} não encontrada` }
    }
    if (!comparison.audio_path) {
      return { success: false, error: 'Áudio não definido para esta comparação' }
    }
    if (!comparison.document_path) {
      // Gemma/Whisper podem funcionar sem contexto, mas o fluxo da UI
      // exige o documento. Bloqueia cedo com mensagem clara.
      return { success: false, error: 'Documento não definido para esta comparação' }
    }

    // Persistir o modelo (caso o usuário tenha trocado) antes de iniciar.
    if (comparison.model_used !== model) {
      db.setComparisonModel(id, model)
    }

    // Fallback defensivo do `chunk_duration_s`: o caller primário é o
    // IPC setter (chamado no onChange do input). Aqui só reescrevemos
    // se o valor divergir do já persistido (ex.: comparação legada
    // com NULL) e foi explicitamente fornecido nesta chamada.
    if (chunkDurationS != null && chunkDurationS !== comparison.chunk_duration_s) {
      db.setComparisonChunkDuration(id, clampChunkDuration(chunkDurationS))
    }

    db.setComparisonStatus(id, 'transcribing', null)
    db.resetInFlightChunks(id)

    const isWhisper = model === 'whisper-large-v3'
    const isPretest = typeof maxChunks === 'number' && maxChunks > 0
    const checkpointPath = pythonClient.getCheckpointPath(id)

    // Duração do áudio (em segundos) é necessária no pré-spawn do Whisper
    // para calcular o `chunk_end_s` do chunk sintético. `null` quando a
    // leitura Python falhar — nesse caso usamos 0 e o usuário verá 0s
    // no UI (cenário raro; geralmente há fallback de getAudioDuration).
    const fullDuration = (await pythonClient.getAudioDuration(comparison.audio_path)) ?? 0
    // `chunkEndS`: para Whisper pré-teste é a janela de pré-teste; para
    // os demais casos (Whisper full / Gemma) é a duração completa.
    const chunkEndS = isWhisper
      ? computeClipEndS(fullDuration, maxChunks ?? 0, chunkDurationS ?? comparison.chunk_duration_s)
      : fullDuration

    // -----------------------------------------------------------------
    // Pre-spawn
    // -----------------------------------------------------------------
    if (isWhisper) {
      // Whisper: 1 chunk sintético cobrindo o intervalo efetivo
      // (chunkEndS). No pré-teste, é a janela [0, chunkEndS]; no full,
      // é a duração completa. O Python não emite eventos de chunk
      // (apenas progresso segmento a segmento); o Node sintetiza o
      // ciclo de vida.
      db.upsertChunk({
        comparison_id: id,
        chunk_index: 0,
        total_chunks: 1,
        start_s: 0,
        end_s: chunkEndS,
        status: 'transcribing',
        text: null,
        error_message: null,
        duration_ms: null,
      })
      sendPythonEvent(id, {
        type: 'chunk_start',
        chunk_index: 0,
        chunk_start_s: 0,
        chunk_end_s: chunkEndS,
        total_chunks: 1,
        progress: 5,
        message: 'Iniciando transcrição (Whisper)...',
      })
      // Checkpoint "fantasma" para que a UI antiga ainda mostre progresso
      // antes do primeiro evento real. Apagado em sucesso/erro.
    } else {
      // Gemma: regenera o checkpoint a partir dos chunks `done` do DB.
      // Esta é a única escrita canônica: o Node é a fonte de verdade.
      const done = db.getDoneChunks(id)
      if (done.length > 0) {
        const total = done[done.length - 1].total_chunks || done.length
        pythonClient.writeCheckpointFromDoneChunks(id, comparison.audio_path, model, done, total)
      } else {
        // Nova transcrição: garante que não há lixo de uma execução anterior
        pythonClient.deleteCheckpoint(id)
      }
    }

    // -----------------------------------------------------------------
    // Spawn + persistência
    // -----------------------------------------------------------------
    // Map de chunk_index → última mensagem de erro vista. Usar Map evita
    // o problema do TS narrow type narrowing dentro de closures.
    const lastChunkErrors = new Map<number, string>()

    const spawnResult = await pythonClient.transcribeComparison({
      comparisonId: id,
      audioPath: comparison.audio_path,
      model,
      context,
      checkpointPath,
      maxChunks: isPretest ? maxChunks : undefined,
      chunkDurationS: chunkDurationS ?? comparison.chunk_duration_s ?? undefined,
      onEvent: (event) => {
        sendPythonEvent(id, event)

        switch (event.type) {
          case 'progress': {
            sendProgress(id, event.progress, event.message)
            break
          }
          case 'chunk_start': {
            db.upsertChunk({
              comparison_id: id,
              chunk_index: event.chunk_index,
              total_chunks: event.total_chunks,
              start_s: event.chunk_start_s,
              end_s: event.chunk_end_s,
              status: 'transcribing',
              text: null,
              error_message: null,
              duration_ms: null,
            })
            break
          }
          case 'chunk_done': {
            db.setChunkResult(id, event.chunk_index, {
              status: 'done',
              text: event.text,
              duration_ms: event.duration_ms,
            })
            break
          }
          case 'chunk_error': {
            db.setChunkResult(id, event.chunk_index, {
              status: 'error',
              error_message: event.error_message,
            })
            lastChunkErrors.set(event.chunk_index, event.error_message)
            break
          }
          case 'error': {
            // Erro genérico sem chunk_index — fica registrado em error_message
            // da comparação no `proc.on('close')` se for fatal.
            break
          }
        }
      },
    })

    // -----------------------------------------------------------------
    // Reação ao exit
    // -----------------------------------------------------------------
    const cancelled = pythonClient.wasCancelRequested()
    if (cancelled) {
      // cancel-comparison já tratou o DB (status='cancelled', chunks
      // resetados, checkpoint apagado). Nada a fazer aqui.
      return { success: false, error: 'Cancelado pelo usuário' }
    }

    // Detecta pré-teste: o Python marca o payload com `pretest: true` quando
    // terminou por --max-chunks/--clip-end-s e ainda há chunks pendentes.
    let pretestDetected = false
    if (spawnResult.exitCode === 0 && spawnResult.resultText !== null) {
      const lastStdoutLine = spawnResult.stderrRaw
        .split(/\r?\n/)
        .map((l) => l.trim())
        .reverse()
        .find((l) => l.startsWith('{'))
      if (lastStdoutLine) {
        try {
          const parsed = JSON.parse(lastStdoutLine)
          if (parsed?.pretest === true) pretestDetected = true
        } catch {
          // ignore
        }
      }
    }

    if (isWhisper) {
      if (spawnResult.exitCode === 0 && spawnResult.resultText !== null) {
        // Whisper terminou OK: marca o chunk sintético como done.
        db.setChunkResult(id, 0, {
          status: 'done',
          text: spawnResult.resultText,
          duration_ms: null,
        })

        // Extrai segments do resultado do Whisper (se houver). O JSON de
        // resultado com `text` + `segments` vem no STDOUT (não stderr),
        // por isso usamos `spawnResult.stdoutData` e pegamos a última
        // linha (a `resultText` é a mesma string, então é a linha final).
        try {
          const lastStdoutLine = spawnResult.stdoutData
            .trim()
            .split(/\r?\n/)
            .pop()
          if (lastStdoutLine) {
            const parsed = JSON.parse(lastStdoutLine)
            if (parsed?.segments && Array.isArray(parsed.segments)) {
              db.setComparisonWhisperSegments(id, parsed.segments)
            }
          }
        } catch {
          // ignore: segments são opcionais (script pode omitir)
        }

        if (pretestDetected) {
          // Pré-teste Whisper: NÃO finaliza a comparação. Mantém
          // status 'pending' para que a próxima execução (full)
          // continue de onde parou. O upsertChunk com o novo end_s
          // (duração completa) na próxima chamada sobrescreve o
          // chunk sintético automaticamente.
          db.setComparisonStatus(id, 'pending', null)
          return { success: true, partial: true }
        }
        await finalizeComparison(id, spawnResult.resultText)
        return { success: true }
      }
      // Erro do Whisper
      const lastWhisperError = [...lastChunkErrors.values()].pop()
      const msg = lastWhisperError
        ?? spawnResult.stderrRaw.trim().split(/\r?\n/).pop()
        ?? `Whisper saiu com código ${spawnResult.exitCode}`
      db.setChunkResult(id, 0, { status: 'error', error_message: msg })
      db.setComparisonStatus(id, 'error', msg)
      pythonClient.deleteCheckpoint(id)
      return { success: false, error: msg }
    }

    // Gemma — pré-teste terminou antes do áudio inteiro
    if (pretestDetected) {
      // Mantém a comparação em 'pending' (não em 'completed') e mantém o
      // checkpoint em disco para que a próxima execução (full) continue
      // do chunk N+1. O usuário volta para a tela de áudio com a
      // indicação "X chunks processados" e pode escolher continuar.
      db.setComparisonStatus(id, 'pending', null)
      return { success: true, partial: true }
    }

    // Gemma — transcrição completa OK
    if (spawnResult.exitCode === 0 && spawnResult.resultText !== null) {
      await finalizeComparison(id, spawnResult.resultText)
      return { success: true }
    }

    // Falha do Gemma
    let errorMessage: string
    if (lastChunkErrors.size > 0) {
      const lastIdx = [...lastChunkErrors.keys()].pop()!
      const lastMsg = lastChunkErrors.get(lastIdx)!
      errorMessage = `Chunk ${lastIdx + 1}: ${lastMsg}`
    } else {
      const lastStderr = spawnResult.stderrRaw.trim().split(/\r?\n/).pop() || ''
      errorMessage = lastStderr || `Transcrição saiu com código ${spawnResult.exitCode}`
    }
    db.setComparisonStatus(id, 'error', errorMessage)
    pythonClient.deleteCheckpoint(id)
    return { success: false, error: errorMessage }
  }
)

/**
 * Monta o diff e persiste a comparação como `completed`. Chamado em
 * qualquer transcrição bem-sucedida (Gemma ou Whisper).
 */
async function finalizeComparison(comparisonId: number, transcribedText: string) {
  const comp = db.getComparison(comparisonId)
  if (!comp || !comp.original_text) {
    // Caso degenerado: sem texto original não há como comparar.
    db.setComparisonResult(comparisonId, transcribedText, '[]', 0)
    pythonClient.deleteCheckpoint(comparisonId)
    return
  }
  const diff = fileProcessor.compareTexts(comp.original_text, transcribedText)
  const accuracy = fileProcessor.calculateAccuracy(diff)
  db.setComparisonResult(comparisonId, transcribedText, JSON.stringify(diff), accuracy)

  // Diff com chunks (v4): opcional, nunca deve quebrar a finalização
  try {
    const chunks = db.getChunksForComparison(comparisonId)
    const diffWithChunks = fileProcessor.compareTextsWithChunks(
      comp.original_text,
      transcribedText,
      chunks.map((c) => ({ chunkIndex: c.chunk_index, text: c.text ?? '' }))
    )
    db.setComparisonDiffChunks(comparisonId, diffWithChunks)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('Falha ao gerar diff com chunks (não crítico):', err)
  }

  pythonClient.deleteCheckpoint(comparisonId)
}
