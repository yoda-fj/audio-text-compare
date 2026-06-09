import { app } from 'electron'
import { spawn, spawnSync } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import { DatabaseManager } from './database'

export interface TranscribeOptions {
  model?: string
  maxTokens?: number
}

export interface TranscribeResult {
  text: string
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
  private db = new DatabaseManager()
  private _venvDir: string | null = null

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

  async downloadModel(
    model: string,
    options: { onProgress?: (progress: number, message: string) => void } = {}
  ): Promise<void> {
    const venvPython = await this.ensureVenvReady()
    const scriptPath = this.resolvePythonScript('download_model.py')

    const hfToken = this.db.getDecryptedSetting('hf_token')
    if (!hfToken) {
      throw new Error('Hugging Face Token não configurado.')
    }

    return new Promise((resolve, reject) => {
      const proc = spawn(
        venvPython,
        [scriptPath, '--model', model, '--hf-token-stdin'],
        { env: { ...process.env, PYTHONUNBUFFERED: '1' }, stdio: ['pipe', 'pipe', 'pipe'] }
      )

      if (proc.stdin) {
        proc.stdin.write(hfToken)
        proc.stdin.end()
      }

      proc.stdout.on('data', () => { /* ignore */ })

      let stderrBuffer = ''

      proc.stderr.on('data', (chunk: Buffer) => {
        stderrBuffer += chunk.toString('utf-8')
        const lines = stderrBuffer.split(/\r?\n/)
        stderrBuffer = lines.pop() ?? ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          try {
            const parsed = JSON.parse(trimmed)
            if (parsed.type === 'progress' && typeof parsed.progress === 'number' && options.onProgress) {
              options.onProgress(parsed.progress, parsed.message || '')
            }
            if (parsed.type === 'error') {
              reject(new Error(parsed.message || 'Download failed'))
              proc.kill()
              return
            }
          } catch { /* ignore non-JSON */ }
        }
      })

      proc.on('close', (code) => {
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`Download failed with code ${code}`))
        }
      })

      proc.on('error', (err) => {
        reject(new Error(`Failed to spawn download: ${err.message}`))
      })
    })
  }

  async transcribe(
    audioPath: string,
    options: TranscribeOptions & { onProgress?: (progress: number, message: string) => void }
  ): Promise<TranscribeResult> {
    const hfToken = this.db.getDecryptedSetting('hf_token')
    if (!hfToken) {
      throw new Error('Hugging Face Token não configurado. Configure em Configurações.')
    }

    const venvPython = await this.ensureVenvReady()
    const scriptPath = this.resolvePythonScript('transcribe_gemma4.py')

    const args: string[] = [
      scriptPath,
      '--audio', audioPath,
      '--max-tokens', String(options.maxTokens ?? 512),
      '--hf-token-stdin',
    ]

    if (options.model) {
      args.push('--model', options.model)
    }

    return new Promise((resolve, reject) => {
      const proc = spawn(
        venvPython,
        args,
        { env: { ...process.env, PYTHONUNBUFFERED: '1' }, stdio: ['pipe', 'pipe', 'pipe'] }
      )

      if (proc.stdin) {
        proc.stdin.write(hfToken)
        proc.stdin.end()
      }

      let stdoutData = ''
      let stderrBuffer = ''

      proc.stdout.on('data', (chunk: Buffer) => {
        stdoutData += chunk.toString('utf-8')
      })

      proc.stderr.on('data', (chunk: Buffer) => {
        stderrBuffer += chunk.toString('utf-8')
        const lines = stderrBuffer.split(/\r?\n/)
        stderrBuffer = lines.pop() ?? ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          try {
            const parsed = JSON.parse(trimmed)
            if (parsed.type === 'progress' && typeof parsed.progress === 'number' && options.onProgress) {
              options.onProgress(parsed.progress, parsed.message || '')
            }
          } catch {
            // Ignore non-JSON lines
          }
        }
      })

      proc.on('close', (code) => {
        // Flush remaining stderr buffer
        if (stderrBuffer.trim()) {
          try {
            const parsed = JSON.parse(stderrBuffer.trim())
            if (parsed.type === 'progress' && typeof parsed.progress === 'number' && options.onProgress) {
              options.onProgress(parsed.progress, parsed.message || '')
            }
          } catch {
            // ignore
          }
        }

        const lastStdoutLine = stdoutData.trim().split(/\r?\n/).pop()
        if (code === 0 && lastStdoutLine) {
          try {
            const result = JSON.parse(lastStdoutLine)
            if (result.type === 'result' && typeof result.text === 'string') {
              resolve({ text: result.text })
              return
            }
          } catch {
            // fall through
          }
        }

        const lastStderrLine = stderrBuffer.trim().split(/\r?\n/).pop() || ''
        let errorMessage = `Transcription failed with code ${code}`
        if (lastStderrLine) {
          try {
            const err = JSON.parse(lastStderrLine)
            if (err.message) errorMessage = err.message
          } catch {
            errorMessage = stderrBuffer.trim() || stdoutData.trim() || errorMessage
          }
        }
        reject(new Error(errorMessage))
      })

      proc.on('error', (err) => {
        reject(new Error(`Failed to spawn transcription script: ${err.message}`))
      })
    })
  }
}
