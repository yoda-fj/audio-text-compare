import Database from 'better-sqlite3'
import path from 'path'
import { app, safeStorage } from 'electron'
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'
import * as os from 'os'

// Prefixo para identificar qual método de criptografia foi usado
const STORAGE_PREFIX_SAFE = 0x01
const STORAGE_PREFIX_FALLBACK = 0x02

function getFallbackKey(): Buffer {
  // Deriva uma chave AES-256 a partir de dados específicos da máquina/usuário.
  // Isso protege contra leitura casual do banco, mas não contra alguém com
  // acesso ao código-fonte + banco (aceitável para desenvolvimento/fallback).
  const salt = Buffer.from('ATC-v1-fallback-salt', 'utf-8')
  const material = `${app.getPath('userData')}:${os.hostname()}:${process.env.USER || 'user'}`
  return scryptSync(material, salt, 32)
}

function encryptWithFallback(plaintext: string): Buffer {
  const key = getFallbackKey()
  const iv = randomBytes(16) // AES-256-CBC usa IV de 16 bytes
  const cipher = createCipheriv('aes-256-cbc', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()])
  return Buffer.concat([Buffer.from([STORAGE_PREFIX_FALLBACK]), iv, encrypted])
}

function decryptWithFallback(data: Buffer): string {
  if (data.length < 17 || data[0] !== STORAGE_PREFIX_FALLBACK) {
    throw new Error('Dados criptografados inválidos (fallback)')
  }
  const key = getFallbackKey()
  const iv = data.subarray(1, 17)
  const encrypted = data.subarray(17)
  const decipher = createDecipheriv('aes-256-cbc', key, iv)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf-8')
}

// Vocabulário único de status de comparação. Mantido em sincronia com
// o type `ComparisonStatus` exportado em `renderer/types.ts`.
export type ComparisonStatus =
  | 'pending'
  | 'transcribing'
  | 'completed'
  | 'error'
  | 'cancelled'

export type ChunkStatus = 'pending' | 'transcribing' | 'done' | 'error'

export interface ComparisonRecord {
  id?: number
  created_at: string
  updated_at: string
  name: string
  status: ComparisonStatus
  document_path: string | null
  audio_path: string | null
  // Campos legados (mantidos para a UI exibir o resultado salvo no modelo v1).
  // Para comparações v2 (criadas depois da migração), podem ser NULL até a
  // transcrição/conclusão ser persistida.
  document_name: string | null
  audio_name: string | null
  original_text: string | null
  transcribed_text: string | null
  diff_result: string | null
  accuracy_score: number | null
  model_used: string | null
  error_message: string | null
  /**
   * Duração configurada de cada chunk em segundos. Usada tanto pelo Gemma
   * (tamanho real do chunk) quanto pelo Whisper (janela do pré-teste via
   * `clip_timestamps`). NULL para comparações legadas; o renderer e o
   * `computeClipEndS` aplicam `?? 30` como default.
   */
  chunk_duration_s: number | null
}

export interface ChunkRecord {
  id?: number
  comparison_id: number
  chunk_index: number
  total_chunks: number
  start_s: number
  end_s: number
  status: ChunkStatus
  text: string | null
  error_message: string | null
  duration_ms: number | null
  created_at: string
  updated_at: string
}

export class DatabaseManager {
  private db: Database.Database

  constructor() {
    const dbPath = path.join(app.getPath('userData'), 'comparisons.db')
    this.db = new Database(dbPath)
    this.db.pragma('foreign_keys = ON')
    this.migrate()
  }

  /**
   * Aplica migrações aditivas com base em PRAGMA user_version. Cada
   * migração roda dentro de uma transação; falha ⇒ rollback e o
   * user_version permanece na versão anterior.
   *
   * Os `ALTER TABLE ADD COLUMN` da v2 são gerados dinamicamente a partir
   * de `PRAGMA table_info`, então a migração é **idempotente** mesmo
   * quando os campos já foram parcialmente aplicados (ex.: banco
   * deixado num estado intermediário por uma execução anterior abortada,
   * ou `user_version` regredido manualmente).
   */
  private migrate(): void {
    const currentVersion = (this.db.pragma('user_version', { simple: true }) as number) || 0

    if (currentVersion < 1) {
      this.db.transaction(() => {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS comparisons (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL,
            document_name TEXT NOT NULL,
            audio_name TEXT NOT NULL,
            original_text TEXT NOT NULL,
            transcribed_text TEXT NOT NULL,
            diff_result TEXT NOT NULL,
            accuracy_score REAL NOT NULL,
            model_used TEXT NOT NULL
          );

          CREATE INDEX IF NOT EXISTS idx_created_at ON comparisons(created_at);

          CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value BLOB NOT NULL
          );

          PRAGMA user_version = 1;
        `)
      })()
    }

    if (currentVersion < 2) {
      this.db.transaction(() => {
        const existing = this.getColumnNames('comparisons')

        // Constrói apenas os ALTERs para colunas que ainda não existem.
        // SQLite não suporta `ADD COLUMN IF NOT EXISTS`, então checamos via
        // PRAGMA table_info. Mantém a migração idempotente em bancos
        // parcialmente migrados.
        const alters: string[] = []
        if (!existing.has('updated_at')) {
          alters.push('ALTER TABLE comparisons ADD COLUMN updated_at TEXT')
        }
        if (!existing.has('name')) {
          alters.push('ALTER TABLE comparisons ADD COLUMN name TEXT')
        }
        if (!existing.has('status')) {
          alters.push(
            "ALTER TABLE comparisons ADD COLUMN status TEXT NOT NULL DEFAULT 'completed'"
          )
        }
        if (!existing.has('document_path')) {
          alters.push('ALTER TABLE comparisons ADD COLUMN document_path TEXT')
        }
        if (!existing.has('audio_path')) {
          alters.push('ALTER TABLE comparisons ADD COLUMN audio_path TEXT')
        }
        if (!existing.has('error_message')) {
          alters.push('ALTER TABLE comparisons ADD COLUMN error_message TEXT')
        }
        if (alters.length > 0) {
          this.db.exec(alters.join(';\n') + ';')
        }

        // Backfill idempotente: o WHERE filtra apenas as linhas que ainda
        // precisam do valor, então é seguro rodar múltiplas vezes.
        this.db.exec(`
          UPDATE comparisons SET name = 'Comparação ' || id WHERE name IS NULL;
          UPDATE comparisons SET updated_at = created_at WHERE updated_at IS NULL;

          CREATE TABLE IF NOT EXISTS chunks (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            comparison_id   INTEGER NOT NULL REFERENCES comparisons(id) ON DELETE CASCADE,
            chunk_index     INTEGER NOT NULL,
            total_chunks    INTEGER NOT NULL,
            start_s         REAL    NOT NULL,
            end_s           REAL    NOT NULL,
            status          TEXT    NOT NULL DEFAULT 'pending',
            text            TEXT,
            error_message   TEXT,
            duration_ms     INTEGER,
            created_at      TEXT    NOT NULL,
            updated_at      TEXT    NOT NULL,
            UNIQUE (comparison_id, chunk_index)
          );

          CREATE INDEX IF NOT EXISTS idx_chunks_comparison ON chunks(comparison_id);

          PRAGMA user_version = 2;
        `)
      })()
    }

    if (currentVersion < 3) {
      // v3: adiciona `chunk_duration_s` à tabela `comparisons`.
      // Idempotente via `getColumnNames` (mesma estratégia da v2).
      this.db.transaction(() => {
        const existing = this.getColumnNames('comparisons')
        if (!existing.has('chunk_duration_s')) {
          this.db.exec(
            'ALTER TABLE comparisons ADD COLUMN chunk_duration_s INTEGER'
          )
        }
        this.db.exec('PRAGMA user_version = 3;')
      })()
    }

    if (currentVersion < 4) {
      // v4: adiciona `diff_result_chunks` (JSON do diff com índice de chunk)
      // e `audio_path` (caminho absoluto do áudio, pode já existir da v2).
      this.db.transaction(() => {
        const existing = this.getColumnNames('comparisons')
        if (!existing.has('diff_result_chunks')) {
          this.db.exec(
            'ALTER TABLE comparisons ADD COLUMN diff_result_chunks TEXT'
          )
        }
        // audio_path já foi adicionado na v2 — aqui é defensivo caso o
        // banco tenha sido criado numa versão intermediária.
        if (!existing.has('audio_path')) {
          this.db.exec('ALTER TABLE comparisons ADD COLUMN audio_path TEXT')
        }
        this.db.exec('PRAGMA user_version = 4;')
      })()
    }

    if (currentVersion < 5) {
      // v5: adiciona `whisper_segments_json` para guardar os segments
      // com timestamps do Whisper (mapeamento preciso palavra → tempo).
      this.db.transaction(() => {
        const existing = this.getColumnNames('comparisons')
        if (!existing.has('whisper_segments_json')) {
          this.db.exec(
            'ALTER TABLE comparisons ADD COLUMN whisper_segments_json TEXT'
          )
        }
        this.db.exec('PRAGMA user_version = 5;')
      })()
    }
  }

  /**
   * Retorna o conjunto de nomes de colunas de uma tabela. Lê via
   * `PRAGMA table_info`, que existe desde o início do SQLite.
   */
  private getColumnNames(table: string): Set<string> {
    const rows = this.db.pragma(`table_info(${table})`) as Array<{ name: string }>
    return new Set(rows.map((r) => r.name))
  }

  private nowIso(): string {
    return new Date().toISOString()
  }

  /** Mantém `updated_at` consistente em todo write. */
  private touchComparison(id: number): void {
    this.db
      .prepare('UPDATE comparisons SET updated_at = ? WHERE id = ?')
      .run(this.nowIso(), id)
  }

  // ---------------------------------------------------------------------
  // Settings (criptografados) — inalterados
  // ---------------------------------------------------------------------

  saveEncryptedSetting(key: string, plaintext: string): void {
    let encrypted: Buffer
    if (safeStorage.isEncryptionAvailable()) {
      encrypted = Buffer.concat([Buffer.from([STORAGE_PREFIX_SAFE]), safeStorage.encryptString(plaintext)])
    } else {
      encrypted = encryptWithFallback(plaintext)
    }
    const stmt = this.db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `)
    stmt.run(key, encrypted)
  }

  getDecryptedSetting(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: Buffer }
      | undefined
    if (!row) return null

    const data = row.value
    if (!data || data.length === 0) return null

    try {
      const prefix = data[0]
      if (prefix === STORAGE_PREFIX_SAFE) {
        if (!safeStorage.isEncryptionAvailable()) {
          return null
        }
        return safeStorage.decryptString(data.subarray(1))
      }

      if (prefix === STORAGE_PREFIX_FALLBACK) {
        return decryptWithFallback(data)
      }

      // Dados legados sem prefixo: tentar safeStorage se disponível
      if (safeStorage.isEncryptionAvailable()) {
        return safeStorage.decryptString(data)
      }
    } catch {
      // Qualquer falha na descriptografia é tratada como valor inexistente,
      // para que o app não quebre com dados corrompidos ou migrações futuras.
    }

    return null
  }

  // ---------------------------------------------------------------------
  // Comparisons (v2)
  // ---------------------------------------------------------------------

  /**
   * Cria uma comparação no estado "pending" (sem documento/áudio). Usado
   * pelo fluxo "Nova comparação" que pede um nome antes de tudo.
   *
   * As colunas legadas v1 (`document_name`, `audio_name`, `original_text`,
   * `transcribed_text`, `diff_result`, `accuracy_score`, `model_used`)
   * são `NOT NULL` no schema (SQLite não suporta `ALTER COLUMN` para
   * relaxar constraints). Inserimos `''` / `0` nelas no momento da
   * criação — são vestigiais no fluxo v2 (a UI usa `document_path` /
   * `audio_path`) e são sobrescritas quando o usuário seleciona um
   * arquivo ou a transcrição conclui.
   */
  createComparison(name: string): ComparisonRecord {
    const now = this.nowIso()
    const stmt = this.db.prepare(`
      INSERT INTO comparisons
        (created_at, updated_at, name, status,
         document_path, audio_path,
         document_name, audio_name, original_text, transcribed_text,
         diff_result, accuracy_score, model_used, error_message,
         chunk_duration_s)
      VALUES (?, ?, ?, 'pending', NULL, NULL, '', '', '', '', '', 0, '', NULL, NULL)
    `)
    const result = stmt.run(now, now, name)
    return this.getComparison(result.lastInsertRowid as number)!
  }

  /** Atualiza os paths/nomes/textos extraídos; transita o status se já tinha áudio. */
  setComparisonDocument(
    id: number,
    documentPath: string,
    documentName: string,
    documentText: string
  ): void {
    this.db
      .prepare(
        `UPDATE comparisons
         SET document_path = ?, document_name = ?, original_text = ?
         WHERE id = ?`
      )
      .run(documentPath, documentName, documentText, id)
    this.touchComparison(id)
  }

  setComparisonAudio(id: number, audioPath: string, audioName: string): void {
    this.db
      .prepare(`UPDATE comparisons SET audio_path = ?, audio_name = ? WHERE id = ?`)
      .run(audioPath, audioName, id)
    this.touchComparison(id)
  }

  setComparisonModel(id: number, model: string): void {
    this.db
      .prepare(`UPDATE comparisons SET model_used = ? WHERE id = ?`)
      .run(model, id)
    this.touchComparison(id)
  }

  /**
   * Persiste a duração de chunk configurada pelo usuário (em segundos).
   * O caller (IPC handler) é responsável por aplicar o clamp antes de
   * chamar — este método grava o que recebe.
   */
  setComparisonChunkDuration(id: number, seconds: number): void {
    this.db
      .prepare(`UPDATE comparisons SET chunk_duration_s = ? WHERE id = ?`)
      .run(seconds, id)
    this.touchComparison(id)
  }

  setComparisonStatus(
    id: number,
    status: ComparisonStatus,
    errorMessage: string | null = null
  ): void {
    this.db
      .prepare(`UPDATE comparisons SET status = ?, error_message = ? WHERE id = ?`)
      .run(status, errorMessage, id)
    this.touchComparison(id)
  }

  /**
   * Persiste o resultado final (diff + accuracy) e marca a comparação como
   * `completed`. Os textos já foram montados a partir dos chunks.
   */
  setComparisonResult(
    id: number,
    transcribedText: string,
    diffJson: string,
    accuracy: number
  ): void {
    this.db
      .prepare(
        `UPDATE comparisons
         SET transcribed_text = ?, diff_result = ?, accuracy_score = ?, status = 'completed',
             error_message = NULL
         WHERE id = ?`
      )
      .run(transcribedText, diffJson, accuracy, id)
    this.touchComparison(id)
  }

  /**
   * Compatibilidade: o App.tsx antigo chamava `saveComparison` com o objeto
   * "completo". Mantido para HistoryPanel (que pode editar e regravar uma
   * comparação v1) — o caller é responsável por não usar este método no
   * fluxo de "nova comparação".
   */
  saveComparison(data: Omit<ComparisonRecord, 'id' | 'status' | 'updated_at'>): number {
    const stmt = this.db.prepare(`
      INSERT INTO comparisons
        (created_at, updated_at, name, status,
         document_path, audio_path, document_name, audio_name,
         original_text, transcribed_text, diff_result,
         accuracy_score, model_used, error_message)
      VALUES (?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const result = stmt.run(
      data.created_at,
      data.created_at,
      data.name || 'Comparação',
      data.document_path ?? null,
      data.audio_path ?? null,
      data.document_name,
      data.audio_name,
      data.original_text,
      data.transcribed_text,
      data.diff_result,
      data.accuracy_score,
      data.model_used,
      data.error_message ?? null
    )
    return result.lastInsertRowid as number
  }

  getComparisons(): ComparisonRecord[] {
    return this.db
      .prepare('SELECT * FROM comparisons ORDER BY datetime(created_at) DESC')
      .all() as ComparisonRecord[]
  }

  getComparison(id: number): ComparisonRecord | undefined {
    return this.db
      .prepare('SELECT * FROM comparisons WHERE id = ?')
      .get(id) as ComparisonRecord | undefined
  }

  // ---------------------------------------------------------------------
  // Diff com chunks (v4)
  // ---------------------------------------------------------------------

  setComparisonDiffChunks(id: number, diff: Array<{ type: string; value?: string; original?: string; transcribed?: string; chunkIndex: number }>): void {
    this.db
      .prepare('UPDATE comparisons SET diff_result_chunks = ? WHERE id = ?')
      .run(JSON.stringify(diff), id)
    this.touchComparison(id)
  }

  getComparisonDiffChunks(id: number): Array<{ type: string; value?: string; original?: string; transcribed?: string; chunkIndex: number }> | null {
    const row = this.db
      .prepare('SELECT diff_result_chunks FROM comparisons WHERE id = ?')
      .get(id) as { diff_result_chunks: string | null } | undefined
    if (!row?.diff_result_chunks) return null
    try {
      return JSON.parse(row.diff_result_chunks)
    } catch {
      return null
    }
  }

  // ---------------------------------------------------------------------
  // Whisper segments (v5)
  // ---------------------------------------------------------------------

  setComparisonWhisperSegments(id: number, segments: Array<{ start: number; end: number; text: string }>): void {
    this.db
      .prepare('UPDATE comparisons SET whisper_segments_json = ? WHERE id = ?')
      .run(JSON.stringify(segments), id)
    this.touchComparison(id)
  }

  getComparisonWhisperSegments(id: number): Array<{ start: number; end: number; text: string }> | null {
    const row = this.db
      .prepare('SELECT whisper_segments_json FROM comparisons WHERE id = ?')
      .get(id) as { whisper_segments_json: string | null } | undefined
    if (!row?.whisper_segments_json) return null
    try {
      return JSON.parse(row.whisper_segments_json)
    } catch {
      return null
    }
  }

  /**
   * Retorna comparações que podem ser "retomadas" no boot (`pending` ou
   * `transcribing` órfãs). NÃO inclui `error` — essas ficam no histórico
   * normal via `getComparisons`.
   *
   * A regra "anti-zumbi" (ver plano seção 4) trata `transcribing` no boot
   * como `error` automaticamente quando o usuário recusa a retomada.
   */
  getActiveComparisons(): ComparisonRecord[] {
    return this.db
      .prepare(
        `SELECT * FROM comparisons
         WHERE status IN ('pending', 'transcribing')
         ORDER BY datetime(updated_at) DESC`
      )
      .all() as ComparisonRecord[]
  }

  deleteComparison(id: number): void {
    // PRAGMA foreign_keys = ON cascateia para chunks
    this.db.prepare('DELETE FROM comparisons WHERE id = ?').run(id)
  }

  // ---------------------------------------------------------------------
  // Chunks
  // ---------------------------------------------------------------------

  /**
   * Upsert idempotente de um chunk. Se o Python reprocessar um chunk já
   * persistido, nada duplica — `ON CONFLICT(comparison_id, chunk_index)
   * DO UPDATE` sobrescreve o status/text/erro/duração.
   */
  upsertChunk(chunk: Omit<ChunkRecord, 'id' | 'created_at' | 'updated_at'>): void {
    const now = this.nowIso()
    this.db
      .prepare(
        `INSERT INTO chunks
          (comparison_id, chunk_index, total_chunks, start_s, end_s,
           status, text, error_message, duration_ms, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(comparison_id, chunk_index) DO UPDATE SET
           total_chunks = excluded.total_chunks,
           start_s      = excluded.start_s,
           end_s        = excluded.end_s,
           status       = excluded.status,
           text         = excluded.text,
           error_message= excluded.error_message,
           duration_ms  = excluded.duration_ms,
           updated_at   = excluded.updated_at`
      )
      .run(
        chunk.comparison_id,
        chunk.chunk_index,
        chunk.total_chunks,
        chunk.start_s,
        chunk.end_s,
        chunk.status,
        chunk.text,
        chunk.error_message,
        chunk.duration_ms,
        now,
        now
      )
  }

  getChunksForComparison(comparisonId: number): ChunkRecord[] {
    return this.db
      .prepare(
        `SELECT * FROM chunks WHERE comparison_id = ? ORDER BY chunk_index ASC`
      )
      .all(comparisonId) as ChunkRecord[]
  }

  /**
   * Retorna apenas os chunks já concluídos. Usado para regenerar o
   * checkpoint JSON do Python a partir do DB (fonte de verdade).
   */
  getDoneChunks(comparisonId: number): ChunkRecord[] {
    return this.db
      .prepare(
        `SELECT * FROM chunks
         WHERE comparison_id = ? AND status = 'done'
         ORDER BY chunk_index ASC`
      )
      .all(comparisonId) as ChunkRecord[]
  }

  /**
   * Versão montada do texto transcrito (concatena chunks `done` em ordem).
   * Retorna `null` se nenhum chunk estiver concluído ainda.
   */
  getTranscribedTextFromChunks(comparisonId: number): string | null {
    const done = this.getDoneChunks(comparisonId)
    if (done.length === 0) return null
    return done.map((c) => c.text ?? '').filter((t) => t.length > 0).join(' ')
  }

  /**
   * Atualiza apenas os campos "resultado" de um chunk (status/text/
   * duration_ms/error_message). Os campos estruturais (start_s/end_s/
   * total_chunks) ficam como foram gravados em `chunk_start`.
   *
   * Idempotente: se a linha não existir (perda do `chunk_start` no
   * buffer), `affectedRows === 0` e nada acontece — o log de
   * inconsistência fica visível no caller.
   */
  setChunkResult(
    comparisonId: number,
    chunkIndex: number,
    result: {
      status: ChunkStatus
      text?: string | null
      error_message?: string | null
      duration_ms?: number | null
    }
  ): number {
    const info = this.db
      .prepare(
        `UPDATE chunks
         SET status = ?, text = ?, error_message = ?, duration_ms = ?,
             updated_at = ?
         WHERE comparison_id = ? AND chunk_index = ?`
      )
      .run(
        result.status,
        result.text ?? null,
        result.error_message ?? null,
        result.duration_ms ?? null,
        this.nowIso(),
        comparisonId,
        chunkIndex
      )
    return info.changes
  }

  /**
   * Marca todos os chunks em `transcribing` como `pending`. Usado no
   * cancelamento: a comparação ainda existe, os chunks voltam para a fila
   * para retomada futura.
   */
  resetInFlightChunks(comparisonId: number): void {
    this.db
      .prepare(
        `UPDATE chunks SET status = 'pending', updated_at = ?
         WHERE comparison_id = ? AND status = 'transcribing'`
      )
      .run(this.nowIso(), comparisonId)
  }

  close() {
    this.db.close()
  }
}
