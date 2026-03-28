#!/bin/bash
# Start all PFA services: LLM server, agent API, client UI
set -e
cd "$(dirname "$0")/.."

cleanup() {
  echo "Stopping all services..."
  kill $LLM_PID $AGENT_PID $CLIENT_PID 2>/dev/null
  exit 0
}
trap cleanup SIGINT SIGTERM

# 1. LLM server
echo "Starting LLM server..."
./scripts/start-llm.sh &
LLM_PID=$!
sleep 3

# 2. Agent API server
echo "Starting agent API server..."
npx tsx src/agent/server.ts &
AGENT_PID=$!
sleep 1

# 3. Client dev server
echo "Starting client..."
cd client && npx vite --port 5173 &
CLIENT_PID=$!
cd ..

echo ""
echo "=== PFA Running ==="
echo "  LLM:    http://localhost:8080"
echo "  Agent:  http://localhost:3120"
echo "  Client: http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop all services"

wait
