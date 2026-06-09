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

export interface ComparisonRecord {
  id?: number
  created_at: string
  document_name: string
  audio_name: string
  original_text: string
  transcribed_text: string
  diff_result: string
  accuracy_score: number
  model_used: string
}

export class DatabaseManager {
  private db: Database.Database

  constructor() {
    const dbPath = path.join(app.getPath('userData'), 'comparisons.db')
    this.db = new Database(dbPath)
    this.init()
  }

  private init() {
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
    `)
  }

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

  saveComparison(data: Omit<ComparisonRecord, 'id'>): number {
    const stmt = this.db.prepare(`
      INSERT INTO comparisons 
      (created_at, document_name, audio_name, original_text, transcribed_text, diff_result, accuracy_score, model_used)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const result = stmt.run(
      data.created_at,
      data.document_name,
      data.audio_name,
      data.original_text,
      data.transcribed_text,
      data.diff_result,
      data.accuracy_score,
      data.model_used
    )
    return result.lastInsertRowid as number
  }

  getComparisons(): ComparisonRecord[] {
    return this.db.prepare('SELECT * FROM comparisons ORDER BY created_at DESC').all() as ComparisonRecord[]
  }

  getComparison(id: number): ComparisonRecord | undefined {
    return this.db.prepare('SELECT * FROM comparisons WHERE id = ?').get(id) as ComparisonRecord | undefined
  }

  deleteComparison(id: number): void {
    this.db.prepare('DELETE FROM comparisons WHERE id = ?').run(id)
  }

  close() {
    this.db.close()
  }
}
