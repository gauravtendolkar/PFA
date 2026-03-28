#!/bin/bash
# Start native llama-server with KV cache reuse for fast multi-turn conversations.
# Single slot ensures the KV cache from the system prompt is reused across iterations.

set -e
cd "$(dirname "$0")/.."

MODEL="${LLM_MODEL_PATH:-./models/Qwen3.5-9B.Q4_K_M.gguf}"
PORT="${LLM_PORT:-8080}"
CTX="${LLM_CTX_SIZE:-16384}"
SERVER="./bin/llama-server"

if [ ! -f "$MODEL" ]; then
  echo "Model not found at $MODEL"
  echo "Download: .venv/bin/hf download Jackrong/Qwen3.5-9B-Claude-4.6-Opus-Reasoning-Distilled-GGUF Qwen3.5-9B.Q4_K_M.gguf --local-dir ./models"
  exit 1
fi

if [ ! -f "$SERVER" ]; then
  echo "llama-server not found at $SERVER"
  echo "Build it: cd /tmp && git clone https://github.com/ggml-org/llama.cpp.git && cd llama.cpp && cmake -B build -DGGML_METAL=ON && cmake --build build --target llama-server -j && cp build/bin/llama-server /path/to/pfa/bin/"
  exit 1
fi

echo "Starting llama-server on :$PORT"
echo "  Model:    $MODEL"
echo "  Context:  $CTX"
echo "  Parallel: 1 (single slot for KV cache reuse)"
echo "  Flash:    on"
echo ""

exec "$SERVER" \
  --model "$MODEL" \
  --host 0.0.0.0 \
  --port "$PORT" \
  --ctx-size "$CTX" \
  --n-gpu-layers 99 \
  --flash-attn on \
  --parallel 1 \
  --slots \
  --ctx-checkpoints 32 \
  --checkpoint-every-n-tokens 256
