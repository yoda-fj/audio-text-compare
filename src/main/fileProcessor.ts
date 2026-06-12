import * as fs from 'fs'
import * as path from 'path'
import mammoth from 'mammoth'
import pdfParse from 'pdf-parse'
import { diffWords } from 'diff'
import type { DiffItem, DiffItemWithChunk, ReadDocumentOptions } from '../renderer/types'

export class FileProcessor {
  async readDocument(
    filePath: string,
    options?: ReadDocumentOptions
  ): Promise<{ text: string; error?: string }> {
    try {
      const ext = path.extname(filePath).toLowerCase()

      switch (ext) {
        case '.txt': {
          const text = fs.readFileSync(filePath, 'utf-8')
          if ((options?.pageStart || options?.pageEnd) && text.includes('\f')) {
            const pages = text.split('\f')
            const start = Math.max(0, (options.pageStart ?? 1) - 1)
            const end = Math.min(pages.length - 1, (options.pageEnd ?? pages.length) - 1)
            return { text: pages.slice(start, end + 1).join('\f') }
          }
          return { text }
        }

        case '.docx': {
          const docxResult = await mammoth.extractRawText({ path: filePath })
          // mammoth não fornece paginação confiável; extrai o texto completo
          return { text: docxResult.value }
        }

        case '.pdf': {
          const pdfBuffer = fs.readFileSync(filePath)
          if (options?.pageStart || options?.pageEnd) {
            const text = await this.extractPdfPages(pdfBuffer, options.pageStart, options.pageEnd)
            return { text }
          }
          const pdfResult = await pdfParse(pdfBuffer)
          return { text: pdfResult.text }
        }

        default:
          return { text: '', error: `Formato não suportado: ${ext}` }
      }
    } catch (error) {
      return { text: '', error: `Erro ao ler arquivo: ${error}` }
    }
  }

  private async extractPdfPages(
    dataBuffer: Buffer,
    pageStart?: number,
    pageEnd?: number
  ): Promise<string> {
    const pdfjsLib = require('pdfjs-dist/build/pdf.js')
    pdfjsLib.disableWorker = true

    const doc = await pdfjsLib
      .getDocument({ data: new Uint8Array(dataBuffer), useSystemFonts: true })
      .promise
    const totalPages = doc.numPages

    const start = Math.max(1, pageStart ?? 1)
    const end = Math.min(totalPages, pageEnd ?? totalPages)

    if (start > end || start > totalPages) {
      doc.destroy()
      return ''
    }

    const parts: string[] = []
    for (let i = start; i <= end; i++) {
      const page = await doc.getPage(i)
      const textContent = await page.getTextContent({
        includeMarkedContent: false,
      })

      let lastY: number | undefined
      let pageText = ''
      for (const item of textContent.items) {
        const typedItem = item as { str: string; transform: number[] }
        if (lastY === typedItem.transform[5] || lastY === undefined) {
          pageText += typedItem.str
        } else {
          pageText += '\n' + typedItem.str
        }
        lastY = typedItem.transform[5]
      }
      parts.push(pageText)
    }

    doc.destroy()
    return parts.join('\n\n')
  }

  compareTexts(original: string, transcribed: string): DiffItem[] {
    const normOriginal = this.normalizeText(original)
    const normTranscribed = this.normalizeText(transcribed)

    const changes = diffWords(normOriginal, normTranscribed)
    const result: DiffItem[] = []

    for (const change of changes) {
      if (change.added) {
        const words = change.value.trim().split(/\s+/).filter(w => w.length > 0)
        for (const word of words) {
          result.push({ type: 'added', value: word })
        }
      } else if (change.removed) {
        const words = change.value.trim().split(/\s+/).filter(w => w.length > 0)
        for (const word of words) {
          result.push({ type: 'removed', value: word })
        }
      } else {
        const words = change.value.trim().split(/\s+/).filter(w => w.length > 0)
        for (const word of words) {
          result.push({ type: 'equal', value: word })
        }
      }
    }

    return result
  }

  private normalizeText(text: string): string {
    return text
      // Junta palavras quebradas no fim de linha COM HÍFEN: "per-\n" + "to" → "perto".
      // É o caso canônico de justificação de texto em PDFs/DOCXs: a palavra
      // é quebrada com hífen no fim da linha e continua na próxima. O hífen
      // é o sinal claro de que houve quebra de palavra (sem hífen, é
      // ambiguo: "de\nlaranja" são duas palavras, "as\nsim" é uma só).
      // Por isso só tratamos o caso hifenizado — sem ele, falsos positivos
      // como "de laranja" → "delaranja" são inevitáveis sem dicionário.
      .replace(/(\p{L})-\s*\n\s*(\p{L})/gu, '$1$2')
      .toLowerCase()
      .replace(/[\n\r\t]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  calculateAccuracy(diff: DiffItem[]): number {
    const total = diff.length
    const correct = diff.filter(d => d.type === 'equal').length
    return total > 0 ? Math.round((correct / total) * 100) : 0
  }

  /**
   * Versão estendida de `compareTexts` que associa cada palavra do diff ao
   * chunk de origem. Útil no modo "Por Chunk" para sincronizar texto com áudio.
   *
   * Algoritmo:
   * 1. Normaliza e tokeniza os textos (mesma lógica de `compareTexts`).
   * 2. Pré-calcula os limites (boundaries) de palavras por chunk.
   * 3. Roda o diff palavra-a-palavra.
   * 4. Para cada item `equal`/`added`, conta palavras da transcrição e mapeia
   *    para o chunk correspondente via boundary.
   * 5. Para itens `removed`, herda o `chunkIndex` do item de transcrição
   *    anterior; se ocorrem antes de qualquer palavra transcrita, usa 0.
   */
  compareTextsWithChunks(
    original: string,
    transcribed: string,
    chunks: { chunkIndex: number; text: string }[]
  ): DiffItemWithChunk[] {
    const normOriginal = this.normalizeText(original)
    const normTranscribed = this.normalizeText(transcribed)

    // 1. Tokeniza os textos
    const tokenize = (s: string) => s.trim().split(/\s+/).filter((w) => w.length > 0)

    // 2. Pré-calcula boundaries: boundaries[i] = total de palavras dos
    // chunks 0..i (inclusive). Usamos a mesma tokenização.
    const boundaries: number[] = []
    let cumulative = 0
    for (const chunk of chunks) {
      const chunkWords = tokenize(this.normalizeText(chunk.text))
      cumulative += chunkWords.length
      boundaries.push(cumulative)
    }

    // 3. Roda o diff
    const changes = diffWords(normOriginal, normTranscribed)
    const result: DiffItemWithChunk[] = []

    // Contador de palavras já vistas na transcrição (equal/added)
    let transcribedWordCount = 0

    for (const change of changes) {
      const words = tokenize(change.value)
      if (words.length === 0) continue

      if (change.added) {
        // Palavras presentes na transcrição — contam para boundaries
        for (const word of words) {
          const chunkIndex = this.findChunkIndex(transcribedWordCount, boundaries)
          result.push({ type: 'added', value: word, chunkIndex })
          transcribedWordCount++
        }
      } else if (change.removed) {
        // Palavras do original ausentes na transcrição — herdam índice
        const lastChunkIndex =
          result.length > 0 ? result[result.length - 1].chunkIndex : 0
        for (const word of words) {
          result.push({ type: 'removed', value: word, chunkIndex: lastChunkIndex })
        }
      } else {
        // equal — conta para boundaries
        for (const word of words) {
          const chunkIndex = this.findChunkIndex(transcribedWordCount, boundaries)
          result.push({ type: 'equal', value: word, chunkIndex })
          transcribedWordCount++
        }
      }
    }

    return result
  }

  private findChunkIndex(wordIndex: number, boundaries: number[]): number {
    for (let i = 0; i < boundaries.length; i++) {
      if (wordIndex < boundaries[i]) return i
    }
    // Clamp no último chunk se extrapolar
    return Math.max(0, boundaries.length - 1)
  }

  /**
   * Mapeia cada palavra do diff para o segmento do Whisper correspondente.
   * Retorna um array com o mesmo comprimento do diff, onde cada elemento
   * contém { start, end } do segmento onde aquela palavra aparece.
   *
   * Para palavras 'removed', usa o segmento mais próximo (anterior ou primeiro).
   *
   * Alinhamento do contador: o `diffWords` separa pontuação das palavras
   * quando ela difere entre os textos ("casa." vs "casa," → equal "casa" +
   * removed "." + added ","), mas os segments do Whisper têm a pontuação
   * grudada na palavra ("casa," = 1 token). Itens só de pontuação NÃO
   * incrementam o contador de palavras transcritas — senão o mapeamento
   * deriva para o futuro do áudio, com erro crescente ao longo do texto.
   */
  mapDiffToWhisperSegments(
    diff: DiffItem[],
    segments: Array<{ start: number; end: number; text: string }>
  ): Array<{ start: number; end: number }> {
    const tokenize = (s: string) => this.normalizeText(s).trim().split(/\s+/).filter((w) => w.length > 0)
    const hasWordChars = (s: string) => /[\p{L}\p{N}]/u.test(s)
    const countWords = (s: string) => tokenize(s).filter(hasWordChars).length

    // Pré-calcula o acumulado de palavras por segmento (mesmo critério de
    // contagem usado para o diff: só tokens com letra/dígito).
    const segmentBoundaries: number[] = []
    let cumulative = 0
    for (const seg of segments) {
      cumulative += countWords(seg.text)
      segmentBoundaries.push(cumulative)
    }

    const result: Array<{ start: number; end: number }> = []
    let transcribedWordCount = 0

    for (const item of diff) {
      if (item.type === 'removed') {
        // Para palavras removidas, usa o segmento anterior ou o primeiro
        const prevIndex = Math.max(0, transcribedWordCount - 1)
        const segIdx = this.findChunkIndex(prevIndex, segmentBoundaries)
        const seg = segments[segIdx] || segments[0] || { start: 0, end: 0 }
        result.push({ start: seg.start, end: seg.end })
      } else {
        // equal ou added — mapeia para o segmento correspondente
        const segIdx = this.findChunkIndex(transcribedWordCount, segmentBoundaries)
        const seg = segments[segIdx] || segments[segments.length - 1] || { start: 0, end: 0 }
        result.push({ start: seg.start, end: seg.end })
        // Pontuação isolada não conta como palavra transcrita
        if (hasWordChars(item.value ?? '')) {
          transcribedWordCount++
        }
      }
    }

    return result
  }
}
