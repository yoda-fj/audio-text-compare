# Plano: Player de Áudio por Chunk

> **Objetivo**: permitir que o usuário ouça o trecho de áudio correspondente a cada chunk da transcrição, com o diff palavra-a-palavra mapeado para o chunk de origem. Visualização alternável entre o modo atual (inline/lado a lado) e o novo modo "Por Chunk".

---

## 0. Pré-requisito crítico: caminho do áudio

O schema atual de `comparisons` guarda apenas `audio_name` (nome do arquivo), **não o caminho absoluto**. Sem o caminho, o player não tem o que tocar.

**Decisão**: adicionar coluna `audio_path TEXT` (nullable) na migração v4 e passar a persistir o caminho absoluto no `save-comparison` / fluxo de transcrição.

- Comparações legadas (`audio_path` NULL): a UI mostra o modo "Por Chunk" desabilitado com tooltip *"Áudio original não disponível para esta comparação"*.
- Edge case: arquivo movido/deletado entre sessões → validar `fs.existsSync` no main antes de servir; se ausente, retornar erro tipado e a UI exibe o mesmo estado desabilitado com mensagem *"Arquivo de áudio não encontrado em <path>"*.

---

## 1. Schema do Banco (Migração v4)

`src/main/database.ts` — bump de `PRAGMA user_version` 3 → 4:

```sql
ALTER TABLE comparisons ADD COLUMN diff_result_chunks TEXT;  -- JSON de DiffItemWithChunk[], NULL p/ legadas
ALTER TABLE comparisons ADD COLUMN audio_path TEXT;          -- caminho absoluto do áudio original
```

- `diff_result` (atual) permanece intacto — modo de visualização atual não muda.
- Ambas as colunas **nullable** para compatibilidade com linhas existentes (mesmo padrão da v3 com `chunk_duration_s`).
- Os tempos de cada chunk **não** precisam ser duplicados no JSON: já existem em `chunks` (`start_s`, `end_s`, `chunk_index`). O JSON guarda só o índice.

### Tipo novo (em `src/renderer/types.ts` + compartilhado com main)

```ts
interface DiffItemWithChunk {
  value: string;
  added?: boolean;
  removed?: boolean;
  chunkIndex: number; // índice do chunk de origem (0-based)
}
```

---

## 2. Backend: Diff com Mapeamento de Chunk

**Arquivo**: `src/main/fileProcessor.ts`

Nova função pura:

```ts
compareTextsWithChunks(
  original: string,
  transcribed: string,
  chunks: { chunkIndex: number; text: string }[]
): DiffItemWithChunk[]
```

### Algoritmo

1. Pré-calcular o **acumulado de palavras por chunk**: `boundaries[i]` = total de palavras dos chunks `0..i`. Usar a **mesma tokenização/normalização** que o diff usa (whitespace split após trim/normalização de espaços) — divergência aqui é a principal fonte de off-by-one.
2. Rodar o diff palavra-a-palavra normal (pacote `diff`).
3. Percorrer os itens mantendo um contador `transcribedWordCount` (incrementa em itens `equal` e `added` — palavras que existem na transcrição).
4. Para cada item `equal`/`added`: `chunkIndex` = primeiro `i` tal que `transcribedWordCount < boundaries[i]` (busca linear com cursor, O(n) total).
5. Itens `removed` (palavra do original ausente na transcrição): herdam o `chunkIndex` do item de transcrição **anterior**; se ocorrem antes de qualquer palavra transcrita, `chunkIndex = 0`.
6. Itens multi-palavra do diff: dividir pelo limite do chunk se a contagem cruzar um boundary no meio do item (gera dois `DiffItemWithChunk` com o mesmo flag e índices distintos).

### Edge cases obrigatórios

| Cenário | Tratamento |
|---|---|
| Transcrição Whisper (1 chunk sintético cobrindo todo o áudio) | Todo o diff recebe `chunkIndex = 0`. Funciona naturalmente, mas a UI mostra um único bloco — aceitável. |
| Chunk com `text` vazio (silêncio) | `boundaries` não avança; nenhuma palavra mapeia para ele, mas o chunk **ainda aparece na UI** com player (pode haver áudio sem fala). |
| Soma das palavras dos chunks ≠ palavras do `transcribed_text` (espaços/normalização divergente) | Clampar no último chunk e logar warning no main — nunca lançar exceção no `finalizeComparison`. |
| Comparação pré-teste / parcial (`pretest: true`) | Mapear apenas os chunks existentes; diff `removed` do restante do original cai no último chunk processado. |

---

## 3. Persistência

**Arquivo**: `src/main/database.ts`

- `setComparisonDiffChunks(id: number, diff: DiffItemWithChunk[])` — `JSON.stringify` e `UPDATE`.
- `getComparisonDiffChunks(id: number): DiffItemWithChunk[] | null` — `JSON.parse` com try/catch (JSON corrompido → `null`, UI cai no modo padrão).
- `setComparisonAudioPath(id, path)` (ou incluir no insert existente).

**Arquivo**: `src/main/index.ts`

- No `finalizeComparison()`, após gerar e persistir o diff normal:
  1. Ler os chunks da comparação via `db` (ordenados por `chunk_index`).
  2. Chamar `compareTextsWithChunks()`.
  3. `setComparisonDiffChunks()`.
- Envolver em try/catch isolado: falha no diff-com-chunks **não pode** quebrar a finalização da comparação (feature degradável).

---

## 4. Acesso ao áudio no Renderer (IPC / Protocolo)

`file://` **não funciona** no renderer com `contextIsolation` + CSP padrão. Duas opções, em ordem de preferência:

### Opção A (recomendada): protocolo custom `app-audio://`

- `protocol.registerFileProtocol('app-audio', ...)` no main, **validando** que o path solicitado é exatamente o `audio_path` de uma comparação existente no DB (nunca servir path arbitrário vindo do renderer).
- Renderer usa `<audio src={'app-audio://' + comparisonId}>` — streaming nativo, seek instantâneo, sem cópia em memória.

### Opção B (fallback): handler IPC `read-audio-file`

- Retorna `Buffer` → renderer cria `Blob` + `URL.createObjectURL`.
- Mais simples, mas carrega o arquivo inteiro em memória (ruim p/ áudios longos) e exige `revokeObjectURL` no cleanup.

Seguir a convenção do projeto para qualquer canal novo: **registrar handler em `src/main/index.ts` → expor em `src/preload/index.ts` → tipar em `IElectronAPI` → atualizar a tabela de canais em `AGENTS.md`/`CLAUDE.md`**.

Canais novos previstos:

| Channel | Direção | Descrição |
|---|---|---|
| `get-comparison-diff-chunks` | renderer → main | Retorna `DiffItemWithChunk[]` ou `null` |
| `get-comparison-audio-info` | renderer → main | Retorna `{ available: boolean, reason?: string }` (valida existência do arquivo) |

---

## 5. Componentes Frontend

### `src/renderer/components/AudioPlayer.tsx` (novo)

Player de **um trecho** do áudio:

- Props: `src`, `startS`, `endS`.
- Um único elemento `<audio>` por chunk visível **ou** (melhor) um único `<audio>` global no `ChunkComparisonView` com controle de janela — evita N elementos de áudio para áudios grandes.
- Play: `audio.currentTime = startS; audio.play()`.
- Stop no fim do chunk: listener `timeupdate` com `if (currentTime >= endS) pause()` (precisão ~250ms, suficiente). Limpar listener no unmount.
- UI: botão play/pause, barra de progresso relativa ao trecho (`(currentTime - startS) / (endS - startS)`), tempo `mm:ss / mm:ss`.
- Garantir que apenas **um chunk toca por vez** (estado `playingChunkIndex` no pai).

### `src/renderer/components/ChunkComparisonView.tsx` (novo)

- Recebe `DiffItemWithChunk[]` + lista de chunks (`chunk_index`, `start_s`, `end_s`).
- Agrupa os itens do diff por `chunkIndex` e renderiza um card por chunk: cabeçalho (`Chunk N · 0:15–0:30` + AudioPlayer) + diff colorido reutilizando as classes existentes `.diff-added` / `.diff-removed` / `.diff-equal`.
- Estados vazios: chunk sem palavras (mostra "— sem fala detectada —"), `diff_result_chunks` NULL (não renderiza o modo).

### `src/renderer/components/ComparisonView.tsx` (alterado)

- Novo toggle de modo: `Inline | Lado a lado | Por Chunk` (terceiro botão só habilitado se `diff_result_chunks` e `audio_path` disponíveis — caso contrário, desabilitado com tooltip explicando).
- Carrega `get-comparison-diff-chunks` lazy (só ao entrar no modo).

Convenções a manter: UI em **pt-BR**, código em inglês, Tailwind com as classes de `@layer components` existentes, ícones `lucide-react` (`Play`, `Pause`, `Volume2`).

---

## 6. Testes

**Arquivo**: `src/main/fileProcessor.test.ts` (Vitest, mesmo padrão do `chunkMath.test.ts`)

Casos mínimos:

1. **2 chunks, textos iguais** → todos `equal`, índices 0 e 1 corretos no boundary exato.
2. **`removed` no início** (original tem palavras antes da 1ª palavra transcrita) → `chunkIndex = 0`.
3. **`removed` entre chunks** → herda o índice do item de transcrição anterior.
4. **`added` cruzando boundary** (item multi-palavra do diff atravessa o limite do chunk) → item dividido em dois com índices corretos.
5. **Chunk vazio no meio** → nenhum item mapeia para ele, índices dos vizinhos corretos.
6. **1 chunk só (caso Whisper)** → tudo em `chunkIndex 0`.
7. **Contagem divergente** (chunks somam menos palavras que o transcrito) → clamp no último chunk, sem throw.

**Arquivo**: `src/main/database.test.ts` (se existir) — round-trip `setComparisonDiffChunks`/`getComparisonDiffChunks` + JSON inválido retorna `null`.

### Validação manual

1. Migração: abrir DB v3 existente → app sobe, `PRAGMA user_version = 4`, dados preservados, colunas novas NULL nas linhas antigas.
2. Comparação nova (Gemma, 2+ chunks): abrir resultado → trocar para "Por Chunk" → cada card mostra o diff certo → tocar cada chunk e confirmar que o áudio corresponde ao texto e **para no fim do trecho**.
3. Tocar chunk 2 enquanto chunk 1 toca → chunk 1 pausa.
4. Comparação legada (sem `diff_result_chunks`): botão "Por Chunk" desabilitado com tooltip.
5. Mover o arquivo de áudio no disco → modo desabilitado com mensagem de arquivo não encontrado (sem crash).
6. Fluxo Whisper: modo mostra 1 chunk único cobrindo o áudio todo.

---

## 7. Documentação (convenção do projeto)

- `docs/SISTEMA.md`: novo modo de visualização, colunas v4, protocolo/canal de áudio.
- `AGENTS.md` / `CLAUDE.md`: adicionar os canais IPC novos à tabela.
- `STATUS.md`: registrar o estado ao final da sessão.

---

## 8. Checklist Final

- [ ] `npx tsc --noEmit` — sem erros
- [ ] `npm run lint` — sem erros
- [ ] `npm run test` — todos passando (incluindo os 7 novos casos)
- [ ] `npx vite build` — build OK
- [ ] Migração v3 → v4 validada com DB real
- [ ] Validação manual (itens 1–6 acima)

---

## Resumo dos arquivos

| Arquivo | Ação |
|---|---|
| `src/main/database.ts` | Migração v4 + 3 métodos novos |
| `src/main/fileProcessor.ts` (+ `.test.ts`) | `compareTextsWithChunks` + testes |
| `src/main/index.ts` | Hook no `finalizeComparison`, canais IPC, protocolo de áudio |
| `src/preload/index.ts` | Expor canais novos |
| `src/renderer/types.ts` | `DiffItemWithChunk` |
| `src/renderer/components/AudioPlayer.tsx` | **Novo** |
| `src/renderer/components/ChunkComparisonView.tsx` | **Novo** |
| `src/renderer/components/ComparisonView.tsx` | Toggle de 3 modos |
| `docs/SISTEMA.md`, `AGENTS.md`, `CLAUDE.md`, `STATUS.md` | Docs |