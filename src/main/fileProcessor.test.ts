import { describe, it, expect } from 'vitest'
import { FileProcessor } from './fileProcessor'

describe('compareTextsWithChunks', () => {
  const fp = new FileProcessor()

  it('mapeia textos iguais para 2 chunks corretamente', () => {
    const chunks = [
      { chunkIndex: 0, text: 'ola mundo' },
      { chunkIndex: 1, text: 'como vai' },
    ]
    const diff = fp.compareTextsWithChunks('ola mundo como vai', 'ola mundo como vai', chunks)

    expect(diff).toHaveLength(4)
    expect(diff[0]).toEqual({ type: 'equal', value: 'ola', chunkIndex: 0 })
    expect(diff[1]).toEqual({ type: 'equal', value: 'mundo', chunkIndex: 0 })
    expect(diff[2]).toEqual({ type: 'equal', value: 'como', chunkIndex: 1 })
    expect(diff[3]).toEqual({ type: 'equal', value: 'vai', chunkIndex: 1 })
  })

  it('removed no início recebe chunkIndex 0', () => {
    const chunks = [
      { chunkIndex: 0, text: 'mundo' },
    ]
    const diff = fp.compareTextsWithChunks('ola mundo', 'mundo', chunks)

    const removed = diff.filter((d) => d.type === 'removed')
    expect(removed).toHaveLength(1)
    expect(removed[0]).toEqual({ type: 'removed', value: 'ola', chunkIndex: 0 })
  })

  it('removed entre chunks herda chunkIndex do item anterior', () => {
    const chunks = [
      { chunkIndex: 0, text: 'ola' },
      { chunkIndex: 1, text: 'mundo' },
    ]
    const diff = fp.compareTextsWithChunks('ola foo mundo', 'ola mundo', chunks)

    const removed = diff.filter((d) => d.type === 'removed')
    expect(removed).toHaveLength(1)
    // O "foo" está entre "ola" (chunk 0) e "mundo" (chunk 1) → herda chunk 0
    expect(removed[0]).toEqual({ type: 'removed', value: 'foo', chunkIndex: 0 })
  })

  it('added respeita boundaries de chunks', () => {
    const chunks = [
      { chunkIndex: 0, text: 'ola' },
      { chunkIndex: 1, text: 'mundo' },
    ]
    const diff = fp.compareTextsWithChunks('ola', 'ola mundo', chunks)

    const added = diff.filter((d) => d.type === 'added')
    expect(added).toHaveLength(1)
    expect(added[0]).toEqual({ type: 'added', value: 'mundo', chunkIndex: 1 })
  })

  it('chunk vazio no meio não recebe nenhuma palavra', () => {
    const chunks = [
      { chunkIndex: 0, text: 'ola' },
      { chunkIndex: 1, text: '' },
      { chunkIndex: 2, text: 'mundo' },
    ]
    const diff = fp.compareTextsWithChunks('ola mundo', 'ola mundo', chunks)

    expect(diff).toHaveLength(2)
    expect(diff[0]).toEqual({ type: 'equal', value: 'ola', chunkIndex: 0 })
    expect(diff[1]).toEqual({ type: 'equal', value: 'mundo', chunkIndex: 2 })
  })

  it('1 chunk só: tudo mapeia para chunkIndex 0', () => {
    const chunks = [
      { chunkIndex: 0, text: 'ola mundo como vai voce' },
    ]
    const diff = fp.compareTextsWithChunks('ola mundo', 'ola mundo como vai voce', chunks)

    expect(diff.every((d) => d.chunkIndex === 0)).toBe(true)
  })

  it('clamp no último chunk quando contagem diverge', () => {
    const chunks = [
      { chunkIndex: 0, text: 'ola' },
    ]
    // O transcrito tem mais palavras que o chunk → clampa no último chunk (0)
    const diff = fp.compareTextsWithChunks('ola', 'ola mundo como vai', chunks)

    const added = diff.filter((d) => d.type === 'added')
    expect(added.every((d) => d.chunkIndex === 0)).toBe(true)
  })

  it('lida com mudança (removed + added) no mesmo lugar', () => {
    const chunks = [
      { chunkIndex: 0, text: 'oi mundo' },
    ]
    const diff = fp.compareTextsWithChunks('ola mundo', 'oi mundo', chunks)

    // diffWords gera: removed 'ola', added 'oi', equal 'mundo'
    expect(diff).toHaveLength(3)
    expect(diff[0]).toEqual({ type: 'removed', value: 'ola', chunkIndex: 0 })
    expect(diff[1]).toEqual({ type: 'added', value: 'oi', chunkIndex: 0 })
    expect(diff[2]).toEqual({ type: 'equal', value: 'mundo', chunkIndex: 0 })
  })
})

describe('quebras de palavra entre linhas (normalize)', () => {
  const fp = new FileProcessor()

  /**
   * Caso canônico: PDF/DOCX com justificação de texto põe "per-" no fim
   * da linha e "to" no começo da próxima. O diff deve tratar como
   * "perto" (palavra só), não como duas palavras distintas.
   */
  it('junta palavra hifenizada: "per-\\nto" + "perto" = igual', () => {
    const chunks = [{ chunkIndex: 0, text: 'perto' }]
    const diff = fp.compareTextsWithChunks('per-\nto', 'perto', chunks)
    // Não deve haver "removed" ou "added" — só equal
    expect(diff.every((d) => d.type === 'equal')).toBe(true)
    expect(diff).toHaveLength(1)
    expect(diff[0]).toEqual({ type: 'equal', value: 'perto', chunkIndex: 0 })
  })

  it('junta palavra hifenizada em frase maior', () => {
    const chunks = [{ chunkIndex: 0, text: 'ele foi perto' }]
    const diff = fp.compareTextsWithChunks('ele foi per-\nto', 'ele foi perto', chunks)
    // Tudo equal: 3 palavras (ele, foi, perto)
    expect(diff.filter((d) => d.type === 'equal')).toHaveLength(3)
    expect(diff.some((d) => d.type === 'removed' || d.type === 'added')).toBe(false)
  })

  it('NÃO junta palavras separadas sem hífen (regressão: "de\\nlaranja")', () => {
    // Caso reportado pelo usuário: "de\nlaranja" não pode virar "delaranja"
    // São duas palavras distintas que estavam em linhas separadas.
    const chunks = [{ chunkIndex: 0, text: 'de laranja' }]
    const diff = fp.compareTextsWithChunks('de\nlaranja', 'de laranja', chunks)
    // Deve manter 2 palavras separadas
    expect(diff.filter((d) => d.type === 'equal')).toHaveLength(2)
    expect(diff.map((d) => d.value)).toEqual(['de', 'laranja'])
  })

  it('lida com hifens em palavras compostas sem quebra de linha', () => {
    // "alto-falante" (hífen legítimo, sem \n) deve permanecer "alto-falante"
    const chunks = [{ chunkIndex: 0, text: 'alto-falante' }]
    const diff = fp.compareTextsWithChunks('alto-falante', 'alto-falante', chunks)
    expect(diff.every((d) => d.type === 'equal')).toBe(true)
    expect(diff).toHaveLength(1)
  })

  it('lida com acentuação nas quebras hifenizadas', () => {
    // "não" + quebra de linha
    const chunks = [{ chunkIndex: 0, text: 'não foi' }]
    const diff = fp.compareTextsWithChunks('nã-\no foi', 'não foi', chunks)
    expect(diff.every((d) => d.type === 'equal')).toBe(true)
  })
})
