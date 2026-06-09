#!/usr/bin/env python3
"""
Transcrição de áudio usando Gemma 4 nativamente com suporte a áudio e chunking.

Requisitos:
- Python 3.10+
- transformers >= 5.10 (suporte a gemma4_unified)
- torch, accelerate, librosa, soundfile
- Hugging Face token (aceitar a licença do modelo Gemma 4)
- ~16GB de RAM/VRAM (usa bfloat16 para reduzir consumo)

Instalação:
    python3 -m venv venv
    source venv/bin/activate
    pip install transformers torch accelerate librosa soundfile

Uso:
    python transcribe_gemma4.py /caminho/do/audio.wav
    python transcribe_gemma4.py /caminho/do/audio.mp3 --max-length 512 --chunk-duration 30

O modelo será baixado automaticamente na primeira execução (~24GB em FP16,
~6GB se usar quantização via GGUF). Isso pode levar vários minutos.
Áudios longos são divididos em chunks para respeitar o limite de contexto do modelo.
"""

import argparse
import math
import sys
import os

# Configurar Hugging Face cache no diretório do projeto se desejado
# os.environ["HF_HOME"] = os.path.join(os.path.dirname(__file__), "hf_cache")

import torch
import librosa


def load_audio(audio_path: str, target_sr: int = 16000) -> tuple:
    """Carrega e normaliza o áudio para 16kHz mono."""
    print(f"📁 Carregando áudio: {audio_path}")

    # librosa converte automaticamente para mono e resample
    audio, sr = librosa.load(audio_path, sr=target_sr, mono=True)

    duration = len(audio) / target_sr
    print(f"⏱️  Duração: {duration:.1f}s | Sample rate: {target_sr}Hz | Canais: mono")

    return audio, sr


def transcribe(
    audio_path: str,
    model_id: str = "google/gemma-4-12B-it",
    max_length: int = 512,
    chunk_duration: int = 30,
    token: str | None = None,
):
    """Transcreve o áudio usando Gemma 4 com chunking."""

    try:
        from transformers import Gemma4Processor, Gemma4ForConditionalGeneration
    except ImportError as e:
        print(f"❌ Erro ao importar Gemma4 classes: {e}")
        print("   Certifique-se de que transformers >= 5.10 está instalado:")
        print("   pip install git+https://github.com/huggingface/transformers.git")
        sys.exit(1)

    # Verificar token do Hugging Face
    if token is None:
        token = os.environ.get("HF_TOKEN", None)
    if not token:
        print("⚠️  AVISO: HF_TOKEN não definido. O modelo Gemma 4 requer autenticação.")
        print("   1. Crie um token em https://huggingface.co/settings/tokens")
        print("   2. Aceite a licença do modelo em https://huggingface.co/google/gemma-4-12B-it")
        print("   3. Exporte: export HF_TOKEN=seu_token_aqui")
        print("")
        print("   Tentando carregar sem token (pode falhar)...")

    print(f"🤖 Carregando modelo: {model_id}")
    print("   Isso pode levar vários minutos na primeira execução...")

    # Detectar device (MPS para Mac Silicon, CUDA para NVIDIA, CPU fallback)
    if torch.backends.mps.is_available():
        device = "mps"
        dtype = torch.bfloat16
    elif torch.cuda.is_available():
        device = "cuda"
        dtype = torch.bfloat16
    else:
        device = "cpu"
        dtype = torch.float32
        print("⚠️  CPU detectada. A inferência será muito lenta.")

    print(f"   Device: {device} | Dtype: {dtype}")

    # Diretório para offload de pesos quando a memória não for suficiente
    offload_dir = os.path.join(os.path.dirname(__file__), "model_offload")
    os.makedirs(offload_dir, exist_ok=True)

    # Carregar processor
    processor = Gemma4Processor.from_pretrained(model_id, token=token)

    # Carregar modelo com otimizações para memória
    load_kwargs = {
        "torch_dtype": dtype,
        "token": token,
        "low_cpu_mem_usage": True,
    }
    if device != "cpu":
        load_kwargs["device_map"] = "auto"
        load_kwargs["offload_folder"] = offload_dir
    model = Gemma4ForConditionalGeneration.from_pretrained(model_id, **load_kwargs)

    if device == "cpu":
        model = model.to(device)

    print("✅ Modelo carregado!")

    # Carregar áudio
    audio, sr = load_audio(audio_path)

    total_samples = len(audio)
    chunk_samples = chunk_duration * sr
    total_chunks = max(1, math.ceil(total_samples / chunk_samples))

    print(f"🔄 Dividindo áudio em {total_chunks} chunk(s) de {chunk_duration}s...")

    system_prompt = "Transcreva o conteúdo deste áudio em português, palavra por palavra."
    transcriptions: list[str] = []

    for i in range(total_chunks):
        start = i * chunk_samples
        end = min(start + chunk_samples, total_samples)
        chunk = audio[start:end]

        print(f"   Chunk {i + 1}/{total_chunks}...", end=" ", flush=True)

        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": system_prompt},
                    {"type": "audio"},
                ],
            },
        ]
        prompt_text = processor.apply_chat_template(messages, add_generation_prompt=True, tokenize=False)

        inputs = processor(
            text=prompt_text,
            audio=[chunk],
            return_tensors="pt",
        )

        # Mover para o device
        if device != "cpu":
            inputs = inputs.to(device)

        # Gerar transcrição
        with torch.no_grad():
            generate_ids = model.generate(
                **inputs,
                max_new_tokens=max_length,
                do_sample=False,  # Greedy decoding para transcrição mais precisa
            )

        # Decodificar resultado
        generate_ids = generate_ids[:, inputs["input_ids"].shape[1]:]
        chunk_text = processor.batch_decode(generate_ids, skip_special_tokens=True)[0]

        if chunk_text.strip():
            transcriptions.append(chunk_text.strip())
            print(f"({len(chunk_text.strip())} chars)")
        else:
            print("(vazio)")

    return " ".join(transcriptions)


def main():
    parser = argparse.ArgumentParser(
        description="Transcreve áudio usando Gemma 4 com suporte nativo a áudio."
    )
    parser.add_argument("audio_path", help="Caminho do arquivo de áudio (wav, mp3, etc.)")
    parser.add_argument(
        "--model",
        default="google/gemma-4-12B-it",
        help="ID do modelo no Hugging Face (padrão: google/gemma-4-12B-it)",
    )
    parser.add_argument(
        "--max-length",
        type=int,
        default=512,
        help="Número máximo de tokens a gerar por chunk (padrão: 512)",
    )
    parser.add_argument(
        "--chunk-duration",
        type=int,
        default=30,
        help="Duração de cada chunk de áudio em segundos (padrão: 30)",
    )
    parser.add_argument(
        "--output",
        "-o",
        help="Salvar transcrição em arquivo (opcional)",
    )
    parser.add_argument(
        "--hf-token",
        default="",
        help="Hugging Face token (ou use env HF_TOKEN)",
    )
    parser.add_argument(
        "--hf-token-stdin",
        action="store_true",
        help="Ler HF Token do stdin",
    )

    args = parser.parse_args()

    if not os.path.exists(args.audio_path):
        print(f"❌ Arquivo não encontrado: {args.audio_path}")
        sys.exit(1)

    hf_token = None
    if args.hf_token_stdin:
        try:
            hf_token = sys.stdin.read().strip()
        except Exception as e:
            print(f"❌ Falha ao ler HF token do stdin: {e}")
            sys.exit(1)
    else:
        hf_token = args.hf_token or os.environ.get("HF_TOKEN", None)

    if not hf_token:
        print("❌ Hugging Face Token é obrigatório. Configure o token no aplicativo.")
        sys.exit(1)

    try:
        result = transcribe(
            args.audio_path,
            args.model,
            args.max_length,
            args.chunk_duration,
            token=hf_token,
        )
    except Exception as e:
        print(f"\n❌ Erro durante a transcrição: {e}")
        print("\nDicas de troubleshooting:")
        print("- Verifique se o HF_TOKEN está configurado")
        print("- Verifique se aceitou a licença do modelo no Hugging Face")
        print("- Verifique se tem ~16GB de RAM livre")
        print("- Para Macs com 16GB, o modelo pode ser lento ou dar OOM")
        sys.exit(1)

    print("\n" + "=" * 60)
    print("📝 TRANSCRIÇÃO")
    print("=" * 60)
    print(result)
    print("=" * 60)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(result)
        print(f"\n💾 Transcrição salva em: {args.output}")


if __name__ == "__main__":
    main()
