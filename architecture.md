# PFA Architecture

## Overview

PFA is an on-device personal finance agent. Local LLM (llama.cpp), SQLite database, Plaid bank integration, React frontend. Everything runs on the user's machine — no data leaves the device.

```
┌─────────────────────────────────────────────────────────────┐
│  React Client (Vite, port 5173)                             │
│  Chat ← SSE stream ─── Activity Panel ─── Dashboard        │
└──────────────┬──────────────────────────────────────────────┘
               │ HTTP / SSE
┌──────────────▼──────────────────────────────────────────────┐
│  Agent Server (Node.js, port 3120)                          │
│  Orchestrator (ReAct loop) → Tools → SQLite                │
└──────────────┬──────────────────────────────────────────────┘
               │ OpenAI-compatible API
┌──────────────▼──────────────────────────────────────────────┐
│  llama-server (llama.cpp, port 8080)                        │
│  Qwen 3.5 4B Q4_K_M · Metal GPU · KV cache reuse           │
└─────────────────────────────────────────────────────────────┘
```

---

## LLM Setup

### Model

- **Model**: Qwen 3.5 4B (Claude Opus reasoning distilled, Q4_K_M quantization)
- **File**: `models/Qwen3.5-4B.Q4_K_M.gguf`
- **Server**: llama.cpp `llama-server` binary at `bin/llama-server`

### Server Configuration

```bash
llama-server \
  --model ./models/Qwen3.5-4B.Q4_K_M.gguf \
  --host 0.0.0.0 --port 8080 \
  --ctx-size 16384 \
  --n-gpu-layers 99 \       # Full GPU offload (Metal)
  --flash-attn on \
  --parallel 1 \             # Single slot — KV cache reuse across iterations
  --slots \
  --ctx-checkpoints 32 \
  --checkpoint-every-n-tokens 256
```

**Key design choice**: Single-slot mode (`--parallel 1`) ensures the KV cache from the system prompt and earlier conversation turns is reused across ReAct iterations. Without this, every iteration would reprocess the full prompt from scratch.

### KV Cache Behavior

Each agent turn may run 1-5 LLM calls (iterations). The KV cache behavior per iteration:

| Iteration | `cache_n` | `prompt_n` | What happens |
|-----------|-----------|------------|--------------|
| 1 | 0 | ~2700 | Cold start, full prompt processing |
| 2 | ~2700 | ~400 | Cached prefix, only new tokens processed |
| 3 | ~5000 | ~300 | Most of prompt cached |

The `cache_prompt: true` parameter is sent with every request to enable this.

### Model Manager

`src/agent/model-manager.ts` manages the llama-server lifecycle:
- Detects running llama-server on startup
- Can start/stop the server process
- Waits for health endpoint before accepting requests
- Cleans up on SIGTERM/SIGINT

---

## Agent Architecture

### ReAct Loop

`src/agent/orchestrator.ts` implements a streaming ReAct loop with max 15 iterations:

```
User message
    │
    ▼
┌─── Iteration ──────────────────────────────────┐
│  1. Build messages: system prompt + history     │
│  2. Call LLM (streaming)                        │
│     → yields thinking/text/tool_call events     │
│  3. Parse response                              │
│     → tool_calls? Execute each, add results     │
│     → no tool_calls? Done — return final text   │
│  4. Loop back to 1 with updated history         │
└─────────────────────────────────────────────────┘
```

### Streaming with Event Queue

The LLM streams tokens via callbacks. An `EventQueue` bridges these callbacks to an async generator that the HTTP server consumes:

```
LLM callbacks ──push──▶ EventQueue ──drain──▶ async generator ──yield──▶ SSE
  onThinking(chunk)          queue[]              for await (event)       data: {...}
  onText(chunk)              resolve()            yield event
  onToolCall(name)
```

This lets the server stream events to the client in real-time while the LLM is still generating.

### Stream Events

```typescript
type StreamEvent =
  | { type: 'thinking'; content: string }     // reasoning chunk
  | { type: 'text'; content: string }         // response text chunk
  | { type: 'tool_call'; name: string }       // about to execute tool
  | { type: 'tool_result'; name: string; result: unknown }  // tool completed
  | { type: 'done'; session_id, message, thinking, tool_calls_made, iterations }
  | { type: 'error'; message: string }
```

### Tool Calling

Tools are injected into the system prompt (not native function calling). The LLM outputs:

```
<tool_call>{"name":"get_accounts","arguments":{}}</tool_call>
```

The orchestrator parses these from the completed text, executes each tool, and feeds results back as `tool` role messages:

```
<tool_result name="get_accounts">
[{"name":"Checking","balance":4320}]
</tool_result>
```

Tool results are truncated to 3000 chars to keep context manageable.

### Thinking / Reasoning

The model supports extended thinking via two mechanisms:

1. **`reasoning_content` SSE field** — llama-server puts Qwen3's thinking tokens here (separate from `content`). This is the primary source.
2. **`<think>` inline tags** — Fallback. Parsed from completed text if `reasoning_content` isn't available.

System prompt instructs the model: "Think step by step inside `<think>...</think>` tags before responding."

---

## Data Model

All data in SQLite at `~/.pfa/pfa.db`. Amounts stored in **cents** (integers) to avoid floating-point issues.

### Core Financial Tables

```
plaid_items          Linked bank connections (access_token, sync_cursor)
    │
accounts             Bank/investment accounts (balance, type, classification)
    │
    ├── transactions     Individual transactions (amount, date, merchant, category)
    ├── balance_history  Daily balance snapshots per account
    └── holdings         Current investment positions
         └── securities  Security master (ticker, name, type)

categories           Hierarchical spending categories (slug, parent_id)
networth_snapshots   Daily aggregate networth (assets - liabilities)
insights             Dashboard tips/alerts/trends/milestones
```

### Conventions

- **Amounts**: Cents (integer). `$43,200` stored as `4320000`.
- **Direction**: `inflow` (income), `outflow` (spending), `transfer`.
- **Classification**: `asset` or `liability`.
- **Dates**: `YYYY-MM-DD` text.
- **Categories**: Hierarchical via `parent_id`. Slugs like `food_and_drink.delivery`.

### Agent Tables

```
sessions             Conversations (title, source, message_count)
    │
messages             All messages in order (role, content, thinking, tool_calls)
```

**Messages are the single source of truth.** Every message in a conversation is stored:
- `user` — what the user said
- `assistant` — LLM response (may include `thinking`, `tool_calls`)
- `tool` — tool execution result (`tool_call_id`, `tool_name`, content)

The client reads this message list to reconstruct both the chat view and the activity timeline. No separate activity storage — activity IS the conversation history, just rendered differently.

---

## Backend

### Server (`src/agent/server.ts`)

HTTP server on port 3120 (configurable via `PFA_PORT`).

| Method | Path | Description |
|--------|------|-------------|
| POST | `/agent/message` | SSE streaming agent response |
| POST | `/agent/message/sync` | Blocking JSON response |
| GET | `/agent/sessions` | List recent sessions |
| GET | `/agent/sessions/:id/messages` | Full message history |
| GET | `/agent/tools` | Tool definitions |

### Tools (`src/tools/`)

25 tools across 4 modules:

**Bank Data** (`bank-data.ts`):
- `get_accounts` — accounts with balances
- `get_transactions` — search/filter transactions
- `get_balances` — current balances
- `get_investments` — holdings and securities
- `get_recurring_transactions` — auto-detected subscriptions/bills

**Analysis** (`analysis.ts`):
- `compute_spending_summary` — breakdown by category/merchant/period
- `compute_income_summary` — income sources
- `compute_savings_rate` — savings as % of income
- `compute_networth` — current snapshot
- `compute_networth_trend` — historical time series
- `compute_spending_trend` — spending over time with deltas
- `compute_category_deep_dive` — merchant breakdown, day-of-week, trend
- `analyze_income_history` — stability score, monthly patterns
- `compare_periods` — side-by-side period comparison

**Modeling** (`modeling.ts`):
- `project_networth` — future projections (3 scenarios)
- `compute_goal_timeline` — when will you reach $X?
- `simulate_savings_plan` — what-if analysis

**Write Operations** (`write-ops.ts`):
- `update_transaction_category`, `bulk_categorize_transactions`
- `add_transaction_note`
- `upsert_insight`, `delete_insight`
- `crud_manual_asset`
- `trigger_transaction_sync`
- `get_dashboard_data` — composite dashboard payload

### Tool Registry (`registry.ts`)

```typescript
registerTool({ name, description, parameters, handler })
executeTool(name, args)        // dispatched by orchestrator
getToolDefinitions()           // exported to system prompt
```

### Config (`src/config/index.ts`)

```
PFA_DATA_DIR    → ~/.pfa           (database, data)
PFA_PORT        → 3120             (agent server)
LLM_BASE_URL    → localhost:8080   (llama-server)
LLM_PORT        → 8080            (llama-server)
LLM_CTX_SIZE    → 16384           (context window)
PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV → Plaid credentials
```

---

## Client

React 18 + Vite + TypeScript + Tailwind CSS. Dev server on port 5173, proxies `/agent/*` to the backend.

### Layout

```
┌─ Header ──────────────────────────────────────────────────┐
│  [Menu]  PFA logo          [Connect Account] [Dashboard]  │
├────────┬──────────────────────────┬───────────────────────┤
│ Chat   │     Chat Area            │  Right Panel          │
│ History│                          │  (Activity or         │
│        │  User message            │   Dashboard)          │
│ sess 1 │  Agent response          │                       │
│ sess 2 │    [Show activity]       │  Thinking...          │
│ sess 3 │                          │  Get Accounts ✓       │
│        │  User message            │    {result...}        │
│ [New]  │  [streaming...]▍         │  Compute Summary ✓    │
│        │                          │    {result...}        │
│        │  [Input box]             │                       │
├────────┴──────────────────────────┴───────────────────────┤
```

### Component Tree

```
AppLayout
├── ChatHistory          Session list sidebar
├── ChatArea
│   ├── UserMessage      User's messages
│   ├── AgentMessage     Agent responses + "Show activity" button
│   ├── StatusIndicator  "Thinking..." / "Calling X..."
│   ├── StreamingText    Final response streaming with cursor
│   └── ChatInput        Message input
├── ActivityPanel        Thinking, tool calls, tool results timeline
└── DashboardPanel       Visualized tool results (charts, cards)
```

### Streaming Flow

```
1. User sends message
2. POST /agent/message → SSE stream
3. Client processes events:
   thinking  → Activity panel (live-updating single block)
   text      → Optimistically stream to chat
   tool_call → Move pending text to activity, show tool in activity
   tool_result → Show result under tool call in activity
   done      → Finalize chat message, attach activity snapshot
```

### Loading Old Sessions

`loadSessionMessages(sessionId)` fetches the raw message list from `/agent/sessions/:id/messages` and derives:
- **Chat messages**: user messages + final assistant responses
- **Activity per turn**: thinking (from `assistant.thinking`), tool calls + results (from `tool` messages), attached to the agent response they precede

This is the same data the live SSE path produces — messages are the single source of truth for both views.

### Activity Panel

Shows the processing timeline for any agent turn:
- **Thinking** — brain icon, monospace, live-updating cursor during streaming
- **Tool call** — wrench icon, formatted name
- **Tool result** — collapsible JSON under its tool call
- **Intermediate text** — message icon

Click "Show activity" on any agent message (current or old) to load that turn's activity.

---

## Running

```bash
# Start LLM server
./scripts/start-llm.sh

# Start agent server + client dev server
npm run dev:all

# Or separately:
npm run serve          # Agent server on :3120
cd client && npm run dev  # Vite on :5173
```
