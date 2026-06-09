# Status do Projeto - Audio Text Compare

> Arquivo de handoff para retomada de sessão. Última atualização: 2026-06-09.

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
- Campo de HF Token adicionado na UI (criptografado no SQLite).
- Status do ambiente Python exibido no header.
- Banco SQLite e histórico funcionam.
- Teste local realizado com sucesso:
  - Modelo: `google/gemma-4-E2B-it`
  - Resultado: pipeline completa funcionou (modelo carregou, gerou transcrição, retornou JSON válido).

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

1. `npm run dev`
2. Na UI, selecionar documento e áudio com fala real.
3. Inserir HF Token válido (com licença do modelo aceita no HF).
4. Escolher modelo `Gemma 4 E2B` (recomendado para 16 GB RAM).
5. Clicar em "Transcrever áudio" e aguardar (pode demorar bastante na primeira vez).

## 🐛 Correções recentes

- Código legado do Ollama e Whisper removido (`ollamaClient.ts`, `whisperClient.ts`, handlers IPC e documentação).
- `pythonClient.ts` agora detecta venvs existentes em caminhos alternativos (`audio-text-compare` vs `Electron`), resolvendo o status falso de "Ambiente Python não configurado".
- `app.setName('audio-text-compare')` adicionado em `index.ts` para consistência do `userData`.
- HF Token agora é obrigatório na UI e validado no backend antes de iniciar a transcrição.
- Área de configurações segura implementada: HF Token criptografado via `safeStorage` do Electron e armazenado no SQLite.
- Token não é mais passado por argumento de linha de comando; uso de arquivo temporário com `--hf-token-file`.
- UI com modal de configurações e indicadores visuais de status do token.
- Download antecipado do modelo disponível na tela de configurações, com barra de progresso, via `src/main/python/download_model.py` usando `huggingface_hub.snapshot_download`.
- HF Token agora é passado dos processos Node/Python via **stdin** (`--hf-token-stdin`), eliminando completamente arquivos temporários e race conditions.
- Adicionado fallback de criptografia AES-256-CBC quando `safeStorage` do Electron não está disponível (problema comum no macOS dev com Keychain).
- Testado `npm run dev`: app sobe sem erros críticos; download do modelo via stdin funciona corretamente.
- Testada transcrição com modelo E2B: funcionou e gerou texto em português.
- Modelo padrão alterado para `google/gemma-4-E2B-it` (evita OOM em 16 GB RAM).
- Removida mensagem redundante sobre HF Token da tela de transcrição (status já aparece no header).
- Implementado **chunking de áudio** em `transcribe_gemma4.py`: áudios longos são divididos em chunks de 30s e transcritos chunk a chunk, corrigindo o problema de transcrição incompleta.
- Progresso da transcrição agora mostra a **mensagem real** do backend (ex: "Transcrevendo chunk 1/171...") em vez de mensagens genéricas fixas.
- Implementado **checkpoint/retomada** de transcrição: cada chunk processado é salvo em `~/Library/Application Support/audio-text-compare/transcription_checkpoints/`. Se o processo for interrompido (máquina dorme, crash, etc.), clicar em "Transcrever" novamente retoma de onde parou.
- UI exibe aviso amarelo com contador de chunks quando existe checkpoint disponível, com botões "Retomar transcrição" e "Descartar e recomeçar".
- Texto do documento original (primeiro step) é enviado como **contexto** para o modelo Gemma 4 durante a transcrição, melhorando o reconhecimento de termos específicos e vocabulário do documento.
- **Modo economia de memória** automático: em máquinas com menos de 20 GB RAM, o script Python força mais offload de camadas do modelo para o disco (`max_memory`, `offload_state_dict`), evitando OOM (erro "code null").
- **Whisper Large v3** integrado como alternativa ao Gemma 4:
  - Scripts `download_whisper.py` e `transcribe_whisper.py` criados.
  - Modelo baixado para `~/Library/Application Support/audio-text-compare/models/whisper/` (dentro do diretório do app).
  - Seleção de modelo no step de áudio (Gemma 4 ou Whisper).
  - Download do modelo Whisper disponível na tela de configurações, com progresso.
  - Whisper não requer HF Token e processa o áudio inteiro sem chunking.

## Próximos passos pendentes (opcional)

- Testar transcrição com Whisper Large v3 usando áudio real de 85 min.
- Testar transcrição com Gemma 4 em áudio real contendo fala.
- Adicionar indicador de tempo estimado na UI.
- Testar modelo 12B em máquina com mais RAM.
- Adicionar tratamento específico para erro de memória na UI.
