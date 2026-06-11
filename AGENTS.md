# Audio Text Compare — Guia para Agentes

> Arquivo de referência para agentes de código que trabalham neste projeto. Leia isto antes de fazer qualquer alteração.

---

## SEMPRE FAZER

- Consultar o `STATUS.md` ao iniciar a sessão para saber onde a sessão anterior parou.
- Atualizar o `STATUS.md` ao final de cada sessão para que a próxima saiba de onde continuar.
- Sempre que houver alteração relevante na arquitetura ou no comportamento do app, atualizar também o `docs/SISTEMA.md`.
- Ao criar ou modificar lógica de negócio (comparação de textos, leitura de arquivos, banco de dados, cliente Python), criar ou atualizar os testes correspondentes (ver seção **Testes**).
- Antes de considerar qualquer tarefa concluída, rodar:
  1. `npx tsc --noEmit` — checagem de tipos (deve passar sem erros).
  2. `npm run lint` — ESLint (deve passar sem erros).
  3. `npm run test` — testes unitários (devem passar; se o Vitest ainda não estiver configurado, ver seção **Testes**).
- Validar manualmente o fluxo afetado antes de finalizar (ver **Validação Manual**).

## NUNCA FAZER

- Não commitar arquivos de banco de dados (`*.db`) nem o diretório `release/`.
- Não adicionar novas dependências (npm ou Python) sem justificar a necessidade.
- Não alterar `electron-builder.json5` sem solicitação explícita.
- Não mover o acesso a Node.js/sistema de arquivos para o renderer — toda operação privilegiada passa pelo main process via IPC.
- Não remover o `better-sqlite3` da lista `rollupOptions.external` no `vite.config.ts`.

---

## Visão Geral do Projeto

**Audio Text Compare** é uma aplicação desktop construída com Electron que compara transcrições de áudio com documentos originais usando IA local (modelos Gemma 4 via Hugging Face / transformers). O fluxo principal é:

1. O usuário seleciona um documento original (PDF, DOCX ou TXT).
2. O usuário seleciona um arquivo de áudio (WAV, MP3, OGG, M4A, FLAC).
3. O áudio é enviado para um processo Python que executa o modelo Gemma 4 nativamente (via `transformers`) para transcrição.
4. O texto transcrito é comparado palavra por palavra com o documento original.
5. O resultado da comparação é exibido com codificação de cores e pode ser salvo em um banco SQLite local para histórico.

---

## Stack Tecnológica

| Camada | Tecnologia |
|--------|-----------|
| Framework Desktop | Electron 33 |
| Bundler / Dev Server | Vite 6 |
| UI | React 18 + TypeScript |
| Estilização | Tailwind CSS 3 + PostCSS + Autoprefixer |
| Banco de Dados | better-sqlite3 |
| Transcrição | Python 3.12 + transformers + Gemma 4 (Hugging Face) |
| Leitura de DOCX | mammoth |
| Leitura de PDF | pdf-parse |
| Diff de Texto | diff (pacote npm) |
| Ícones | lucide-react |
| Empacotamento | electron-builder |

---

## Estrutura de Diretórios

```
src/
├── main/                   # Processo principal do Electron (Node.js)
│   ├── index.ts            # Ponto de entrada, cria janela, registra IPC handlers
│   ├── database.ts         # Gerenciamento do SQLite (histórico de comparações)
│   ├── fileProcessor.ts    # Leitura de PDF/DOCX/TXT e comparação de textos
│   ├── pythonClient.ts     # Gerenciamento do venv Python e execução da transcrição
│   └── python/             # Scripts Python empacotados com o app
│       ├── setup_venv.py        # Cria e configura o ambiente virtual Python
│       ├── transcribe_gemma4.py # Transcrição usando Gemma 4 via transformers
│       └── requirements.txt     # Dependências Python
├── preload/               # Script de preload (ponte segura entre main e renderer)
│   └── index.ts           # Exposição da API via contextBridge
└── renderer/              # Aplicação React (processo de renderer)
    ├── index.html         # HTML de entrada
    ├── main.tsx           # Monta o React na DOM
    ├── App.tsx            # Componente raiz, estado global e fluxo principal
    ├── types.ts           # Tipos TypeScript compartilhados
    ├── vite-env.d.ts      # Tipos do Vite
    ├── styles/
    │   └── index.css      # Tailwind + classes utilitárias customizadas
    └── components/
        ├── FileDropzone.tsx     # Área de arrastar/soltar e seleção de arquivos
        ├── ComparisonView.tsx   # Visualização lado a lado e inline do diff
        ├── HistoryPanel.tsx     # Painel lateral de histórico salvo
        ├── ProgressBar.tsx      # Barra de progresso da transcrição
        └── steps/               # Wizard de passos (documento → áudio → resultado)
            ├── StepIndicator.tsx
            ├── DocumentStep.tsx
            ├── AudioStep.tsx
            └── ResultStep.tsx

dist/                  # Saída de build (main, preload, renderer)
db/                    # Diretório reservado (vazio no repo; DB fica em userData)
assets/                # Assets estáticos (vazio atualmente)
release/               # Saída do electron-builder (DMG, ZIP, etc.)
```

---

## Comandos de Build e Desenvolvimento

```bash
# Instalar dependências
npm install

# Desenvolvimento (hot reload Vite + Electron)
npm run dev

# Build completo (TypeScript → Vite → electron-builder)
npm run build

# Preview do build Vite (sem Electron)
npm run preview

# Lint (ESLint)
npm run lint

# Checagem de tipos isolada (sem build)
npx tsc --noEmit
```

**Detalhes do build (`npm run build`):**
1. `tsc` — compilação de tipos TypeScript.
2. `vite build` — empacota renderer, main e preload.
3. `electron-builder` — gera os instaladores conforme `electron-builder.json5`.

Saídas padrão:
- macOS: `release/mac-arm64/` (DMG + ZIP)
- Windows: NSIS + portable
- Linux: AppImage + deb

### Validação Manual

Como o projeto não tem testes automatizados, validar mudanças manualmente:
- **Renderer (UI)**: rodar `npm run dev` e exercitar o fluxo afetado (documento → áudio → resultado).
- **Main / IPC**: rodar `npm run dev` e verificar o console do processo main no terminal.
- **Python / transcrição**: requer venv configurado e token HF; testar com um áudio curto para evitar esperas longas.

---

## Arquitetura de Runtime

O projeto segue o modelo padrão de processos do Electron:

- **Main Process** (`src/main/index.ts`): Executa em Node.js. Gerencia a janela, acesso ao sistema de arquivos, banco de dados SQLite e comunicação com o processo Python para transcrição.
- **Renderer Process** (`src/renderer/`): Executa a aplicação React. Não tem acesso direto a Node.js.
- **Preload** (`src/preload/index.ts`): Ponte segura. Expõe apenas as APIs definidas em `IElectronAPI` via `contextBridge`.

### IPC Channels (Main ↔ Renderer)

Todos os canais IPC são do tipo `invoke`/`handle`, exceto `transcription-progress`, que é um evento `send`/`on` unidirecional (main → renderer) com valores reais enviados pelo script Python (10→30→50→70→80→100).

| Channel | Direção | Descrição |
|---------|---------|-----------|
| `select-file` | renderer → main | Abre diálogo de seleção de arquivo |
| `read-document` | renderer → main | Extrai texto de PDF/DOCX/TXT |
| `transcribe-audio` | renderer → main | Envia áudio para transcrição no Gemma 4 via Python |
| `transcription-progress` | main → renderer | Progresso da transcrição (evento push) |
| `compare-texts` | renderer → main | Compara dois textos e retorna diff |
| `save-comparison` | renderer → main | Salva comparação no SQLite |
| `get-comparisons` | renderer → main | Lista histórico de comparações |
| `get-comparison` | renderer → main | Recupera uma comparação por ID |
| `delete-comparison` | renderer → main | Remove comparação do histórico |
| `check-python-status` | renderer → main | Verifica se o ambiente Python/Gemma está pronto |
| `save-setting` | renderer → main | Salva um valor criptografado no SQLite (via `safeStorage`) |
| `get-setting` | renderer → main | Recupera um valor do SQLite (descriptografado via `safeStorage`) |
| `get-audio-duration` | renderer → main | Lê duração (s) de um arquivo de áudio via script Python |
| `create-comparison` | renderer → main | Cria uma comparação nova (status `pending`) |
| `get-active-comparisons` | renderer → main | Lista comparações com status `pending` ou `transcribing` |
| `set-comparison-document` | renderer → main | Persiste documento de uma comparação |
| `set-comparison-audio` | renderer → main | Persiste áudio de uma comparação |
| `set-comparison-chunk-duration` | renderer → main | Persiste `chunk_duration_s` (clamp canônico [5, 120]s aplicado no main) |
| `get-comparison-chunks` | renderer → main | Lista chunks persistidos de uma comparação |
| `mark-comparison-error` | renderer → main | Marca comparação órfã como `error` (regra anti-zumbi) |
| `cancel-comparison` | renderer → main | Cancela transcrição em andamento |
| `transcribe-comparison` | renderer → main | Inicia/retoma transcrição. Args: `(id, model, context?, maxChunks?, chunkDurationS?)`. Suporta pré-teste para Gemma E Whisper. |

> Ao adicionar um novo canal IPC: registrar o handler em `src/main/index.ts`, expor no `src/preload/index.ts`, tipar em `IElectronAPI` e atualizar esta tabela.

### Alias de Importação

Configurados em `vite.config.ts` e `tsconfig.json`:

- `@/` → `src/`
- `@main/` → `src/main/`
- `@renderer/` → `src/renderer/`

---

## Convenções de Código

### TypeScript

- `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`.
- **Strict mode ativado** (`strict: true`).
- `noUnusedLocals: true` — variáveis não utilizadas causam erro.
- `noUnusedParameters: true` — parâmetros não utilizados causam erro.
- `jsx: react-jsx` — não é necessário importar React para JSX (exceto quando usa hooks/types explicitamente).
- `noEmit: true` — o Vite é responsável pela compilação; `tsc` apenas checa tipos.
- Arquivos incluídos: `src/**/*.ts`, `src/**/*.tsx`.

### Estilização

- Usamos **Tailwind CSS** via classes utilitárias.
- As classes customizadas do projeto estão definidas em `@layer components` em `src/renderer/styles/index.css`:
  - `.btn-primary`, `.btn-secondary`
  - `.card`
  - `.dropzone`, `.dropzone-active`
  - `.diff-added`, `.diff-removed`, `.diff-equal`, `.diff-changed`
  - `.progress-bar`, `.progress-bar-fill-*`
  - `.sidebar-overlay`
  - `.animate-fade-in`
- A paleta de cores estende o `primary` com tons de azul-ciano (sky blue), configurada em `tailwind.config.js`.

### Idioma

- A interface do usuário, README, comentários críticos e mensagens de erro estão em **Português (Brasil)**.
- Nomes de variáveis e tipos TypeScript estão em inglês.
- Mantenha consistência: UI em português, código em inglês.

---

## Banco de Dados

- **Biblioteca**: `better-sqlite3` (síncrona).
- **Localização**: `app.getPath('userData')/comparisons.db` (fora do diretório do projeto).
- **Schema**:
  ```sql
  CREATE TABLE comparisons (
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
  CREATE INDEX idx_created_at ON comparisons(created_at);
  ```
- O campo `diff_result` armazena o resultado do diff como string JSON.
- O banco é inicializado automaticamente na primeira execução via `DatabaseManager.init()`.

---

## Integração com Gemma 4 (Python / Hugging Face)

> ⚠️ Os IDs de modelo abaixo devem refletir **exatamente** o que está em `src/main/python/transcribe_gemma4.py`. Em caso de divergência entre este arquivo e o código, o código é a fonte da verdade — corrija a documentação, não o código.

- **Runtime**: processo Python 3.12+ isolado em um virtual environment gerenciado pelo app (`app.getPath('userData')/python_env`).
- **Bibliotecas**: `transformers>=5.10`, `torch`, `accelerate`, `librosa`, `soundfile`, `numpy`.
- **Modelos suportados**:
  - `google/gemma-4-12B-it` (padrão)
  - `google/gemma-4-E2B-it`
  - `google/gemma-4-E4B-it`
- **Autenticação**: exige um token do Hugging Face (`HF_TOKEN`) e aceite da licença do modelo. O token é informado no modal de configurações (`SettingsModal`), criptografado pelo `safeStorage` do Electron e armazenado no SQLite pelo main process. A transcrição não recebe o token como argumento de IPC; o main process grava o token descriptografado em um arquivo temporário e invoca o script Python com `--hf-token-file`. **Nunca** logar o token nem passá-lo como argumento de linha de comando visível em `ps`.
- **Processamento**:
  - O áudio é carregado com `librosa` a 16kHz mono.
  - O `Gemma4Processor` prepara os inputs (áudio + prompt de texto).
  - A geração usa `do_sample=False` (greedy decoding) para maior fidelidade na transcrição.
- **Ambiente**: na primeira execução o app cria o venv e instala as dependências automaticamente. O download do modelo Gemma 4 pode levar vários minutos (~6–24GB).

---

## Segurança

- `contextIsolation: true` e `nodeIntegration: false` no `webPreferences` da janela.
- Toda comunicação entre renderer e main passa pelo preload explicitamente definido.
- O `better-sqlite3` é marcado como `external` no build do main process (`rollupOptions.external` no `vite.config.ts`) para evitar bundling incorreto.
- Segredos (token HF) nunca trafegam pelo IPC em texto puro nem aparecem em logs.

---

## Testes

**Política**: toda lógica de negócio nova ou modificada deve vir acompanhada de testes unitários. Não é exigida cobertura de UI/componentes React nem do fluxo Electron completo (E2E) por enquanto, mas a lógica pura deve ser testada.

- **Framework padrão**: **Vitest** (integra nativamente com o Vite já usado no projeto).
- **Estado atual**: o Vitest está **configurado**:
  1. `npm install -D vitest` (já feito).
  2. Scripts `"test": "vitest run"` e `"test:watch": "vitest"` no `package.json`.
  3. Existe um `vitest.config.ts` separado (porque o `vite.config.ts` carrega plugins do Electron que não fazem sentido em testes unitários). O `vitest.config.ts` declara os mesmos aliases (`@/`, `@main/`, `@renderer/`) e limita `include: ['src/**/*.test.ts']` com `environment: 'node'`.
- **Convenções**:
  - Arquivos de teste ficam ao lado do código testado, com sufixo `.test.ts` (ex.: `src/main/fileProcessor.test.ts`).
  - Nomes de testes (`describe`/`it`) em português, consistente com a UI.
  - Priorize testar lógica pura e determinística: comparação/diff de textos, cálculo de `accuracy_score`, parsing/normalização de texto, queries do `DatabaseManager` (usar SQLite em memória: `new Database(':memory:')`).
  - **Não** testar via mock pesado o Electron em si (janelas, diálogos, IPC) nem o processo Python/Gemma — isso fica para validação manual.
- **Python**: se houver lógica testável nos scripts Python além da chamada ao modelo, usar `pytest` (adicionar a `requirements.txt` como dependência de dev). A transcrição em si não é testada automaticamente (depende de modelo de vários GB).
- **E2E futuro**: Playwright, se um dia for necessário.

Independentemente dos testes automatizados, siga a seção **Validação Manual** antes de finalizar qualquer mudança.

---

## Notas para Desenvolvimento

- O PostCSS é configurado via `vite.config.ts` e pela raiz `postcss.config.cjs`. O arquivo `src/renderer/postcss.config.mjs` foi removido para evitar conflitos — não recriá-lo.
- A extração de texto de DOCX e PDF usa casts `as any` devido a tipos incompletos das bibliotecas (`mammoth`, `pdf-parse`). Não tentar "consertar" esses casts sem verificar se os tipos das bibliotecas foram atualizados.
