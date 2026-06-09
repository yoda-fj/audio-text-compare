# Audio Text Compare

Aplicação Electron para comparar transcrição de áudio com documento original usando IA local (Gemma 4 via Ollama).

## Funcionalidades

- **Comparação palavra por palavra** entre documento e áudio transcrito
- **Visualização lado a lado** e inline com color coding
- **Suporte a documentos**: PDF, DOCX, TXT
- **Suporte a áudio**: WAV, MP3, OGG, M4A, FLAC
- **Transcrição local** com Gemma 4 (E4B, 12B, 26B)
- **Persistência** em SQLite para histórico de comparações
- **Progresso em tempo real** durante transcrição

## Stack

- Electron + Vite + React + TypeScript
- Tailwind CSS
- better-sqlite3
- Ollama (Gemma 4)

## Instalação

```bash
npm install
```

## Desenvolvimento

```bash
npm run dev
```

## Build

```bash
npm run build
```

Gera DMG e ZIP para macOS (arm64) em `release/`.

## Requisitos

- Ollama rodando em `localhost:11434`
- Modelo Gemma 4 baixado: `ollama pull gemma4:12b`

## Uso

1. Selecione o documento original (PDF/DOCX/TXT)
2. Selecione o arquivo de áudio
3. Escolha o modelo Gemma 4
4. Clique em "Comparar"
5. Visualize as diferenças palavra por palavra

## Color Coding

- **Verde**: Palavra correta
- **Vermelho**: Palavra omitida no áudio
- **Azul**: Palavra adicionada no áudio
- **Amarelo**: Palavra alterada
