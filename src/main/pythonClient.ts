import { app } from 'electron'
import { spawn, spawnSync } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import type { ChildProcess } from 'child_process'
import type { PythonEvent } from '../renderer/types'

export interface TranscribeOptions {
  model?: string
  maxTokens?: number
  context?: string
}

export interface TranscribeResult {
  text: string
}

/** Resultado bruto do spawn de um script Python. */
interface SpawnResult {
  exitCode: number
  /** Última linha JSON do stdout (se for `result`). */
  resultText: string | null
  /** stdout bruto acumulado. Necessário para o caller extrair campos além
   *  de `text` (ex.: `segments` do Whisper, com timestamps palavra-a-palavra). */
  stdoutData: string
  /** stderr bruto acumulado (para mensagens de erro). */
  stderrRaw: string
}

/** Opções de spawn unificado. O caller (main/index.ts) faz a orquestração DB↔eventos. */
export interface SpawnScriptOptions {
  scriptName: string
  args: string[]
  onEvent: (event: PythonEvent) => void
}

function findExistingVenv(): string | null {
  const candidates = [
    path.join(app.getPath('userData'), 'python_env'),
    path.join(app.getPath('home'), 'Library/Application Support/audio-text-compare/python_env'),
    path.join(app.getPath('home'), 'Library/Application Support/Electron/python_env'),
    path.join(app.getPath('appData'), 'audio-text-compare/python_env'),
  ]
  for (const candidate of candidates) {
    const pythonPath = process.platform === 'win32'
      ? path.join(candidate, 'Scripts', 'python.exe')
      : path.join(candidate, 'bin', 'python')
    if (fs.existsSync(pythonPath)) {
      return candidate
    }
  }
  return null
}

export class PythonClient {
  private _venvDir: string | null = null
  private _isTranscribing = false
  private _transcriptionProc: ChildProcess | null = null
  private _killTimer: NodeJS.Timeout | null = null
  private _cancelRequested = false

  private get venvDir(): string {
    if (!this._venvDir) {
      const existing = findExistingVenv()
      this._venvDir = existing ?? path.join(app.getPath('userData'), 'python_env')
    }
    return this._venvDir
  }

  private get venvPythonPath(): string {
    if (process.platform === 'win32') {
      return path.join(this.venvDir, 'Scripts', 'python.exe')
    }
    return path.join(this.venvDir, 'bin', 'python')
  }

  private getSystemPythonPath(): string {
    if (process.platform === 'darwin' && fs.existsSync('/opt/homebrew/bin/python3.12')) {
      return '/opt/homebrew/bin/python3.12'
    }
    return 'python3.12'
  }

  private resolvePythonScript(name: string): string {
    // In dev mode, Python files are in src/main/python/ (project root)
    // In production, they are copied to dist/main/python/ by the build plugin
    const isDev = !!process.env.VITE_DEV_SERVER_URL
    if (isDev) {
      return path.join(process.cwd(), 'src/main/python', name)
    }
    return path.join(__dirname, '../python', name)
  }

  private getModelBaseDir(): string {
    // Models shipped inside the app package (extraResources) take priority.
    // In dev: project_root/assets/models
    // In production: app.resourcesPath/assets/models
    const isDev = !!process.env.VITE_DEV_SERVER_URL
    if (isDev) {
      return path.join(process.cwd(), 'assets', 'models')
    }
    return path.join(process.resourcesPath, 'assets', 'models')
  }

  private getWhisperModelDir(): string {
    const dir = path.join(this.getModelBaseDir(), 'whisper')
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  private getHuggingFaceCacheDir(): string {
    const dir = path.join(this.getModelBaseDir(), 'huggingface')
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  isVenvReady(): boolean {
    return fs.existsSync(this.venvPythonPath)
  }

  checkStatus(): { ready: boolean; python?: string; message: string } {
    if (!this.isVenvReady()) {
      return { ready: false, message: 'Ambiente Python não configurado' }
    }

    try {
      const version = spawnSync(this.venvPythonPath, ['--version'], {
        encoding: 'utf-8',
        timeout: 5000,
      })
      if (version.status === 0) {
        return {
          ready: true,
          python: this.venvPythonPath,
          message: `Python pronto (${version.stdout.trim() || version.stderr.trim()})`,
        }
      }
    } catch {
      // fall through
    }

    return { ready: false, message: 'Ambiente Python configurado mas não responde' }
  }

  async ensureVenvReady(): Promise<string> {
    if (this.isVenvReady()) {
      return this.venvPythonPath
    }

    const systemPython = this.getSystemPythonPath()
    const setupScript = this.resolvePythonScript('setup_venv.py')
    const requirementsPath = this.resolvePythonScript('requirements.txt')

    return new Promise((resolve, reject) => {
      const proc = spawn(
        systemPython,
        [
          setupScript,
          '--venv-dir', this.venvDir,
          '--python', systemPython,
          '--requirements', requirementsPath,
        ],
        { env: { ...process.env, PYTHONUNBUFFERED: '1' } }
      )

      let stdoutData = ''
      let stderrData = ''

      proc.stdout.on('data', (chunk: Buffer) => {
        stdoutData += chunk.toString('utf-8')
      })

      proc.stderr.on('data', (chunk: Buffer) => {
        stderrData += chunk.toString('utf-8')
      })

      proc.on('close', (code) => {
        const lastStdoutLine = stdoutData.trim().split(/\r?\n/).pop()
        if (code === 0 && lastStdoutLine) {
          try {
            const result = JSON.parse(lastStdoutLine)
            if (result.type === 'setup' && result.status === 'ready' && result.python) {
              resolve(result.python)
              return
            }
          } catch {
            // fall through to error
          }
        }

        const lastStderrLine = stderrData.trim().split(/\r?\n/).pop()
        let errorMessage = `Setup failed with code ${code}`
        if (lastStderrLine) {
          try {
            const err = JSON.parse(lastStderrLine)
            if (err.message) errorMessage = err.message
          } catch {
            errorMessage = stderrData.trim() || errorMessage
          }
        }
        reject(new Error(errorMessage))
      })

      proc.on('error', (err) => {
        reject(new Error(`Failed to spawn setup script: ${err.message}`))
      })
    })
  }

  /**
   * Resolve o caminho do checkpoint JSON para uma comparação. Path
   * namespaceado por `comparison_id` para que comparações distintas
   * nunca compartilhem arquivo.
   */
  getCheckpointPath(comparisonId: number): string {
    const checkpointsDir = path.join(app.getPath('userData'), 'transcription_checkpoints')
    fs.mkdirSync(checkpointsDir, { recursive: true })
    return path.join(checkpointsDir, `${comparisonId}.json`)
  }

  /**
   * Apaga o checkpoint de uma comparação. Chamado em `completed`, `error`,
   * `cancelled` e ao deletar a comparação.
   */
  deleteCheckpoint(comparisonId: number): void {
    const p = this.getCheckpointPath(comparisonId)
    try {
      if (fs.existsSync(p)) {
        fs.unlinkSync(p)
      }
    } catch {
      // ignore
    }
  }

  /**
   * Escreve o checkpoint a partir dos chunks `done` do DB. É a única
   * direção de escrita canônica: o Node é a fonte de verdade (DB), o
   * arquivo JSON é um derivado.
   *
   * O schema do checkpoint aqui é o que o `transcribe_gemma4.py` espera:
   * `{ audio, model, total_chunks, results: [<text por chunk>] }`.
   */
  writeCheckpointFromDoneChunks(
    comparisonId: number,
    audioPath: string,
    model: string,
    doneChunks: Array<{ chunk_index: number; text: string | null }>,
    totalChunks: number
  ): void {
    const ordered = [...doneChunks].sort((a, b) => a.chunk_index - b.chunk_index)
    const results = ordered.map((c) => c.text ?? '')
    const payload = {
      audio: audioPath,
      model,
      total_chunks: totalChunks,
      results,
    }
    const p = this.getCheckpointPath(comparisonId)
    try {
      fs.writeFileSync(p, JSON.stringify(payload, null, 2), 'utf-8')
    } catch (e) {
      // Não derruba a transcrição se o checkpoint não for gravável —
      // o Python vai simplesmente reprocessar tudo.
      // eslint-disable-next-line no-console
      console.warn(`Falha ao escrever checkpoint ${p}:`, e)
    }
  }

  /**
   * Spawna um script Python com buffer de linha no stderr e parsing
   * tolerante. Cada linha JSON vira um `PythonEvent` enviado para
   * `onEvent`. Resolve com `{ exitCode, resultText, stderrRaw }` quando
   * o processo termina.
   *
   * Implementa o requisito de **buffer de linha obrigatório** do plano:
   * eventos podem chegar fracionados em múltiplos `data` chunks, e
   * parsear `data` cru quebraria o JSON.
   */
  private async spawnScript(opts: SpawnScriptOptions): Promise<SpawnResult> {
    const venvPython = await this.ensureVenvReady()

    return new Promise((resolve) => {
      const proc = spawn(venvPython, [opts.scriptName, ...opts.args], {
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
      })
      this._transcriptionProc = proc
      this._cancelRequested = false

      let stdoutData = ''
      let stderrBuffer = ''
      let stderrRaw = ''

      proc.stdout.on('data', (chunk: Buffer) => {
        stdoutData += chunk.toString('utf-8')
      })

      // Buffer de linha: acumula `data` events e fatia por `\n`.
      // Sem isso, um `chunk_done` com texto longo pode chegar em dois
      // `data` chunks e o JSON.parse quebra no meio.
      proc.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8')
        stderrRaw += text
        stderrBuffer += text
        const lines = stderrBuffer.split(/\r?\n/)
        stderrBuffer = lines.pop() ?? ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          this.handleScriptLine(trimmed, opts.onEvent)
        }
      })

      proc.on('close', (code) => {
        this._isTranscribing = false
        this._transcriptionProc = null
        if (this._killTimer) {
          clearTimeout(this._killTimer)
          this._killTimer = null
        }

        // Flush do buffer de linha residual.
        if (stderrBuffer.trim()) {
          this.handleScriptLine(stderrBuffer.trim(), opts.onEvent)
          stderrBuffer = ''
        }

        // Tenta extrair a linha de resultado do stdout.
        let resultText: string | null = null
        const lastStdoutLine = stdoutData.trim().split(/\r?\n/).pop()
        if (code === 0 && lastStdoutLine) {
          try {
            const result = JSON.parse(lastStdoutLine)
            if (result.type === 'result' && typeof result.text === 'string') {
              resultText = result.text
            }
          } catch {
            // não era JSON — ignorar
          }
        }

        resolve({
          exitCode: code ?? -1,
          resultText,
          stdoutData,
          stderrRaw,
        })
      })

      proc.on('error', (err) => {
        this._isTranscribing = false
        this._transcriptionProc = null
        if (this._killTimer) {
          clearTimeout(this._killTimer)
          this._killTimer = null
        }
        resolve({
          exitCode: -1,
          resultText: null,
          stdoutData: '',
          stderrRaw: `spawn error: ${err.message}`,
        })
      })
    })
  }

  /**
   * Tenta parsear uma linha stderr como JSON e emitir como PythonEvent.
   * Linhas não-JSON são silenciosamente ignoradas (logs normais do Python,
   * warnings, etc.) — nunca derrubam o cliente.
   */
  private handleScriptLine(line: string, onEvent: (e: PythonEvent) => void): void {
    try {
      const parsed = JSON.parse(line)
      if (typeof parsed !== 'object' || parsed === null) return
      const type = parsed.type
      if (
        type === 'progress' ||
        type === 'chunk_start' ||
        type === 'chunk_done' ||
        type === 'chunk_error' ||
        type === 'error'
      ) {
        onEvent(parsed as PythonEvent)
      }
    } catch {
      // linha não-JSON: log do Python, warning, etc. Ignorar.
    }
  }

  /**
   * Inicia a transcrição de uma comparação (unificado Gemma/Whisper).
   * O caller (IPC handler) é responsável por orquestrar a persistência
   * DB ↔ eventos e por reagir ao `resultText` no sucesso.
   *
   * `maxChunks` (Gemma ou Whisper): quando > 0, processa só este número
   * de chunks novos e sai. Usado pelo modo "pré-teste" do UI.
   *
   * `chunkDurationS` (Gemma ou Whisper): duração em segundos de cada
   * chunk. Para Gemma é o tamanho real do chunk (passado via
   * `--chunk-duration`). Para Whisper é a janela do pré-teste
   * (multiplicada por `maxChunks` para definir `--clip-end-s`).
   */
  async transcribeComparison(opts: {
    comparisonId: number
    audioPath: string
    model: string
    context?: string
    checkpointPath: string
    maxChunks?: number
    chunkDurationS?: number
    onEvent: (event: PythonEvent) => void
  }): Promise<SpawnResult> {
    if (this._isTranscribing) {
      throw new Error('Uma transcrição já está em andamento. Aguarde ou cancele a anterior.')
    }
    this._isTranscribing = true

    try {
      const isWhisper = opts.model === 'whisper-large-v3'

      if (isWhisper) {
        const modelDir = this.getWhisperModelDir()
        const args: string[] = [
          '--audio', opts.audioPath,
          '--model-dir', modelDir,
          '--language', 'pt',
        ]
        if (opts.context && opts.context.trim()) {
          args.push('--context', opts.context.trim().slice(0, 2000))
        }
        if (opts.maxChunks && opts.maxChunks > 0) {
          // Fallback `?? 30` é obrigatório: sem ele, `chunkDurationS`
          // undefined faria o pré-teste virar transcrição completa
          // silenciosamente. O `chunkMath.clampChunkDuration` no IPC
          // handler garante que o valor já chega clampado aqui, mas o
          // `?? 30` é a rede de segurança.
          const dur = opts.chunkDurationS && opts.chunkDurationS > 0 ? opts.chunkDurationS : 30
          const clipEndS = opts.maxChunks * dur
          args.push('--clip-end-s', String(clipEndS))
        }
        return await this.spawnScript({
          scriptName: this.resolvePythonScript('transcribe_whisper.py'),
          args,
          onEvent: opts.onEvent,
        })
      }

      // Gemma
      const cacheDir = this.getHuggingFaceCacheDir()
      const args: string[] = [
        '--audio', opts.audioPath,
        '--max-tokens', '512',
        '--checkpoint-file', opts.checkpointPath,
        '--cache-dir', cacheDir,
      ]
      if (opts.model) {
        args.push('--model', opts.model)
      }
      if (opts.context && opts.context.trim()) {
        args.push('--context', opts.context.trim().slice(0, 2000))
      }
      if (opts.chunkDurationS && opts.chunkDurationS > 0) {
        args.push('--chunk-duration', String(opts.chunkDurationS))
      }
      if (opts.maxChunks && opts.maxChunks > 0) {
        args.push('--max-chunks', String(opts.maxChunks))
      }
      return await this.spawnScript({
        scriptName: this.resolvePythonScript('transcribe_gemma4.py'),
        args,
        onEvent: opts.onEvent,
      })
    } catch (err) {
      this._isTranscribing = false
      this._transcriptionProc = null
      throw err
    }
  }

  /**
   * Cancela a transcrição atual. Envia SIGTERM ao processo filho; se
   * não terminar em 5s, envia SIGKILL. A Promise retornada por
   * `transcribeComparison` resolve com `exitCode` ≠ 0.
   */
  cancel(): void {
    this._cancelRequested = true
    const proc = this._transcriptionProc
    if (!proc) return

    try {
      proc.kill('SIGTERM')
    } catch {
      // ignore
    }

    if (this._killTimer) clearTimeout(this._killTimer)
    this._killTimer = setTimeout(() => {
      const p = this._transcriptionProc
      if (p && !p.killed) {
        try {
          p.kill('SIGKILL')
        } catch {
          // ignore
        }
      }
    }, 5000)
  }

  /**
   * Lê a duração de um arquivo de áudio via script Python auxiliar.
   * Retorna `null` em caso de falha.
   */
  async getAudioDuration(audioPath: string): Promise<number | null> {
    try {
      const venvPython = await this.ensureVenvReady()
      const result = spawnSync(
        venvPython,
        [this.resolvePythonScript('get_audio_duration.py'), '--audio', audioPath],
        { encoding: 'utf-8', timeout: 30000 }
      )
      if (result.status !== 0) return null
      const lastLine = result.stdout.trim().split(/\r?\n/).pop() ?? ''
      try {
        const parsed = JSON.parse(lastLine)
        if (typeof parsed.duration === 'number') return parsed.duration
      } catch {
        // not JSON
      }
    } catch {
      // venv not ready
    }
    return null
  }

  /** True se uma transcrição está em andamento. */
  isBusy(): boolean {
    return this._isTranscribing
  }

  /** True se `cancel()` foi chamado para a comparação atual. */
  wasCancelRequested(): boolean {
    return this._cancelRequested
  }
}
