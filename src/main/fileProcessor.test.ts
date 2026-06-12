import { describe, it, expect } from 'vitest'
import { FileProcessor } from './fileProcessor'
import type { DiffItem } from '../renderer/types'

const fp = new FileProcessor()

/** Atalho para criar chunks: chunks('ola', 'mundo') → [{chunkIndex:0,...},{chunkIndex:1,...}] */
const chunks = (...texts: string[]) =>
  texts.map((text, chunkIndex) => ({ chunkIndex, text }))

/** Filtra itens do diff por tipo. */
const byType = <T extends { type: string }>(diff: T[], type: T['type']) =>
  diff.filter((d) => d.type === type)

describe('compareTextsWithChunks', () => {
  it('mapeia textos iguais para 2 chunks corretamente', () => {
    const diff = fp.compareTextsWithChunks(
      'ola mundo como vai',
      'ola mundo como vai',
      chunks('ola mundo', 'como vai')
    )

    expect(diff).toEqual([
      { type: 'equal', value: 'ola', chunkIndex: 0 },
      { type: 'equal', value: 'mundo', chunkIndex: 0 },
      { type: 'equal', value: 'como', chunkIndex: 1 },
      { type: 'equal', value: 'vai', chunkIndex: 1 },
    ])
  })

  it('removed no início recebe chunkIndex 0', () => {
    const diff = fp.compareTextsWithChunks('ola mundo', 'mundo', chunks('mundo'))

    expect(byType(diff, 'removed')).toEqual([
      { type: 'removed', value: 'ola', chunkIndex: 0 },
    ])
  })

  it('removed entre chunks herda chunkIndex do item anterior', () => {
    const diff = fp.compareTextsWithChunks(
      'ola foo mundo',
      'ola mundo',
      chunks('ola', 'mundo')
    )

    // O "foo" está entre "ola" (chunk 0) e "mundo" (chunk 1) → herda chunk 0
    expect(byType(diff, 'removed')).toEqual([
      { type: 'removed', value: 'foo', chunkIndex: 0 },
    ])
  })

  it('added respeita boundaries de chunks', () => {
    const diff = fp.compareTextsWithChunks('ola', 'ola mundo', chunks('ola', 'mundo'))

    expect(byType(diff, 'added')).toEqual([
      { type: 'added', value: 'mundo', chunkIndex: 1 },
    ])
  })

  it('chunk vazio no meio não recebe nenhuma palavra', () => {
    const diff = fp.compareTextsWithChunks(
      'ola mundo',
      'ola mundo',
      chunks('ola', '', 'mundo')
    )

    expect(diff).toEqual([
      { type: 'equal', value: 'ola', chunkIndex: 0 },
      { type: 'equal', value: 'mundo', chunkIndex: 2 },
    ])
  })

  it('1 chunk só: tudo mapeia para chunkIndex 0', () => {
    const diff = fp.compareTextsWithChunks(
      'ola mundo',
      'ola mundo como vai voce',
      chunks('ola mundo como vai voce')
    )

    expect(diff.length).toBeGreaterThan(0)
    expect(diff.every((d) => d.chunkIndex === 0)).toBe(true)
  })

  it('clamp no último chunk quando contagem diverge', () => {
    // O transcrito tem mais palavras que o chunk → clampa no último chunk (0)
    const diff = fp.compareTextsWithChunks('ola', 'ola mundo como vai', chunks('ola'))

    const added = byType(diff, 'added')
    expect(added.length).toBeGreaterThan(0)
    expect(added.every((d) => d.chunkIndex === 0)).toBe(true)
  })

  it('lida com mudança (removed + added) no mesmo lugar', () => {
    const diff = fp.compareTextsWithChunks('ola mundo', 'oi mundo', chunks('oi mundo'))

    // diffWords gera: removed 'ola', added 'oi', equal 'mundo'
    expect(diff).toEqual([
      { type: 'removed', value: 'ola', chunkIndex: 0 },
      { type: 'added', value: 'oi', chunkIndex: 0 },
      { type: 'equal', value: 'mundo', chunkIndex: 0 },
    ])
  })

  it('textos vazios produzem diff vazio', () => {
    expect(fp.compareTextsWithChunks('', '', chunks(''))).toEqual([])
  })

  it('normaliza caixa: "OLA Mundo" vs "ola mundo" é tudo equal', () => {
    const diff = fp.compareTextsWithChunks('OLA Mundo', 'ola mundo', chunks('ola mundo'))

    expect(diff.every((d) => d.type === 'equal')).toBe(true)
    expect(diff.map((d) => d.value)).toEqual(['ola', 'mundo'])
  })

  it('normaliza espaços múltiplos, tabs e quebras de linha simples', () => {
    const diff = fp.compareTextsWithChunks(
      'ola   mundo\tcomo\nvai',
      'ola mundo como vai',
      chunks('ola mundo como vai')
    )

    expect(diff.every((d) => d.type === 'equal')).toBe(true)
    expect(diff).toHaveLength(4)
  })
})

describe('quebras de palavra entre linhas (normalize)', () => {
  /**
   * Caso canônico: PDF/DOCX com justificação de texto põe "per-" no fim
   * da linha e "to" no começo da próxima. O diff deve tratar como
   * "perto" (palavra só), não como duas palavras distintas.
   */
  it('junta palavra hifenizada: "per-\\nto" + "perto" = igual', () => {
    const diff = fp.compareTextsWithChunks('per-\nto', 'perto', chunks('perto'))

    expect(diff).toEqual([{ type: 'equal', value: 'perto', chunkIndex: 0 }])
  })

  it('junta palavra hifenizada em frase maior', () => {
    const diff = fp.compareTextsWithChunks(
      'ele foi per-\nto',
      'ele foi perto',
      chunks('ele foi perto')
    )

    expect(byType(diff, 'equal')).toHaveLength(3)
    expect(diff.some((d) => d.type === 'removed' || d.type === 'added')).toBe(false)
  })

  it('NÃO junta palavras separadas sem hífen (regressão: "de\\nlaranja")', () => {
    // Caso reportado pelo usuário: "de\nlaranja" não pode virar "delaranja"
    // São duas palavras distintas que estavam em linhas separadas.
    const diff = fp.compareTextsWithChunks('de\nlaranja', 'de laranja', chunks('de laranja'))

    expect(byType(diff, 'equal')).toHaveLength(2)
    expect(diff.map((d) => d.value)).toEqual(['de', 'laranja'])
  })

  it('lida com hifens em palavras compostas sem quebra de linha', () => {
    // "alto-falante" (hífen legítimo, sem \n) deve permanecer "alto-falante"
    const diff = fp.compareTextsWithChunks(
      'alto-falante',
      'alto-falante',
      chunks('alto-falante')
    )

    expect(diff).toHaveLength(1)
    expect(diff.every((d) => d.type === 'equal')).toBe(true)
  })

  it('lida com acentuação nas quebras hifenizadas', () => {
    // "não" quebrado com hífen no fim da linha
    const diff = fp.compareTextsWithChunks('nã-\no foi', 'não foi', chunks('não foi'))

    expect(diff.every((d) => d.type === 'equal')).toBe(true)
  })
})

describe('compareTexts', () => {
  it('textos idênticos retornam apenas equal', () => {
    const diff = fp.compareTexts('ola mundo', 'ola mundo')

    expect(diff).toEqual([
      { type: 'equal', value: 'ola' },
      { type: 'equal', value: 'mundo' },
    ])
  })

  it('substituição gera removed + added', () => {
    const diff = fp.compareTexts('ola mundo', 'oi mundo')

    expect(diff).toEqual([
      { type: 'removed', value: 'ola' },
      { type: 'added', value: 'oi' },
      { type: 'equal', value: 'mundo' },
    ])
  })

  it('palavra omitida na transcrição vira removed', () => {
    const diff = fp.compareTexts('ola lindo mundo', 'ola mundo')

    expect(byType(diff, 'removed')).toEqual([{ type: 'removed', value: 'lindo' }])
    expect(byType(diff, 'equal')).toHaveLength(2)
  })

  it('é case-insensitive (normaliza para minúsculas)', () => {
    const diff = fp.compareTexts('Ola Mundo', 'ola mundo')

    expect(diff.every((d) => d.type === 'equal')).toBe(true)
  })
})

describe('calculateAccuracy', () => {
  const eq = (value: string): DiffItem => ({ type: 'equal', value })
  const rm = (value: string): DiffItem => ({ type: 'removed', value })
  const ad = (value: string): DiffItem => ({ type: 'added', value })

  it('diff vazio retorna 0', () => {
    expect(fp.calculateAccuracy([])).toBe(0)
  })

  it('tudo equal retorna 100', () => {
    expect(fp.calculateAccuracy([eq('a'), eq('b'), eq('c')])).toBe(100)
  })

  it('nenhum equal retorna 0', () => {
    expect(fp.calculateAccuracy([rm('a'), ad('b')])).toBe(0)
  })

  it('arredonda a porcentagem: 2 de 3 corretas → 67', () => {
    expect(fp.calculateAccuracy([eq('a'), eq('b'), rm('c')])).toBe(67)
  })

  it('metade correta retorna 50', () => {
    expect(fp.calculateAccuracy([eq('a'), rm('b')])).toBe(50)
  })
})

describe('mapDiffToWhisperSegments', () => {
  const segments = [
    { start: 0, end: 2, text: 'ola mundo' },
    { start: 2, end: 4, text: 'como vai' },
  ]

  it('mapeia palavras equal sequencialmente para os segments', () => {
    const diff: DiffItem[] = [
      { type: 'equal', value: 'ola' },
      { type: 'equal', value: 'mundo' },
      { type: 'equal', value: 'como' },
      { type: 'equal', value: 'vai' },
    ]

    expect(fp.mapDiffToWhisperSegments(diff, segments)).toEqual([
      { start: 0, end: 2 },
      { start: 0, end: 2 },
      { start: 2, end: 4 },
      { start: 2, end: 4 },
    ])
  })

  it('removed usa o segment da palavra transcrita anterior', () => {
    const diff: DiffItem[] = [
      { type: 'equal', value: 'ola' },
      { type: 'removed', value: 'foo' },
      { type: 'equal', value: 'mundo' },
    ]

    const timings = fp.mapDiffToWhisperSegments(diff, segments)

    expect(timings).toHaveLength(3)
    // "foo" herda o segment de "ola" (a última palavra transcrita antes dele)
    expect(timings[1]).toEqual({ start: 0, end: 2 })
  })

  it('removed no início do diff usa o primeiro segment', () => {
    const diff: DiffItem[] = [
      { type: 'removed', value: 'foo' },
      { type: 'equal', value: 'ola' },
    ]

    const timings = fp.mapDiffToWhisperSegments(diff, segments)

    expect(timings[0]).toEqual({ start: 0, end: 2 })
  })

  it('clampa no último segment quando o diff tem mais palavras transcritas', () => {
    const diff: DiffItem[] = [
      { type: 'equal', value: 'ola' },
      { type: 'equal', value: 'mundo' },
      { type: 'equal', value: 'como' },
      { type: 'equal', value: 'vai' },
      { type: 'added', value: 'extra' },
      { type: 'added', value: 'demais' },
    ]

    const timings = fp.mapDiffToWhisperSegments(diff, segments)

    expect(timings[4]).toEqual({ start: 2, end: 4 })
    expect(timings[5]).toEqual({ start: 2, end: 4 })
  })

  it('pontuação isolada no diff NÃO desalinha o mapeamento (regressão: drift)', () => {
    // Cenário real: o diffWords separa pontuação divergente da palavra
    // ("casa." vs "casa," → equal 'casa' + removed '.' + added ','). Os
    // segments do Whisper têm a pontuação grudada na palavra, então se o
    // item ',' contasse como palavra, todas as palavras SEGUINTES seriam
    // mapeadas um segment à frente — drift que cresce ao longo do áudio
    // e faz o clique apontar para um ponto futuro errado.
    const diff: DiffItem[] = [
      { type: 'equal', value: 'ola' },
      { type: 'added', value: ',' }, // pontuação isolada — não conta
      { type: 'equal', value: 'mundo' },
      { type: 'equal', value: 'como' },
      { type: 'equal', value: 'vai' },
    ]

    expect(fp.mapDiffToWhisperSegments(diff, segments)).toEqual([
      { start: 0, end: 2 }, // ola   → seg A
      { start: 0, end: 2 }, // ','   → seg A (timing da posição atual)
      { start: 0, end: 2 }, // mundo → seg A (sem a correção cairia em B)
      { start: 2, end: 4 }, // como  → seg B
      { start: 2, end: 4 }, // vai   → seg B
    ])
  })

  it('ressincroniza quando o diff pula uma palavra (drift para trás)', () => {
    // 'mundo' não aparece no diff. Com contagem cega, 'como' seria a 2ª
    // palavra contada e cairia no seg A (errado) — o áudio tocaria o
    // trecho anterior e pararia ANTES da palavra clicada. Com alinhamento
    // por conteúdo, 'como' é encontrada à frente e o ponteiro ressincroniza.
    const diff: DiffItem[] = [
      { type: 'equal', value: 'ola' },
      { type: 'equal', value: 'como' },
      { type: 'equal', value: 'vai' },
    ]

    expect(fp.mapDiffToWhisperSegments(diff, segments)).toEqual([
      { start: 0, end: 2 }, // ola  → seg A
      { start: 2, end: 4 }, // como → seg B (ressincronizado)
      { start: 2, end: 4 }, // vai  → seg B
    ])
  })

  it('palavra desconhecida não avança o ponteiro (drift para frente)', () => {
    // 'xyz' não existe nos segments. Com contagem cega, ela empurraria o
    // contador e 'mundo' cairia no seg B (futuro errado). Com alinhamento,
    // o miss não avança o ponteiro e 'mundo' continua no seg A.
    const diff: DiffItem[] = [
      { type: 'equal', value: 'ola' },
      { type: 'added', value: 'xyz' },
      { type: 'equal', value: 'mundo' },
    ]

    expect(fp.mapDiffToWhisperSegments(diff, segments)).toEqual([
      { start: 0, end: 2 }, // ola   → seg A
      { start: 0, end: 2 }, // xyz   → seg A (posição atual, sem avançar)
      { start: 0, end: 2 }, // mundo → seg A (sem a correção cairia em B)
    ])
  })

  it('retorna array com o mesmo comprimento do diff', () => {
    const diff: DiffItem[] = [
      { type: 'equal', value: 'ola' },
      { type: 'removed', value: 'x' },
      { type: 'added', value: 'y' },
    ]

    expect(fp.mapDiffToWhisperSegments(diff, segments)).toHaveLength(3)
  })
})
