import { describe, it, expect } from 'vitest'
import {
  clampChunkDuration,
  computeClipEndS,
  MIN_CHUNK_DURATION_S,
  MAX_CHUNK_DURATION_S,
  DEFAULT_CHUNK_DURATION_S,
} from './chunkMath'

describe('clampChunkDuration', () => {
  it('retorna o valor quando está dentro do range', () => {
    expect(clampChunkDuration(30)).toBe(30)
    expect(clampChunkDuration(MIN_CHUNK_DURATION_S)).toBe(MIN_CHUNK_DURATION_S)
    expect(clampChunkDuration(MAX_CHUNK_DURATION_S)).toBe(MAX_CHUNK_DURATION_S)
  })

  it('eleva valores abaixo do mínimo para MIN', () => {
    expect(clampChunkDuration(2)).toBe(MIN_CHUNK_DURATION_S)
    expect(clampChunkDuration(0)).toBe(MIN_CHUNK_DURATION_S)
    expect(clampChunkDuration(-10)).toBe(MIN_CHUNK_DURATION_S)
  })

  it('limita valores acima do máximo a MAX', () => {
    expect(clampChunkDuration(200)).toBe(MAX_CHUNK_DURATION_S)
    expect(clampChunkDuration(9999)).toBe(MAX_CHUNK_DURATION_S)
  })

  it('trunca valores fracionários para baixo', () => {
    expect(clampChunkDuration(30.9)).toBe(30)
    expect(clampChunkDuration(45.7)).toBe(45)
    expect(clampChunkDuration(120.99)).toBe(MAX_CHUNK_DURATION_S)
  })

  it('é idempotente (clamp(clamp(x)) === clamp(x))', () => {
    const inputs = [2, 30, 200, 30.5, 0, -5]
    for (const x of inputs) {
      expect(clampChunkDuration(clampChunkDuration(x))).toBe(clampChunkDuration(x))
    }
  })

  it('trata valores inválidos como MIN', () => {
    expect(clampChunkDuration(Number.NaN)).toBe(MIN_CHUNK_DURATION_S)
    // Infinito não é finito → vai para MIN
    expect(clampChunkDuration(Number.POSITIVE_INFINITY)).toBe(MIN_CHUNK_DURATION_S)
    expect(clampChunkDuration(Number.NEGATIVE_INFINITY)).toBe(MIN_CHUNK_DURATION_S)
  })
})

describe('computeClipEndS', () => {
  it('retorna a duração completa quando maxChunks <= 0', () => {
    expect(computeClipEndS(120, 0, 30)).toBe(120)
    expect(computeClipEndS(120, -1, 30)).toBe(120)
    expect(computeClipEndS(85 * 60, 0, 5)).toBe(85 * 60)
  })

  it('multiplica maxChunks × chunkDurationS', () => {
    expect(computeClipEndS(600, 2, 30)).toBe(60)
    expect(computeClipEndS(600, 5, 15)).toBe(75)
    expect(computeClipEndS(600, 1, 30)).toBe(30)
  })

  it('aplica default 30 quando chunkDurationS é null/undefined/<= 0', () => {
    expect(computeClipEndS(600, 2, null)).toBe(60) // 2 × 30
    expect(computeClipEndS(600, 3, undefined)).toBe(90) // 3 × 30
    expect(computeClipEndS(600, 4, 0)).toBe(120) // 4 × 30
    expect(computeClipEndS(600, 1, -5)).toBe(30) // 1 × 30
  })

  it('clampa em audioDurationS quando o produto extrapola', () => {
    // 10 chunks × 30s = 300s, mas áudio tem só 120s
    expect(computeClipEndS(120, 10, 30)).toBe(120)
    // 2 chunks × 60s = 120s, igual à duração
    expect(computeClipEndS(120, 2, 60)).toBe(120)
  })

  it('respeita o chunkDurationS fornecido mesmo com maxChunks alto', () => {
    expect(computeClipEndS(5000, 100, 5)).toBe(500) // 100 × 5 = 500
    expect(computeClipEndS(5000, 50, 120)).toBe(5000) // clampa em duração
  })

  it('combina default + extrapola corretamente', () => {
    // chunkDurationS undefined → 30, maxChunks 5 → 150, áudio 100
    expect(computeClipEndS(100, 5, null)).toBe(100)
    // chunkDurationS 60, maxChunks 4 → 240, áudio 200
    expect(computeClipEndS(200, 4, 60)).toBe(200)
  })

  it('lida com duração zero (áudio vazio)', () => {
    expect(computeClipEndS(0, 0, 30)).toBe(0)
    expect(computeClipEndS(0, 5, 30)).toBe(0)
  })

  it('usa DEFAULT_CHUNK_DURATION_S como fallback (sanity)', () => {
    // 1 chunk × default = 30
    expect(computeClipEndS(1000, 1, null)).toBe(DEFAULT_CHUNK_DURATION_S)
  })
})
