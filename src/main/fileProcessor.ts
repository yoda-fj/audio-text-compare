import * as fs from 'fs'
import * as path from 'path'
import mammoth from 'mammoth'
import pdfParse from 'pdf-parse'
import { diffWords } from 'diff'
import type { DiffItem, ReadDocumentOptions } from '../renderer/types'

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
}
