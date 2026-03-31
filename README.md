# PFA — Personal Finance Agent

<p align="center"><img width="851" height="315" alt="Add a little bit of body text" src="https://github.com/user-attachments/assets/9c82c9fa-19ea-48fb-97c6-63ece3137a41" /></p>


https://github.com/user-attachments/assets/b38c8c4d-6038-454c-8312-33dfb96706cc


An on-device AI agent for personal finance. Chat with your bank data using a local LLM. All data stays on your machine.

## Why PFA?

- **100% local** — Your financial data never leaves your device. The LLM runs on your machine via llama.cpp.
- **Private by design** — No cloud APIs, no telemetry, no data collection. Your bank credentials go directly to SimpleFIN (a trusted bridge), never through PFA.
- **AI-powered analysis** — Ask questions in plain English: "Where does my money go?", "What's my savings rate?", "How can I reduce spending?"
- **Real bank data** — Connect your actual bank accounts via SimpleFIN Bridge ($1.50/month). Transactions sync automatically.

## Security & Privacy

PFA is designed with a zero-trust architecture:

- **Local LLM** — Your financial questions and data are processed by a model running on your own hardware (Qwen 3.5 4B via llama.cpp). Nothing is sent to OpenAI, Anthropic, or any cloud AI provider.
- **Local database** — All data is stored in a SQLite database on your machine (`~/.pfa/pfa.db`). No remote database, no sync service.
- **SimpleFIN Bridge** — The only external service. SimpleFIN connects to your bank via MX (a major regulated aggregator). PFA stores a SimpleFIN access URL locally — SimpleFIN never sees your queries or analysis. You can revoke access anytime from your SimpleFIN dashboard.
- **No API keys needed** — PFA requires zero developer accounts or API keys. SimpleFIN is user-facing ($1.50/month paid directly to SimpleFIN).
- **Open source** — Every line of code is auditable. No hidden network calls, no tracking.

## Quick Start

```bash
git clone https://github.com/user/pfa.git
cd pfa
npm run setup    # Interactive wizard: installs deps, downloads LLM, creates config
npm run dev      # Starts all services (LLM + API + UI)
```

Then open **http://localhost:5173**.

## Setup Details

The setup wizard (`npm run setup`) handles everything:

1. **Dependencies** — Installs npm packages for server and client
2. **LLM binary** — Downloads the llama-server binary for your platform (macOS arm64/x64, Linux x64)
3. **Model** — Downloads Qwen 3.5 4B (~2.7 GB) from HuggingFace
4. **Config** — Creates a `.env` file with sensible defaults
5. **Database** — Initializes the SQLite schema

### Connecting Your Bank

1. Click **"Connect an Account"** in the app header
2. You'll be linked to [SimpleFIN Bridge](https://bridge.simplefin.org) — sign up ($1.50/month) and connect your bank
3. Copy the **Setup Token** and paste it back into PFA
4. Your accounts and transactions sync automatically

SimpleFIN supports most major US banks (Chase, Bank of America, Wells Fargo, Discover, Capital One, etc.) via MX.

## Requirements

- **Node.js 18+**
- **macOS** (Apple Silicon or Intel) or **Linux** (x64) — tested on macOS Sequoia (Apple Silicon)
- **8 GB RAM** minimum (for the LLM)
- **~3 GB disk** for the model file

## Model

PFA uses [Qwen3.5-4B-Claude-Opus-Reasoning-Distilled-v2-GGUF](https://huggingface.co/Jackrong/Qwen3.5-4B-Claude-4.6-Opus-Reasoning-Distilled-v2-GGUF) (Q4_K_M quantization, ~2.7 GB). This is a 4B parameter reasoning model distilled from Claude Opus, optimized for tool calling and step-by-step analysis. It runs locally via [llama.cpp](https://github.com/ggml-org/llama.cpp) with Metal GPU acceleration on Mac.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run setup` | First-time setup wizard |
| `npm run dev` | Start all services (LLM + API server + UI) |
| `npm run dev:no-llm` | Start API + UI only (if running LLM separately) |
| `npm run sync` | Manually trigger a bank data sync |
| `npm run db:migrate` | Run database migrations |

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  React UI    │────▶│  Agent API   │────▶│  llama.cpp   │
│  :5173       │     │  :3120       │     │  :8080       │
└──────────────┘     └──────┬───────┘     └──────────────┘
                            │
                     ┌──────▼───────┐
                     │  SQLite DB   │
                     │  ~/.pfa/     │
                     └──────────────┘
```

- **React UI** — Chat interface, dashboard, settings
- **Agent API** — ReAct loop orchestrator with financial tools
- **llama.cpp** — Local LLM inference with KV cache reuse
- **SQLite** — Accounts, transactions, sessions, networth snapshots

## Cost

- **PFA itself**: Free and open source
- **SimpleFIN Bridge**: $1.50/month (paid directly to SimpleFIN for bank data access)
- **Hardware**: Runs on any modern Mac or Linux machine — no GPU required (Apple Silicon recommended)

## License

MIT — see [LICENSE](LICENSE).
