# Audio Text Compare — Documentação de Sistema

> Documento canônico do projeto. Cobre produto, arquitetura, stack, modelos de dados, protocolos e fluxos. Reflete o estado pós-v2 (modelo "comparação como projeto" com chunks persistidos).

---

## 1. Visão Geral do Produto

### 1.1. O que é

**Audio Text Compare** é um aplicativo desktop (Electron) que compara **a transcrição de um arquivo de áudio** com o **texto de um documento original**, indicando palavra por palavra onde há omissões, acréscimos e alterações.

Casos de uso:
- Revisar a fidelidade da leitura de um livro em formato de áudio.
- Conferir se um podcast transcrito bate com a pauta original.
- Avaliar a qualidade de um modelo de STT (speech-to-text) sobre uma amostra conhecida.
- Trabalho de legendagem — onde o documento é o roteiro e o áudio é a fala final.

### 1.2. Princípios de design

1. **Local-first.** Toda a inferência roda na máquina do usuário. Nenhum byte de áudio, documento ou transcrição sai do dispositivo.
2. **Modelo de "comparação como projeto".** Cada comparação é uma entidade nomeada, persistida desde o instante da criação até a conclusão, e pode ser retomada após fechamento do app ou crash.
3. **Resiliência a interrupções.** Chunks concluídos ficam no DB; um app morto no meio do chunk N pode ser reaberto e continuar do N+1 sem reprocessamento.
4. **Fonte de verdade única.** O estado vive no SQLite. Checkpoints em disco são derivados e podem ser regenerados a qualquer momento.

### 1.3. Funcionalidades atuais

- **Comparação palavra por palavra** com codificação de cores (verde correto, vermelho omitido, azul adicionado, amarelo alterado).
- **Suporte a documentos**: PDF, DOCX, TXT (com extração de intervalo de páginas opcional).
- **Suporte a áudio**: WAV, MP3, OGG, M4A, FLAC.
- **Dois modelos de transcrição**:
  - **Gemma 4** (E2B, E4B, 12B) via `transformers` — alta qualidade, requer mais RAM.
  - **Whisper Large v3** via `openai-whisper` — mais rápido, não requer token HF.
- **Pré-teste de transcrição** (Gemma e Whisper): processa só os primeiros N chunks para validar o modelo antes de rodar o áudio inteiro. O estado fica em `pending` com os chunks parciais em `done`; o usuário pode continuar de onde parou. No Whisper, é implementado via `clip_timestamps="0,N"` (parâmetro nativo do openai-whisper) — sem fatiamento de arquivo, sem I/O extra.
- **Duração de chunk configurável por projeto** (`chunk_duration_s`, 5–120s, padrão 30s): no Gemma é o tamanho real de cada chunk; no Whisper é a janela do pré-teste. Persistido por comparação e exposto via inputs inline no `AudioStep` (sem modal separado).
- **Chunking** para áudios longos no Gemma 4 (configurável, padrão 30s por chunk) com retomada.
- **Histórico persistente** de todas as comparações, com busca, exclusão e recarregamento.
- **Visualização lado a lado e inline** do diff.
- **Armazenamento seguro** do token do Hugging Face via `safeStorage` do Electron.
- **Modelos embutidos no instalador** (Whisper + Gemma 4 via cache do Hugging Face).

---

## 2. Arquitetura de Runtime

### 2.1. Processos Electron

```
┌─────────────────────────────────────────────────────────────────┐
│  Main Process (Node.js)  src/main/                              │
│  - Janela, app lifecycle                                       │
│  - SQLite (better-sqlite3)                                     │
│  - File system (file dialogs, model paths)                     │
│  - Spawn do Python (transcrição)                               │
│  - IPC handlers (orquestração DB ↔ eventos)                    │
└──────────┬──────────────────────────────────┬───────────────────┘
           │ contextBridge (preload)          │ child_process.spawn
           │                                  │
┌──────────▼──────────────┐         ┌─────────▼────────────────┐
│ Renderer (Chromium)     │         │ Python Process (3.12)     │
│ src/renderer/ (React)   │         │ venv isolado              │
│ - UI, estado, eventos   │         │ - transcribe_gemma4.py    │
│ - Sem acesso a Node     │         │ - transcribe_whisper.py   │
│ - contextIsolation=true │         │ - stderr: JSON events     │
└─────────────────────────┘         │ - stdout: resultado final │
                                    └──────────────────────────┘
```

| Processo | Linguagem | Pode acessar |
|----------|-----------|--------------|
| Main | Node.js + TS | tudo |
| Renderer | Chromium + React | só APIs expostas via preload |
| Preload | Node.js + TS (sandbox) | contextBridge |
| Python | Python 3.12 | só filesystem + HF model cache |

### 2.2. Fluxo de dados de uma transcrição

```
1. UI:    renderer.transcribeComparison(id, model, context)
2. IPC:   ipcMain.handle('transcribe-comparison')
3. Main:  DB.read comparison
          DB.read done chunks
          pythonClient.writeCheckpointFromDoneChunks()  ← checkpoint derivado
4. Main:  spawn('python', [transcribe_gemma4.py, --checkpoint-file=...])
5. Py:    emite stderr (1 JSON por linha) durante o loop
6. Main:  onEvent(event):
            upsert chunk no DB
            webContents.send('python-event', event)
7. Py:    exit 0 + stdout {"type":"result","text":"..."}
8. Main:  fileProcessor.compareTexts(original, transcribed)
          DB.setComparisonResult(diff, accuracy)
          DB.setComparisonStatus('completed')
          deleteCheckpoint()
9. UI:    renderer recebe { success: true } da Promise
          recarrega comparison do DB
          transita para step 3 (ResultStep)
```

### 2.3. Fluxo de cancelamento

```
1. UI:    renderer.cancelComparison(id)  (clique no "X" da TranscriptionModal)
2. IPC:   ipcMain.handle('cancel-comparison')
3. Main:  pythonClient.cancel()            ← SIGTERM, SIGKILL após 5s
          DB.resetInFlightChunks()         ← status: transcribing → pending
          DB.setComparisonStatus('cancelled')
          deleteCheckpoint()
4. Py:    recebe SIGTERM → exit ≠ 0
5. Main:  spawn Promise resolve com exitCode != 0
          cancelled=true → skip error path (DB já está em 'cancelled')
```

---

## 3. Stack e Estratégia de Bibliotecas

### 3.1. Visão geral

| Camada | Tecnologia | Por quê essa escolha |
|--------|-----------|----------------------|
| **Runtime desktop** | Electron 33 | Necessário para integrar com HF models locais e `safeStorage` |
| **UI** | React 18 + TypeScript | Ecossistema maduro, types fortes no IPC |
| **Bundler** | Vite 6 | HMR rápido, build com 3 entradas (main, preload, renderer) |
| **Estilização** | Tailwind CSS 3 | Produtividade, paleta customizável, sem CSS-in-JS runtime |
| **DB** | better-sqlite3 | Síncrono (simples), rápido, bindings nativos sem build extra |
| **Diff** | `diff` (npm) | Padrão de mercado para word-level diff em JS |
| **PDF** | pdfjs-dist + pdf-parse | Renderiza o PDF, extrai texto página-a-página |
| **DOCX** | mammoth | Mantém só o texto, ignora formatação |
| **Ícones** | lucide-react | Tree-shakeable, SVG inline, sem font asset |
| **Drag & drop** | react-dropzone | Componente de dropzone robusto e acessível |
| **Empacotamento** | electron-builder | Suporte multiplataforma (DMG, NSIS, AppImage, deb) |

### 3.2. Estratégia Python

- **Isolamento total** em venv gerenciado pelo app (`app.getPath('userData')/python_env`). Nada de Python do sistema.
- **Auto-setup lazy.** O venv é criado na primeira vez que o usuário tenta transcrever. Antes disso, o app funciona normalmente (carrega histórico, lê documentos).
- **Sem servidor persistente.** Cada transcrição é um `spawn` do tipo `python script.py args…`. O processo morre ao terminar. Decisão consciente para máquinas de 16GB: manter ~9GB de modelo Gemma residentes em troca de velocidade de inicialização não compensa.
- **Protocolo unidirecional via stderr.** Cada script emite **uma linha JSON por evento** em stderr, com discriminador `type`. Linhas não-JSON são logs do Python ignorados pelo consumidor.
- **stdout reservado para o resultado final** (uma única linha `{"type":"result","text":...}` em sucesso). Isso permite parsear o resultado de forma trivial sem misturar com progresso.

### 3.3. Modelos suportados

| Modelo | Tamanho | Memória RAM | Caso de uso |
|--------|---------|-------------|-------------|
| `whisper-large-v3` | ~3 GB | 4 GB | Áudios longos: 1 chunk sintético cobrindo o intervalo (full ou pré-teste via `clip_timestamps`) |
| `google/gemma-4-E2B-it` | ~6 GB | 8-10 GB | Padrão em máquinas de 16 GB |
| `google/gemma-4-E4B-it` | ~10 GB | 12-14 GB | Equilíbrio |
| `google/gemma-4-12B-it` | ~24 GB | 20+ GB | Qualidade máxima, offload de disco |

O Whisper é processado em uma única chamada (1 chunk sintético). Sem pré-teste, o chunk sintético cobre `[0, duração_total]`; com pré-teste, cobre `[0, max_chunks × chunk_duration_s]`. O Gemma faz chunking interno configurável (padrão 30s).

**`initial_prompt` do Whisper é sanitizado** (`sanitize_initial_prompt` em `transcribe_whisper.py`). O Whisper usa o prompt como viés de vocabulário: se o final do documento contém citações, rodapés ou referências em outros idiomas (chinês, árabe, etc.), o modelo "aprende" a gerar esses caracteres no meio da transcrição em pt-BR. Sintomas típicos nos logs: tokens como 瞳孫瞳, 其其其, 人們認識 no meio de fala clara em português. A sanitização filtra para `[A-Za-zÀ-ÖØ-öø-ÿ]` + dígitos + pontuação comum + espaço, colapsa whitespace e retorna o **fim** do texto (Whisper só usa os últimos ~224 tokens). Se não sobrar nada útil, retorna `None` (Whisper usa o idioma `--language=pt` puro). Cobre: CJK, cirílico, árabe, emoji, símbolos não-latinos. Mantém acentos BR.

### 3.4. Estratégia de dependências externas

- **better-sqlite3, pdf-parse, pdfjs-dist** são marcados como `external` no rollup do main process (não são empacotados pelo Vite, são carregados do `node_modules` em runtime).
- **Modelos** ficam em `assets/models/` no projeto, copiados para `process.resourcesPath/assets/models/` no app empacotado via `electron-builder.json5` (`extraResources`).
- **Token HF** nunca trafega em argumentos de linha de comando; é gravado em arquivo temporário e injetado via `HUGGING_FACE_HUB_TOKEN`.

---

## 4. Estrutura do Projeto

```
audio-text-compare/
├── docs/                      # ← você está aqui
├── src/
│   ├── main/                  # Node.js (Electron main process)
│   │   ├── index.ts           # Entry point, IPC handlers, orquestração DB↔eventos
│   │   ├── database.ts        # SQLite + migrações (v1 → v2)
│   │   ├── fileProcessor.ts   # Leitura de PDF/DOCX/TXT + word-level diff
│   │   ├── pythonClient.ts    # Spawn unificado, buffer de linha, cancel com SIGKILL
│   │   └── python/            # Scripts empacotados (copiados para dist/main/python)
│   │       ├── _whisper_common.py
│   │       ├── transcribe_gemma4.py
│   │       ├── transcribe_whisper.py
│   │       ├── transcribe_chunk.py        # (fora de escopo nesta fase)
│   │       ├── setup_venv.py
│   │       ├── download_model.py          # (legado, removido do UI)
│   │       ├── get_audio_duration.py
│   │       └── requirements.txt
│   ├── preload/
│   │   └── index.ts           # contextBridge — única ponte renderer↔main
│   └── renderer/              # React app
│       ├── App.tsx            # Orquestrador: boot, currentComparison, steps
│       ├── main.tsx           # ReactDOM.createRoot
│       ├── types.ts           # ComparisonStatus, ChunkRun, PythonEvent, etc.
│       ├── components/
│       │   ├── NewComparisonModal.tsx     # Modal inicial (pede nome)
│       │   ├── ComparisonHeader.tsx       # Header com status + step indicator
│       │   ├── ChunkListPanel.tsx         # Tabela de chunks (start/end/status)
│       │   ├── ChunkDetailModal.tsx       # Detalhe de um chunk + retry
│       │   ├── HistoryPanel.tsx           # Histórico lateral
│       │   ├── TranscriptionModal.tsx     # Progresso + cancel durante job
│       │   ├── SettingsModal.tsx          # Token HF
│       │   ├── ComparisonView.tsx         # Diff (lado a lado / inline)
│       │   ├── FileDropzone.tsx
│       │   ├── ProgressBar.tsx
│       │   └── steps/                     # Wizard de 3 passos
│       │       ├── StepIndicator.tsx
│       │       ├── DocumentStep.tsx
│       │       ├── AudioStep.tsx          # Inputs inline de chunk_duration_s e max_chunks
│       │       └── ResultStep.tsx
│       └── styles/index.css
├── scripts/                   # Utilitários de build
│   └── prepare-assets.js      # Copia modelos do cache HF para assets/ (npm run prepare-assets)
├── assets/models/             # Modelos copiados para o app via extraResources
├── dist/                      # Build output (renderer, main, preload, python)
├── release/                   # Empacotado pelo electron-builder
├── AGENTS.md                  # Guia para agentes
├── README.md                  # README público
├── STATUS.md                  # Estado/handoff de sessões
├── docs/SISTEMA.md            # ← ESTE ARQUIVO
├── electron-builder.json5     # Config de empacotamento
├── vite.config.ts             # Bundler config
├── tailwind.config.cjs
├── postcss.config.cjs
├── tsconfig.json
├── tsconfig.node.json
└── package.json
```

---

## 5. Modelo de Dados (SQLite v2)

### 5.1. Tabela `comparisons`

```sql
CREATE TABLE comparisons (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL,                  -- v2
  name            TEXT    NOT NULL,                  -- v2 (ex: "Lição 03 — v1")
  status          TEXT    NOT NULL DEFAULT 'completed',  -- v2
  document_path   TEXT,                              -- v2 (path real no disco)
  audio_path      TEXT,                              -- v2
  document_name   TEXT    NOT NULL,                  -- v1 (vestigial)
  audio_name      TEXT    NOT NULL,                  -- v1
  original_text   TEXT    NOT NULL,                  -- v1
  transcribed_text TEXT   NOT NULL,                  -- v1
  diff_result     TEXT    NOT NULL,                  -- v1 (JSON)
  accuracy_score  REAL    NOT NULL,                  -- v1
  model_used      TEXT    NOT NULL,                  -- v1
  error_message   TEXT                               -- v2
);
```

**Vocabulário único de `status`** (DB ↔ IPC ↔ React):
- `pending` — criada, sem documento/áudio
- `transcribing` — transcrição em andamento (chunks ativos)
- `completed` — diff finalizado
- `error` — falhou (mensagem em `error_message`)
- `cancelled` — usuário cancelou

### 5.2. Tabela `chunks`

```sql
CREATE TABLE chunks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  comparison_id   INTEGER NOT NULL REFERENCES comparisons(id) ON DELETE CASCADE,
  chunk_index     INTEGER NOT NULL,
  total_chunks    INTEGER NOT NULL,
  start_s         REAL    NOT NULL,                  -- segundos
  end_s           REAL    NOT NULL,                  -- segundos
  status          TEXT    NOT NULL DEFAULT 'pending', -- pending|transcribing|done|error
  text            TEXT,
  error_message   TEXT,
  duration_ms     INTEGER,                           -- tempo de processamento
  created_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL,
  UNIQUE (comparison_id, chunk_index)
);
CREATE INDEX idx_chunks_comparison ON chunks(comparison_id);
```

`PRAGMA foreign_keys = ON` é habilitado em toda abertura de conexão; deletar uma comparação cascateia para os chunks.

**`UNIQUE(comparison_id, chunk_index) + ON CONFLICT DO UPDATE`** torna o upsert **idempotente**: se o checkpoint for perdido e o Python reprocessar chunks, nada duplica.

### 5.3. Migração v1 → v2

A migração é **aditiva** (sem perda de dados), roda dentro de uma transação, e agora é **idempotente** (lê `PRAGMA table_info` e só faz `ALTER TABLE ADD COLUMN` para colunas ausentes). Versão controlada por `PRAGMA user_version`:

```sql
PRAGMA user_version = 1;  -- schema original
PRAGMA user_version = 2;  -- adiciona colunas v2 + tabela chunks
```

Backfill automático:
```sql
UPDATE comparisons SET name = 'Comparação ' || id WHERE name IS NULL;
UPDATE comparisons SET updated_at = created_at WHERE updated_at IS NULL;
```

Linhas legadas ficam com `status = 'completed'` (DEFAULT na nova coluna), sem chunks retroativos.

### 5.4. Onde os dados vivem

| Dado | Localização |
|------|-------------|
| DB SQLite | `app.getPath('userData')/comparisons.db` |
| venv Python | `app.getPath('userData')/python_env/` |
| Checkpoints JSON | `app.getPath('userData')/transcription_checkpoints/<comparison_id>.json` |
| Modelos Whisper | `process.resourcesPath/assets/models/whisper/` |
| Cache HuggingFace | `process.resourcesPath/assets/models/huggingface/` |
| Token HF (criptografado) | tabela `settings` (chave `hf_token`) |

`userData` no macOS: `~/Library/Application Support/audio-text-compare/`.

---

## 6. Protocolo Python ↔ Node

### 6.1. Eventos estruturados (stderr, 1 JSON por linha)

```ts
type PythonEvent =
  | { type: 'progress'; progress: number; message: string; event?: string;
      chunk_index?: number; chunk_start_s?: number; chunk_end_s?: number;
      total_chunks?: number; duration?: number }
  | { type: 'chunk_start'; chunk_index: number; chunk_start_s: number;
      chunk_end_s: number; total_chunks: number; progress: number; message: string }
  | { type: 'chunk_done'; chunk_index: number; text: string; duration_ms: number;
      progress: number; message: string }
  | { type: 'chunk_error'; chunk_index: number; error_message: string;
      progress: number; message: string }
  | { type: 'error'; message: string }
```

**`stdout` é reservado para o resultado final:** `{"type":"result","text":"..."}` (sucesso) ou nada (erro → exit ≠ 0).

### 6.2. Buffer de linha obrigatório

Um `chunk_done` com texto longo pode chegar fracionado em múltiplos eventos `data` no stderr. O `pythonClient` acumula bytes e fatia por `\n` antes de parsear. Parsear `data` cru quebraria o JSON.

```ts
proc.stderr.on('data', (chunk: Buffer) => {
  stderrBuffer += chunk.toString('utf-8')
  const lines = stderrBuffer.split(/\r?\n/)
  stderrBuffer = lines.pop() ?? ''           // última linha parcial
  for (const line of lines) {
    this.handleScriptLine(line.trim(), onEvent)  // tenta JSON.parse
  }
})
```

Linhas não-JSON são ignoradas silenciosamente (warnings do Python, etc.). Nunca derrubam o cliente.

### 6.3. Tabela de transições

| Evento Python | Ação do Node |
|---------------|--------------|
| `chunk_start` | `db.upsertChunk({ status: 'transcribing', start_s, end_s, total_chunks })` |
| `chunk_done` | `db.setChunkResult({ status: 'done', text, duration_ms })` + `touchComparison` |
| `chunk_error` + exit ≠ 0 | `db.setChunkResult({ status: 'error', error_message })` + `db.setComparisonStatus('error', msg)` |
| `result { pretest: true }` + exit 0 | **Pré-teste**: `db.setComparisonStatus('pending')` (NÃO `completed`); checkpoint mantido em disco para continuação |
| `result` no stdout + exit 0 (sem `pretest`) | `db.setComparisonResult(diff, accuracy)` + `db.setComparisonStatus('completed')` + `deleteCheckpoint()` |
| `cancel()` do usuário | `pythonClient.cancel()` (SIGTERM, SIGKILL após 5s) + `db.resetInFlightChunks()` + `db.setComparisonStatus('cancelled')` + `deleteCheckpoint()` |
| exit ≠ 0 sem `chunk_error` | `db.setComparisonStatus('error', "<stderr última linha>")` |

---

## 7. IPC

### 7.1. Canais `invoke`/`handle` (request/response)

#### Arquivos
| Channel | Args | Returns |
|---------|------|---------|
| `select-file` | `{ filters }` | `string \| null` |
| `read-document` | `path, { pageStart?, pageEnd? }` | `{ text, error? }` |

#### Comparação (fluxo v2)
| Channel | Args | Returns |
|---------|------|---------|
| `create-comparison` | `name: string` | `ComparisonRecord` |
| `get-active-comparisons` | — | `ComparisonRecord[]` (pending + transcribing) |
| `set-comparison-document` | `id, path, name, text` | `ComparisonRecord \| undefined` |
| `set-comparison-audio` | `id, path, name` | `ComparisonRecord \| undefined` |
| `set-comparison-chunk-duration` | `id, seconds` | `ComparisonRecord \| undefined` (clamp canônico [5, 120]s aplicado no main) |
| `get-comparison-chunks` | `id` | `ChunkRun[]` (mapeado de `start_s`/`end_s` para `chunk_start_s`/`chunk_end_s`) |
| `mark-comparison-error` | `id, errorMessage` | `ComparisonRecord` (regra anti-zumbi) |
| `cancel-comparison` | `id` | `ComparisonRecord` |
| `transcribe-comparison` | `id, model, context?, maxChunks?, chunkDurationS?` | `{ success, partial?, error? }` (`partial=true` quando foi pré-teste; pré-teste funciona para Gemma E Whisper) |

#### Legado (v1) — mantido para HistoryPanel
| Channel | Args | Returns |
|---------|------|---------|
| `compare-texts` | `original, transcribed` | `DiffItem[]` |
| `save-comparison` | `data` | `number` (id) |
| `get-comparisons` | — | `ComparisonRecord[]` |
| `get-comparison` | `id` | `ComparisonRecord \| undefined` |
| `delete-comparison` | `id` | `void` |

#### Settings
| Channel | Args | Returns |
|---------|------|---------|
| `save-setting` | `key, value` | `void` (criptografado via `safeStorage`) |
| `get-setting` | `key` | `string \| null` (descriptografado) |
| `check-python-status` | — | `{ ready, python?, message }` |

### 7.2. Canais `send`/`on` (eventos push)

| Channel | Args | Quem envia | Quem recebe |
|---------|------|------------|-------------|
| `python-event` | `comparisonId, event: PythonEvent` | main | renderer |
| `transcription-progress` | `comparisonId, progress, message` | main | renderer |

Ambos os streams carregam o `comparisonId` no payload, permitindo que o renderer filtre pelo job atual (caso o usuário tenha múltiplas comparações em estados diferentes no DB).

---

## 8. UI / Renderer

### 8.1. Hierarquia de componentes

```
App
├── ComparisonHeader              (mostrado em todos os steps quando há currentComparison)
├── StepIndicator
├── DocumentStep | AudioStep | ResultStep
│   └── FileDropzone, ProgressBar, TranscriptionModal, ChunkListPanel
├── ChunkDetailModal
├── NewComparisonModal
├── HistoryPanel
├── SettingsModal
└── ResumePrompt                  (prompt de boot se há comparação em andamento)
```

### 8.2. Estado no App.tsx

```ts
const [currentComparison, setCurrentComparison] = useState<ComparisonRecord | null>(null)
const [chunks, setChunks] = useState<ChunkRun[]>([])
const [currentStep, setCurrentStep] = useState<ComparisonStep>(1 | 2 | 3)

// UI
const [showNewComparisonModal, setShowNewComparisonModal] = useState(false)
const [resumePrompt, setResumePrompt] = useState<ComparisonRecord[] | null>(null)
const [showHistory, showSettings, ...]

// Transcrição
const [isProcessing, progress, progressMessage]

// Espelhos de currentComparison (para passar aos steps)
const [documentPath, documentText, audioPath, transcribedText, comparison]
const [selectedModel, pdfPageStart, pdfPageEnd]

// Modal de chunk
const [selectedChunk, showChunkDetail]
```

### 8.3. Fluxo de boot (regra anti-zumbi)

```
mount → checkPythonStatus() + getActiveComparisons() em paralelo
  ├─ array vazio
  │   └─ showNewComparisonModal(true)
  └─ array com pending/transcribing
      └─ setResumePrompt(active)
          ├─ user clica "Retomar"
          │   └─ loadComparison(active[0]) → setCurrentStep apropriado
          └─ user clica "Não retomar"
              ├─ para cada transcribing: markComparisonError(...)
              └─ showNewComparisonModal(true)
```

**Por que importa:** uma comparação `transcribing` no boot não tem processo vivo (o app acabou de abrir). Se o usuário recusa a retomada, ela é marcada `error` para nunca ficar eternamente em `transcribing`.

### 8.4. Fluxo de transcrição no renderer

```
handleTranscribe()
  ├─ subscribe onPythonEvent + onTranscriptionProgress (filtrado por currentComparison.id)
  ├─ transcribeComparison(id, model, context)         ← Promise
  │   └─ main processa (ver §2.2)
  ├─ await resolution → { success, error? }
  ├─ cleanup subscriptions
  ├─ refreshComparison + refreshChunks do DB
  └─ se success: setCurrentStep(3) e popula `comparison` a partir do DB
```

A cada evento `chunk_start | chunk_done | chunk_error` recebido via `onPythonEvent`, o renderer chama `refreshChunks(id)` que rebusca a tabela `chunks` do DB (fonte de verdade).

### 8.5. Botão "Nova comparação" (do step 2 ou 3)

```ts
const openNewComparisonModal = async () => {
  if (currentComparison && isProcessing) {
    await window.electronAPI.cancelComparison(currentComparison.id!)
    // ... DB já marca como cancelled, apaga checkpoint
  }
  setShowNewComparisonModal(true)
}
```

A ordem importa: **cancela primeiro, depois abre o modal**. Caso contrário o usuário poderia criar uma nova comparação enquanto o processo Python anterior ainda escreve no DB.

### 8.6. UX de "pedir mais N chunks" (resume cumulativo)

O input de `max_chunks` no `AudioStep` é **cumulativo** com o que já foi processado. O `maxChunks` é parâmetro da execução (não persistido) e sempre volta a 0 ao recarregar a comparação.

| Cenário | UI mostra | Botão principal | Comportamento |
|---------|-----------|-----------------|---------------|
| Nova transcrição, sem chunks done | "Pré-teste (N chunks)" | "Transcrever áudio" / "Pré-teste: N chunk(s)" | Processa N chunks a partir do 0 (Gemma) ou `[0, N×dur]` (Whisper) |
| Resume (chunks done > 0), maxChunks = 0 | "Adicionar mais N chunks" (label) | "Continuar transcrição" | Retoma do próximo chunk não processado em diante (Gemma) ou retranscreve `[0, duração_total]` (Whisper) |
| Resume (chunks done > 0), maxChunks > 0 | "Adicionar mais N chunks" + banner explica soma | "Continuar + N chunk(s)" | Processa N chunks **novos** a partir do `doneChunksCount + 1` (Gemma) ou transcreve `[0, (doneChunksCount + N) × dur]` (Whisper) |

A semântica é diferente entre Gemma e Whisper:
- **Gemma**: o checkpoint é regenerado pelo Node antes do spawn a partir dos chunks `done` do DB. O Python processa N chunks a partir do `doneChunksCount + 1` e para. O upsert idempotente (`ON CONFLICT`) garante que o índice 0 do pretest é sobrescrito em execuções subsequentes — o DB se mantém consistente.
- **Whisper**: o `clip_timestamps="0,X"` sempre começa em 0. "Adicionar mais 5" com 3 já feitos vai para `[0, 8×dur]`, não `[3×dur, 8×dur]`. O banner do UI alerta que a janela é cumulativa no eixo do tempo, não nos índices. A re-execução sobrescreve o chunk sintético no DB (`ON CONFLICT (comparison_id, chunk_index) DO UPDATE`), então o `end_s` é atualizado para o novo `chunkEndS`.

---

## 9. Estratégia de Checkpoint (chave do design)

### 9.1. Princípio

A tabela `chunks` no SQLite é a **única fonte de verdade**. O arquivo JSON de checkpoint em disco é um **artefato derivado**, gerado pelo Node antes de cada execução do Python, e descartável.

### 9.2. Por que derivar e não ler direto

O `transcribe_gemma4.py` precisa saber quais chunks já foram processados para retomar o loop. Ele faz isso lendo `checkpoint-file` (JSON). Se deixarmos o Python ser dono do checkpoint:
- Estado duplicado em dois lugares.
- Conflitos quando o usuário cancela mid-run e o Python sai antes de gravar o último chunk.
- Impossível retomar se o arquivo for corrompido.

Solução: o Node sempre regenera o checkpoint a partir do DB antes de spawnar.

```ts
// antes do spawn (Gemma)
const doneChunks = db.getDoneChunks(id)
if (doneChunks.length > 0) {
  pythonClient.writeCheckpointFromDoneChunks(id, audioPath, model, doneChunks, total)
} else {
  pythonClient.deleteCheckpoint(id)  // garante que não há lixo de uma execução anterior
}
```

### 9.3. Idempotência

Como `chunks` tem `UNIQUE(comparison_id, chunk_index)` e o upsert é `ON CONFLICT DO UPDATE`, mesmo que o Python reprocesse um chunk que o DB já tem (cenário de crash + retomada + replay), nada duplica.

### 9.4. Apagamento determinístico

Checkpoint é apagado pelo Node em três transições terminais:
- `completed` (sucesso)
- `error` (falha)
- `cancelled` (usuário desistiu)

Path namespaceado por `comparison_id`: `transcription_checkpoints/<id>.json`. Comparações distintas nunca compartilham arquivo.

---

## 10. Segurança

- **`contextIsolation: true`** + **`nodeIntegration: false`** em toda `BrowserWindow`.
- Toda comunicação renderer↔main passa por **handlers IPC explícitos** registrados em `ipcMain.handle(...)`.
- **Preload expõe apenas a API declarada** em `IElectronAPI` via `contextBridge.exposeInMainWorld('electronAPI', api)`.
- **Token HF** nunca trafega em argumento de linha de comando; é gravado em arquivo temporário com `0600` e referenciado por `--hf-token-file` (mas no estado atual do código esse token é persistido criptografado em `settings` e lido direto pelo main, passado via env var).
- **Settings sensíveis** são criptografados com `safeStorage` (chave do SO) ou fallback AES-256-CBC com chave derivada de `userData + hostname + USER` se o keychain não estiver disponível.
- **`better-sqlite3`, `pdf-parse`, `pdfjs-dist`** são `external` no build do main — não são empacotados pelo Vite, são resolvidos do `node_modules` em runtime (evita problemas de binding nativo).

---

## 11. Build & Runtime

### 11.1. Comandos

```bash
# Setup
npm install

# Dev (Vite HMR + Electron)
npm run dev

# Build completo (tsc → vite → electron-builder)
npm run build

# Lint
npm run lint

# Copia modelos do cache HF do usuário para assets/models/
npm run prepare-assets
```

### 11.2. Pipeline de build

```
1. tsc               — type-check de src/**/*.ts, src/**/*.tsx (noEmit)
2. vite build        — 3 entradas (main, preload, renderer)
                       + plugin copyPythonFiles (copia src/main/python/* → dist/main/python)
                       + minify: false, sourcemap: true
3. electron-builder  — empacota dist/ + assets/models/ em release/<platform>/
```

Saídas:
- macOS: `release/mac-arm64/Audio Text Compare.app` (DMG + ZIP)
- Windows: `release/*.exe` (NSIS + portable)
- Linux: `release/*.AppImage` e `release/*.deb`

### 11.3. Resolução de paths em dev vs prod

`pythonClient.resolvePythonScript(name)`:
- dev (`VITE_DEV_SERVER_URL` set): `path.join(process.cwd(), 'src/main/python', name)`
- prod: `path.join(__dirname, '../python', name)` (resolve para `dist/main/python/`)

`getModelBaseDir()`:
- dev: `path.join(process.cwd(), 'assets', 'models')`
- prod: `path.join(process.resourcesPath, 'assets', 'models')` (vindo do `extraResources`)

---

## 12. Limitações Conhecidas e Fora de Escopo

### 12.1. Limitações atuais

- **16 GB de RAM é o floor.** Modelos Gemma 4 maiores que E2B exigem offload agressivo para disco (lento). 12B praticamente inviável.
- **Primeira transcrição é LENTA** (10–30 min) devido a download do modelo e setup do venv.
- **Sem testes automatizados.** Não há framework de teste configurado.
- **Sem retry por chunk.** O botão "Reexecutar" em ChunkDetailModal re-roda a transcrição inteira (mas pula os chunks `done` via checkpoint).
- **Sem servidor Python persistente.** Cada job é um `spawn`. Trade-off consciente para 16GB.

### 12.2. Explicitamente fora de escopo (plano v2)

- `transcribe_chunk.py` (single-shot por chunk). Substituído por retomada via checkpoint derivado.
- Segmentos do Whisper como chunks reais. Whisper tem 1 chunk sintético.
- Migrations destrutivas (e.g., recriar tabela para relaxar constraints). Mantemos as colunas v1 `NOT NULL` e inserimos `''` no `createComparison`.

### 12.3. Pontos para revisões futuras

- Retry granular por chunk (exige `transcribe_chunk.py` ou um orchestrator em Node).
- Edição do texto transcrito inline.
- Exportar diff em PDF/Markdown.
- Múltiplos idiomas para Whisper (hoje fixo em `pt`).
- Migração real do schema (cópia tabela → drop → rename) para relaxar constraints herdadas.

---

## 13. Padrões de Código

### 13.1. TypeScript

- `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`
- `strict: true`, `noUnusedLocals: true`, `noUnusedParameters: true`
- `noEmit: true` — Vite compila, `tsc` só checa
- Aliases: `@/`, `@main/`, `@renderer/` (vite + tsconfig)

### 13.2. Estilização

- Tailwind CSS via classes utilitárias
- Classes custom em `src/renderer/styles/index.css` (`.btn-primary`, `.card`, `.diff-*`, etc.)
- Paleta: `primary` (azul-ciano)

### 13.3. Idioma

- **UI, comentários, mensagens de erro**: Português (Brasil)
- **Código, tipos, nomes de variável**: Inglês
- Mensagens técnicas (logs Python) podem ser em inglês

### 13.4. Convenção de commits

Padrão `tipo: descrição curta` em português:
- `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`

---

## 14. Apêndice: Tabelas de referência rápida

### 14.1. Caminhos importantes

| Recurso | Dev | Produção |
|---------|-----|----------|
| DB | `~/Library/Application Support/audio-text-compare/comparisons.db` | mesmo |
| venv Python | `~/Library/Application Support/audio-text-compare/python_env/` | mesmo |
| Checkpoints | `~/Library/Application Support/audio-text-compare/transcription_checkpoints/<id>.json` | mesmo |
| Modelos | `<repo>/assets/models/` | `<app>/Resources/assets/models/` |
| Python scripts | `<repo>/src/main/python/` | `<app>/Resources/app/dist/main/python/` |

### 14.2. Variáveis de ambiente

| Variável | Quem define | Efeito |
|----------|-------------|--------|
| `VITE_DEV_SERVER_URL` | Vite dev server | Sinaliza modo dev para `pythonClient` resolver paths |
| `PYTHONUNBUFFERED=1` | pythonClient (sempre) | Garante que `print` no Python flush imediato |
| `USER` | OS | Usado no fallback AES-256-CBC |
| `HUGGING_FACE_HUB_TOKEN` | pythonClient (em setup_venv / setup) | Autentica download do Gemma 4 |

### 14.3. Glossário

- **Chunk** — fatia de áudio de duração fixa (configurável por projeto via `chunk_duration_s`, padrão 30s, faixa 5–120s, para Gemma; para Whisper a duração é usada como janela do pré-teste quando `max_chunks > 0`; sem pré-teste, o Whisper tem 1 fatia sintética cobrindo o áudio inteiro via `clip_timestamps="0"`).
- **Checkpoint** — arquivo JSON em `transcription_checkpoints/` com os textos dos chunks já processados. Lido pelo Python para retomada, escrito pelo Node a partir do DB.
- **Comparação** — entidade do projeto (linha na tabela `comparisons`). Tem nome, status, doc, áudio, diff, chunks. É a unidade de trabalho do usuário.
- **Boot** — o momento em que o app inicia. Único ponto onde se aplicam regras anti-zumbi e o prompt de retomada.
