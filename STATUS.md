# Status do Projeto - Audio Text Compare

> Arquivo de handoff para retomada de sessão. Última atualização: 2026-06-11.

## Contexto

Projeto Audio Text Compare (Electron + React + TypeScript + Python).
Transcrição de áudio com Gemma 4 via Hugging Face transformers localmente.

## Estado Atual

### ✅ Funcionando

- App Electron sobe em dev (`npm run dev`) e build (`npm run build`) passam.
- UI refatorada para wizard de 3 passos (Documento → Áudio → Resultado).
- **Dois modelos de transcrição disponíveis**:
  - **Gemma 4** (E2B/E4B/12B) via Hugging Face transformers — requer HF Token.
  - **Whisper Large v3** via OpenAI whisper — mais rápido, não requer HF Token.
- Integração Python implementada via `PythonClient`:
  - Cria venv automaticamente em `~/Library/Application Support/Electron/python_env`.
  - Instala dependências automaticamente.
  - Executa `transcribe_gemma4.py` ou `transcribe_whisper.py` conforme modelo selecionado.
- Status do ambiente Python exibido no header.
- Banco SQLite e histórico funcionam.
- Teste local realizado com sucesso:
  - Modelo: `google/gemma-4-E2B-it`
  - Resultado: pipeline completa funcionou (modelo carregou, gerou transcrição, retornou JSON válido).
  - Modelo carrega sem HF Token usando `local_files_only=True` quando está no cache local.

### ⚠️ Limitações conhecidas

- Máquina de desenvolvimento tem 16 GB de RAM.
- Modelo Gemma 4 E2B funciona com `offload_folder` (pesos vão para o disco).
- A primeira transcrição é LENTA (pode levar 10–30 min+ no primeiro uso devido ao download do modelo e criação do venv).
- Modelo 12B não foi testado por falta de RAM/VRAM — recomenda-se testar primeiro com E2B.

### 📝 Arquivos alterados recentemente

- `src/main/pythonClient.ts` — gerenciamento do venv Python + status check
- `src/main/python/transcribe_gemma4.py` — script de transcrição com chat template correto
- `src/main/python/setup_venv.py` — setup do ambiente virtual
- `src/main/python/requirements.txt` — dependências Python (inclui pillow, torchvision)
- `src/main/index.ts` — handlers IPC (`transcribe-audio`, `check-python-status`)
- `src/preload/index.ts` — API exposta ao renderer
- `src/renderer/App.tsx` — estado do HF token, status Python no header
- `src/renderer/components/steps/AudioStep.tsx` — campo de HF Token + select de modelo
- `scripts/transcribe_gemma4.py` — versão standalone sincronizada
- `AGENTS.md` — documentação atualizada

## Dependências Python verificadas

```
transformers>=5.10.0
torch
torchvision
accelerate
librosa
soundfile
numpy
pillow
openai-whisper
```

## Como testar na retomada

1. `npm run prepare-assets` (copia modelos do cache para `assets/models/`)
2. `npm run dev`
3. Na UI, selecionar documento e áudio com fala real.
4. Escolher modelo `Whisper Large v3` (mais rápido) ou `Gemma 4 E2B`.
5. Clicar em "Transcrever áudio" e aguardar.

## 🐛 Correções recentes

- Código legado do Ollama e Whisper removido (`ollamaClient.ts`, `whisperClient.ts`, handlers IPC e documentação).
- `pythonClient.ts` agora detecta venvs existentes em caminhos alternativos (`audio-text-compare` vs `Electron`), resolvendo o status falso de "Ambiente Python não configurado".
- `app.setName('audio-text-compare')` adicionado em `index.ts` para consistência do `userData`.
- HF Token agora é obrigatório na UI e validado no backend antes de iniciar a transcrição.
- Área de configurações segura implementada: HF Token criptografado via `safeStorage` do Electron e armazenado no SQLite.
- Token não é mais passado por argumento de linha de comando; uso de arquivo temporário com `--hf-token-file`.
- UI com modal de configurações e indicadores visuais de status do token.
- Modelo padrão alterado para `google/gemma-4-E2B-it` (evita OOM em 16 GB RAM).
- Removida mensagem redundante sobre HF Token da tela de transcrição (status já aparece no header).
- Implementado **chunking de áudio** em `transcribe_gemma4.py`: áudios longos são divididos em chunks de 30s e transcritos chunk a chunk.
- Progresso da transcrição mostra a **mensagem real** do backend (ex: "Transcrevendo chunk 1/171...").
- Implementado **checkpoint/retomada** de transcrição: cada chunk processado é salvo em `~/Library/Application Support/audio-text-compare/transcription_checkpoints/`.
- UI exibe aviso amarelo com contador de chunks quando existe checkpoint disponível.
- Texto do documento original (primeiro step) é enviado como **contexto** para o modelo Gemma 4 durante a transcrição.
- **Modo economia de memória** automático: em máquinas com menos de 20 GB RAM, o script Python força mais offload para o disco (`max_memory`, `offload_state_dict`), evitando OOM (erro "code null").
- **Whisper Large v3** integrado como alternativa ao Gemma 4:
  - Script `transcribe_whisper.py` criado com suporte a MPS (Apple Silicon) e `fp16=False`.
  - Seleção de modelo no step de áudio (Gemma 4 ou Whisper).
  - Whisper não requer HF Token e processa o áudio inteiro sem chunking.
- **Modelos são embutidos no pacote do app** via `assets/models/`:
  - `assets/models/whisper/large-v3.pt` — modelo Whisper (≈3 GB).
  - `assets/models/huggingface/` — cache do Hugging Face com modelos Gemma.
  - Configurado em `electron-builder.json5` (`extraResources`) e resolvido em runtime via `process.resourcesPath`.
  - Script `npm run prepare-assets` copia modelos do cache do usuário para `assets/models/` antes do build.
  - Removidos botões de download da UI e APIs de download do backend.
- **Modelos são embutidos no pacote do app** via `assets/models/`:
  - `assets/models/whisper/large-v3.pt` — modelo Whisper (≈3 GB).
  - `assets/models/huggingface/` — cache do Hugging Face com modelos Gemma.
  - Configurado em `electron-builder.json5` (`extraResources`) e resolvido em runtime via `process.resourcesPath`.
  - Script `npm run prepare-assets` copia modelos do cache do usuário para `assets/models/` antes do build.
  - App não faz mais download de modelos em runtime — tudo vem no instalador.

## 🐛 Correções recentes (2026-06-11)

- **`chunk_duration_s` configurável por projeto** (5–120s, padrão 30s):
  - Migração v3 do SQLite adiciona coluna `chunk_duration_s INTEGER` (idempotente via `getColumnNames`).
  - Persistido no DB e exposto via input inline no `AudioStep` (clamp canônico no main process via `clampChunkDuration`).
  - No Gemma, é o tamanho real de cada chunk (passado como `--chunk-duration`).
  - No Whisper, é a janela do pré-teste (multiplicada por `max_chunks` para gerar `--clip-end-s`).
  - Input de duração é desabilitado quando há chunks `done` ou transcrição em andamento (não pode mudar com índices já persistidos).
- **Pré-teste do Whisper** agora funciona:
  - Implementado via `clip_timestamps="0,N"` (parâmetro nativo do openai-whisper) — sem fatiamento de arquivo, sem I/O extra.
  - Denominador do progresso usa `clip_end` (não a duração total) para que a barra chegue a 100% na janela do pré-teste.
  - Resultado final carrega `"pretest": true` no JSON; o Node detecta e marca a comparação como `partial: true` (status `pending`).
- **Removido `PretestModal`**: inputs inline de `chunk_duration_s` e `max_chunks` no `AudioStep` (mais descobríveis, sem modal separada).
- **Helpers puros `clampChunkDuration` e `computeClipEndS`** em `src/main/chunkMath.ts`, com 14 testes Vitest em `src/main/chunkMath.test.ts`. Configurado `vitest.config.ts` separado (plugins do Electron não fazem sentido em testes unitários).
- **UX de "pedir mais N chunks" no AudioStep**:
  - Quando há chunks `done` (resume), o label do input vira **"Adicionar mais N chunks"** e o botão principal dinâmico mostra **"Continuar + N chunk(s)"** quando o usuário preenche um valor > 0.
  - O banner amarelo de "transcrição anterior interrompida" explica a soma: "Com Adicionar mais N você chega a X de Y processados. Use 0 para retomar do próximo chunk não processado em diante."
  - Comportamento real: o `maxChunks` no Gemma é interpretado como "N chunks **novos** a partir do `doneChunksCount + 1`" (o Python processa N e para, o checkpoint derivado pelo Node garante o resume). No Whisper, `maxChunks * chunkDurationS` define a janela `[0, N*dur]` — a semântica é diferente (transcreve do início até N*dur, não os próximos N), e o usuário é avisado pelo banner que a janela é cumulativa no eixo do tempo.
  - O `maxChunks` continua não-persistido (parâmetro da execução): volta a 0 ao recarregar a comparação.
- **UX do player de áudio na tela comparativa**:
  - `MARGIN_AFTER_S` reduzido de 20s para 2s: a folga só precisa absorver o erro de timestamp do Whisper nas bordas (≤~1s); 20s era exagero e tocava a próxima frase inteira após o trecho clicado.
  - Player tornado **sticky** (`sticky top-0 z-10` no card em `ComparisonView.tsx`): ao rolar a página comparativa, o player permanece fixo no topo do viewport para que o usuário possa clicar em qualquer palavra do diff e tocar o trecho sem precisar rolar de volta até o player. Mantém `bg-white` + `shadow-sm` para legibilidade sobre o texto que passa por baixo.
- **Fix de alucinações CJK no Whisper** (`sanitize_initial_prompt` em `transcribe_whisper.py`):
  - Sintoma: tokens em chinês (其其其, 人們認識, 瞳孫瞳) apareciam no meio de transcrições em pt-BR quando o documento original terminava com citações, rodapés ou referências em outros idiomas.
  - Causa: o Whisper usa `initial_prompt` como viés de vocabulário. O final do documento era jogado direto no prompt e o modelo "aprendia" a gerar esses caracteres.
  - Fix: nova função `sanitize_initial_prompt(text, max_chars=1000)` filtra o contexto para manter apenas `[A-Za-zÀ-ÖØ-öø-ÿ]` + dígitos + pontuação comum + espaço. Tudo fora vira espaço, whitespace é colapsado, e o resultado é o **fim** do texto (o Whisper só usa os últimos ~224 tokens). Se não sobrar nada útil, retorna `None` (sem prompt — Whisper usa o idioma `--language=pt` puro).
  - Cobre: CJK, cirílico, árabe, emoji, símbolos não-latinos. Mantém acentos BR (Coração, pêssego).
- **ESLint** ainda não está instalado no projeto (`npm run lint` falha com `eslint: command not found`). Pendente para um próximo agente configurar.

## ✅ Implementado hoje (2026-06-13)

### Download do Whisper na tela de configurações
- Script Python `src/main/python/download_whisper.py` criado: usa `openai-whisper` para baixar `large-v3.pt` no diretório padrão de modelos.
- `PythonClient` ganhou métodos `isWhisperModelDownloaded()` e `downloadWhisperModel()`.
- Novos canais IPC:
  - `get-whisper-model-status` — retorna `{ downloaded: boolean }`.
  - `download-whisper-model` — inicia o download, emitindo `whisper-download-progress` para o renderer.
- Preload expôs `getWhisperModelStatus`, `downloadWhisperModel` e `onWhisperDownloadProgress`.
- `SettingsModal` atualizada: exibe botão "Baixar Whisper Large v3" quando o modelo não está presente, barra de progresso durante o download e mensagem de sucesso quando concluído.

## ✅ Implementado hoje (2026-06-11)

### Player de Áudio por Segmento (Whisper)
- **Migração v4/v5 do SQLite**: 
  - v4: colunas `diff_result_chunks` (JSON) e `audio_path` (TEXT).
  - v5: coluna `whisper_segments_json` (JSON) para guardar segments com timestamps do Whisper.
- **Backend** (`fileProcessor.ts`): 
  - `compareTextsWithChunks()` — mapeia cada palavra do diff para o chunk de origem.
  - `mapDiffToWhisperSegments()` — mapeia cada palavra do diff para o segmento do Whisper correspondente (usando timestamps reais).
- **Testes**: `fileProcessor.test.ts` com 8 casos de teste.
- **Protocolo de áudio**: `app-audio://<comparisonId>` registrado no main process via `protocol.registerFileProtocol`, validando que o arquivo existe antes de servir.
- **Novos canais IPC**:
  - `get-comparison-diff-chunks` — retorna o diff com chunkIndex.
  - `get-comparison-audio-info` — retorna `{ available, reason }` validando existência do arquivo.
  - `get-comparison-whisper-segments` — retorna segments com timestamps do Whisper.
- **Componentes frontend**:
  - `ComparisonView.tsx` — em cada palavra adicionada/omitida/alterada, aparece um botão 🔊 ao passar o mouse. Ao clicar, toca o áudio a partir de `segment.start - 5s` (margem de contexto) até `segment.end + 2s` (folga para o erro de timestamp do Whisper). Usa os **segments reais do Whisper** (não chunks de processamento), dando precisão de segundos. O card do player é `sticky top-0` para permanecer visível enquanto o usuário rola o diff.
  - `ResultStep.tsx` — busca lazy dos segments e info de áudio ao montar.
- **Persistência**: 
  - `finalizeComparison()` gera e grava `diff_result_chunks` em try/catch isolado.
  - Ao finalizar o Whisper, extrai os segments do resultado JSON e persiste em `whisper_segments_json`.

## Próximos passos pendentes (opcional)

- Testar transcrição com Whisper Large v3 usando áudio real de 85 min.
- Testar transcrição com Gemma 4 em áudio real contendo fala.
- Adicionar indicador de tempo estimado na UI.
- Testar modelo 12B em máquina com mais RAM.
- Adicionar tratamento específico para erro de memória na UI.
- Configurar ESLint e resolver `npm run lint`.
- Adicionar testes para `fileProcessor.compareTexts` e `calculateAccuracy`.
- Adicionar testes de queries do `DatabaseManager` com SQLite em memória.
