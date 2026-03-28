# PFA — Personal Finance Agent

## Table of Contents
- [1. How Skill-Based LLM Agents Work](#1-how-skill-based-llm-agents-work) — theory
- [2. System Architecture](#2-system-architecture) — design
- [3. Complete Skill Inventory](#3-complete-skill-inventory) — design (33 planned)
- [4. Data Model Design](#4-data-model-design) — 12 tables, KISS
- [5. Implementation (Built)](#5-implementation-built) — actual system
  - [5.2 Project Structure](#52-project-structure)
  - [5.3 How the Agent Works](#53-how-the-agent-works) — streaming ReAct loop
  - [5.4 All 25 Implemented Tools](#54-all-25-implemented-tools)
  - [5.5 API Endpoints](#55-api-endpoints)
  - [5.6 How to Run](#56-how-to-run)

---

## 1. How Skill-Based LLM Agents Work

### 1.1 Core Architecture

A skill-based agent is a **while loop that calls an LLM and executes tools**. Three layers:

```
┌─────────────────────────────────────────────┐
│  Layer 1: LLM (the "brain")                 │
│  Receives conversation + tool definitions   │
│  Outputs: text response OR tool call(s)     │
├─────────────────────────────────────────────┤
│  Layer 2: Orchestrator (the "loop")         │
│  Calls LLM → parses output → dispatches     │
│  tool calls → feeds results back → repeats  │
├─────────────────────────────────────────────┤
│  Layer 3: Tools/Skills (the "hands")        │
│  Functions the agent can invoke: DB queries, │
│  API calls, calculations, memory ops, etc.  │
└─────────────────────────────────────────────┘
```

This follows the **ReAct pattern** (Reason + Act):
```
OBSERVE → THINK → ACT → OBSERVE → THINK → ACT → ... → RESPOND
```

### 1.2 Output Format — How We Parse LLM Output

The LLM must produce structured output so we can distinguish between:
- **Tool calls** — agent wants to execute a function
- **Text responses** — agent wants to reply to the user
- **Chain-of-thought** — agent is reasoning (optional, can be hidden)

#### For local models (Ollama / llama.cpp), two approaches:

**Approach A: OpenAI-compatible API (preferred)**

Ollama and llama.cpp both expose `/v1/chat/completions` with native tool calling. Tools are defined in the request, and the response contains structured `tool_calls`:

```json
// REQUEST — tool definitions sent with every LLM call
{
  "model": "qwen2.5:14b",
  "messages": [...],
  "tools": [{
    "type": "function",
    "function": {
      "name": "get_account_balance",
      "description": "Get the current balance for a linked bank account",
      "parameters": {
        "type": "object",
        "properties": {
          "account_id": { "type": "string", "description": "Plaid account ID" }
        },
        "required": ["account_id"]
      }
    }
  }]
}

// RESPONSE — model returns tool_calls when it wants to use a tool
{
  "choices": [{
    "message": {
      "role": "assistant",
      "content": null,
      "tool_calls": [{
        "id": "call_001",
        "type": "function",
        "function": {
          "name": "get_account_balance",
          "arguments": "{\"account_id\": \"abc123\"}"
        }
      }]
    },
    "finish_reason": "tool_calls"   // <-- THIS tells us it's a tool call
  }]
}

// RESPONSE — model returns text when it wants to reply
{
  "choices": [{
    "message": {
      "role": "assistant",
      "content": "Your checking account balance is $4,523.12."
    },
    "finish_reason": "stop"         // <-- THIS tells us it's a final response
  }]
}
```

**How we know what type of output it is:**
- `finish_reason == "tool_calls"` → parse and execute tool calls
- `finish_reason == "stop"` → text response, return to user
- `content` field before tool calls = chain-of-thought reasoning (optional)

**Approach B: Constrained decoding fallback (for models without native tool support)**

Use GBNF grammars with llama.cpp to force valid JSON:
```
<tool_call>
{"name": "get_account_balance", "arguments": {"account_id": "abc123"}}
</tool_call>
```
Parse with regex: `/<tool_call>\s*({.*?})\s*<\/tool_call>/s`

#### Tool result format — feeding results back to the LLM:
```json
{
  "role": "tool",
  "tool_call_id": "call_001",
  "content": "{\"balance\": 4523.12, \"currency\": \"USD\", \"type\": \"checking\"}"
}
```

### 1.3 The Orchestrator Loop

```python
def agent_loop(user_message: str, session: Session, max_iterations: int = 15):
    # Load session history + inject relevant memories
    messages = build_context(session, user_message)

    for i in range(max_iterations):
        # THINK: Call the LLM with full context + tool definitions
        response = llm.chat(
            model=config.model,
            messages=messages,
            tools=get_tools_for_context(session),
        )

        # Append assistant message to history
        messages.append({"role": "assistant", "content": response.content})

        # DECIDE: Tool call or final response?
        if response.finish_reason == "tool_calls":
            # ACT: Execute each tool call
            tool_results = []
            for tool_call in response.tool_calls:
                try:
                    result = execute_tool(tool_call.name, tool_call.arguments)
                    tool_results.append({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": json.dumps(result)
                    })
                except Exception as e:
                    # Errors go back to the LLM as tool results (not exceptions)
                    tool_results.append({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": json.dumps({"error": str(e)})
                    })

            # OBSERVE: Feed results back, loop continues
            messages.extend(tool_results)
        else:
            # Final text response — save to session, return
            session.save_messages(messages)
            return response.content

    return "I wasn't able to complete the task within the iteration limit."
```

**Termination conditions:**
1. Model responds with text only (no tool calls) — primary exit
2. Iteration limit hit (safety cap)
3. User cancellation

**Key design principle:** Errors become tool results, not exceptions. The LLM sees the error and reasons about recovery (retry, try different tool, ask user).

### 1.4 Tool/Skill Definition Format

Each tool is defined with:
1. **Name** — unique identifier (e.g., `get_transactions`)
2. **Description** — tells the LLM when/how to use it (critical for tool selection)
3. **Parameters** — JSON Schema defining inputs
4. **Handler** — the actual function that executes

```typescript
interface ToolDefinition {
  name: string;
  description: string;  // 2-4 sentences: what it does, when to use it
  parameters: JSONSchema;
  handler: (args: Record<string, any>) => Promise<any>;
}
```

**The description is the most important field.** The LLM decides which tool to call based almost entirely on description matching to user intent. Good descriptions include:
- What the tool does
- When to use it (and when NOT to)
- What the output contains

### 1.5 Memory Architecture

Three tiers for our agent:

| Type | Purpose | Storage | Lifetime |
|------|---------|---------|----------|
| **Working memory** | Current conversation context | In-memory (messages array) | Session only |
| **Semantic memory** | Facts, preferences, financial insights | Vector DB (FAISS/Chroma) + SQLite | Persistent |
| **Structured memory** | Account data, transactions, networth | SQLite (client DB) | Persistent |

The agent uses **memory tools** to decide what to store:
- After processing transactions → extract patterns → store insights in semantic memory
- User mentions a preference → store in semantic memory
- Computed financial summaries → store in structured client DB

**Memory retrieval flow:**
```
User query → embed query → vector similarity search → top-K relevant memories
                                                          ↓
                                          inject into system prompt
                                                          ↓
                                              LLM generates response
```

### 1.6 On-Device LLM Choice

**Model:** `Jackrong/Qwen3.5-9B-Claude-4.6-Opus-Reasoning-Distilled-GGUF` (Q4_K_M, ~5.5 GB)
- Qwen3.5 9B distilled from Claude Opus — good reasoning + tool following
- Q4_K_M quantization — fits in ~8 GB RAM, fast on Apple Silicon
- Configurable via `LLM_MODEL_PATH` env var — swap any GGUF model

**Runtime:** `llama-cpp-python` server (OpenAI-compatible `/v1/chat/completions` on localhost:8080)

**Tool calling approach:** Prompt-based, not API-native.
- Tool definitions are injected into the system prompt as text
- Model outputs `<tool_call>{"name":"...","arguments":{...}}</tool_call>` tags
- Orchestrator parses these tags, executes tools, feeds results back as `<tool_result>` messages
- `<think>` reasoning blocks are stripped from user-facing output
- This works with ANY local model — no dependency on provider-specific function calling APIs

---

## 2. System Architecture

### 2.1 High-Level Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        CLIENT (React/Next.js)                     │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────────┐ │
│  │  Dashboard   │  │  Chat Pane   │  │  Account Management     │ │
│  │  - Networth  │  │  - Sessions  │  │  - Link accounts        │ │
│  │  - Spending  │  │  - Messages  │  │  - Manual assets        │ │
│  │  - Trends    │  │  - Streaming │  │  - Categories           │ │
│  └──────┬───────┘  └──────┬───────┘  └───────────┬─────────────┘ │
│         │                 │                       │               │
└─────────┼─────────────────┼───────────────────────┼───────────────┘
          │                 │                       │
          ▼                 ▼                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                    AGENT SERVICE (HTTP/WebSocket)                  │
│                                                                    │
│  Standard message schema — all callers use the same interface:    │
│                                                                    │
│  POST /agent/message  { session_id, message, source, metadata }   │
│  WS   /agent/stream   (real-time streaming responses)             │
│                                                                    │
│  Sources: "user_chat" | "plaid_webhook" | "scheduled" | "system"  │
│                                                                    │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │                   ORCHESTRATOR LOOP                         │   │
│  │  ┌──────────┐    ┌──────────┐    ┌──────────────────────┐ │   │
│  │  │ Context   │───▶│ LLM Call │───▶│ Parse & Execute     │ │   │
│  │  │ Builder   │    │ (Ollama) │    │ Tool Calls          │ │   │
│  │  └──────────┘    └──────────┘    └──────────┬───────────┘ │   │
│  │       ▲                                      │             │   │
│  │       └──────────────────────────────────────┘             │   │
│  └────────────────────────────────────────────────────────────┘   │
│                              │                                     │
│              ┌───────────────┼───────────────┐                    │
│              ▼               ▼               ▼                    │
│  ┌────────────────┐ ┌──────────────┐ ┌────────────────────┐      │
│  │  SKILL/TOOLS   │ │   MEMORY     │ │   CLIENT DB        │      │
│  │  Registry      │ │   (Mem0 +    │ │   (SQLite)         │      │
│  │                │ │   FAISS)     │ │                    │      │
│  │  Bank tools    │ │              │ │  accounts          │      │
│  │  Analysis tools│ │  Semantic    │ │  transactions      │      │
│  │  Memory tools  │ │  store for   │ │  balances          │      │
│  │  UI tools      │ │  insights,   │ │  networth_history  │      │
│  │  Asset tools   │ │  preferences │ │  categories        │      │
│  │  Projection    │ │  patterns    │ │  manual_assets     │      │
│  │  tools         │ │              │ │  summaries         │      │
│  └────────────────┘ └──────────────┘ └────────────────────┘      │
│                                                                    │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │  SESSION MANAGER                                            │   │
│  │  - Each chat = new session (own message history)            │   │
│  │  - All sessions share memory store + client DB              │   │
│  │  - Session metadata: source, created_at, summary            │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                    │
└──────────────────────────────────────────────────────────────────┘
          │                                        │
          ▼                                        ▼
┌──────────────────┐                    ┌──────────────────────┐
│  PLAID SERVICE   │                    │  SCHEDULER SERVICE   │
│  - Link accounts │                    │  - Cron-based        │
│  - Sync txns     │                    │  - Daily sync        │
│  - Webhooks      │                    │  - Weekly summaries  │
│  - Read balances │                    │  - Monthly reports   │
└──────────────────┘                    └──────────────────────┘
```

### 2.2 Standard Message Schema

Every caller (UI chat, Plaid webhook, scheduler, system) sends the same format:

```typescript
interface AgentMessage {
  session_id: string;       // UUID — groups a conversation
  message: string;          // The content/prompt
  source: "user_chat" | "plaid_webhook" | "scheduled" | "system";
  metadata?: {
    // Source-specific context
    webhook_type?: string;  // e.g., "SYNC_UPDATES_AVAILABLE"
    item_id?: string;       // Plaid item that triggered this
    schedule_name?: string; // e.g., "daily_sync", "weekly_summary"
    [key: string]: any;
  };
}

interface AgentResponse {
  session_id: string;
  message: string;          // Text response to display
  tool_calls_made: string[];// Which tools were invoked (for transparency)
  data_updates?: {          // If agent updated any client DB data
    type: string;
    summary: string;
  }[];
}
```

### 2.3 Session Model

```
Session A (user chat):     user asks "how much did I spend on dining?"
Session B (plaid webhook): "New transactions detected, categorize and update summaries"
Session C (scheduled):     "Generate weekly spending report"
Session D (user chat):     user asks "project my networth for next year"

All sessions share:
  → Memory store (semantic/episodic memories)
  → Client DB (accounts, transactions, summaries, networth)
```

### 2.4 Plug-and-Play Module Design

```typescript
// LLM Provider — swappable
interface LLMProvider {
  chat(messages: Message[], tools: Tool[]): Promise<LLMResponse>;
  embed(text: string): Promise<number[]>;  // for memory
}

// Implementations: OllamaProvider, LlamaCppProvider, (future: OpenAIProvider)

// Memory Provider — swappable
interface MemoryProvider {
  add(content: string, metadata: Record<string, any>): Promise<string>;
  search(query: string, limit: number): Promise<Memory[]>;
  update(id: string, content: string): Promise<void>;
  delete(id: string): Promise<void>;
}

// Implementations: Mem0Provider, ChromaProvider, (future: custom)

// Bank Data Provider — swappable
interface BankDataProvider {
  linkAccount(publicToken: string): Promise<AccessToken>;
  getAccounts(accessToken: string): Promise<Account[]>;
  syncTransactions(accessToken: string, cursor?: string): Promise<TransactionSync>;
  getBalances(accessToken: string): Promise<Balance[]>;
  getInvestments(accessToken: string): Promise<Holdings[]>;
}

// Implementations: PlaidProvider, (future: others)
```

---

## 3. Complete Skill Inventory

Skills are grouped by domain. Each skill = tool definition (name, description, params) + handler function.

### 3.1 Bank Data Skills (Read-Only)

These read from Plaid-synced data in the client DB. Bank data is **never written by the agent** — only by the Plaid sync service.

#### `get_accounts`
```
Description: List all linked bank accounts with current balances.
             Use when the user asks about their accounts, total balance,
             or when you need account IDs for other queries.
Parameters:  { type?: string }  // optional filter: "depository", "credit", "investment", "loan"
Returns:     Account[] with balances
```

#### `get_transactions`
```
Description: Search and retrieve bank transactions. Use when the user asks
             about spending, purchases, income, or specific transactions.
             Supports filtering by date range, account, category, merchant,
             and amount range.
Parameters:  {
  account_id?: string,
  start_date?: string,      // ISO date
  end_date?: string,
  category?: string,        // e.g., "FOOD_AND_DRINK", "TRANSPORTATION"
  merchant?: string,        // partial match
  min_amount?: number,
  max_amount?: number,
  limit?: number            // default 50
}
Returns:     Transaction[] with category, merchant, amount, date
```

#### `get_balances`
```
Description: Get current balances for all accounts or a specific account.
             Use when calculating networth or checking specific account status.
Parameters:  { account_id?: string }
Returns:     Balance[] with available, current, limit
```

#### `get_investments`
```
Description: Get investment holdings with securities info, quantities, and values.
             Use when the user asks about their portfolio, stocks, or investment performance.
Parameters:  { account_id?: string }
Returns:     Holding[] with security details, quantity, value, cost_basis
```

#### `get_recurring_transactions`
```
Description: Get identified recurring transactions (subscriptions, bills, income).
             Use when analyzing fixed expenses or income patterns.
Parameters:  { type?: "subscription" | "bill" | "income" }
Returns:     RecurringTransaction[] with frequency, amount, merchant, next_date
```

### 3.2 Analysis & Computation Skills

These perform calculations on the data. They read from the client DB and return computed results. The agent chains these together with memory and reasoning to answer complex financial questions.

#### `compute_spending_summary`
```
Description: Calculate total spending broken down by category for a date range.
             Use when the user asks "where does my money go?" or wants a
             spending breakdown. Returns top categories with amounts and percentages.
Parameters:  {
  start_date: string,
  end_date: string,
  account_id?: string,
  group_by?: "category" | "merchant" | "week" | "month"
}
Returns:     { groups: { name, amount, percentage, transaction_count }[], total: number }
```

#### `compute_income_summary`
```
Description: Calculate total income broken down by source for a date range.
             Use when analyzing earnings, identifying where the user makes
             the most money, or computing savings rate. Detects payroll,
             freelance, investment income, refunds, transfers in.
Parameters:  {
  start_date: string,
  end_date: string,
  group_by?: "source" | "month" | "account"
}
Returns:     { sources: { name, amount, percentage, frequency }[], total: number }
```

#### `compute_savings_rate`
```
Description: Calculate savings rate (income minus spending divided by income)
             for a period. Use when the user asks about savings, wants to
             know how much they're saving, or asks "how can I save more?"
             Also returns the breakdown showing where money goes.
Parameters:  {
  start_date: string,
  end_date: string,
  interval?: "monthly" | "quarterly" | "yearly"
}
Returns:     {
  periods: {
    period: string,
    income: number,
    spending: number,
    savings: number,
    savings_rate_pct: number
  }[],
  average_savings_rate_pct: number,
  trend: "improving" | "declining" | "stable"
}
```

#### `compute_networth`
```
Description: Calculate current networth: total assets minus total liabilities.
             Includes bank accounts, investments, manual assets, minus credit
             balances and loans. Use when user asks about networth.
Parameters:  { as_of_date?: string }
Returns:     { networth, assets: { liquid, investments, manual, total },
               liabilities: { credit, loans, total }, breakdown_by_account[] }
```

#### `compute_networth_trend`
```
Description: Calculate networth over time for trend analysis. Returns data
             points for charting. Use when user asks about networth growth
             or trends.
Parameters:  {
  start_date: string,
  end_date: string,
  interval: "daily" | "weekly" | "monthly"
}
Returns:     { date, networth, assets, liabilities }[]
```

#### `compute_spending_trend`
```
Description: Calculate spending over time, optionally filtered by category.
             Use for trend analysis, month-over-month comparisons, or to
             identify which categories are growing fastest.
Parameters:  {
  start_date: string,
  end_date: string,
  interval: "weekly" | "monthly",
  category?: string
}
Returns:     { period, amount, vs_previous_period_pct }[]
```

#### `compute_category_deep_dive`
```
Description: Deep analysis of a single spending category — merchant breakdown,
             frequency patterns, time-of-day/day-of-week distribution, trend,
             and comparison to historical average. Use when user asks to
             understand a specific category in detail, or when building
             reduction recommendations.
Parameters:  {
  category: string,
  start_date: string,
  end_date: string
}
Returns:     {
  total: number,
  merchant_breakdown: { merchant, amount, count, avg_per_txn }[],
  frequency: { avg_per_week: number, pattern: string },
  day_of_week_distribution: { day, amount }[],
  vs_historical_avg_pct: number,
  monthly_trend: { month, amount }[]
}
```

### 3.2b Financial Modeling & Projection Skills

These power forward-looking analysis: goal planning, what-if scenarios, savings optimization.

#### `project_networth`
```
Description: Project future networth based on current trends, income, and
             spending patterns. Use when user asks "what will my networth be
             in Y months?" or "at my current rate, where will I be in 5 years?"
             Runs three scenarios by default. Can model investment returns.
Parameters:  {
  months_ahead: number,
  scenario?: "optimistic" | "baseline" | "conservative" | "all",
  assumptions?: {
    monthly_income?: number,          // override detected income
    monthly_spending?: number,        // override detected spending
    annual_investment_return_pct?: number,  // default: 7% baseline
    one_time_events?: { month: number, amount: number, label: string }[]
  }
}
Returns:     {
  scenarios: {
    name: string,
    projections: { date, networth, cumulative_savings, investment_growth }[],
    final_networth: number,
    assumptions: string[]
  }[]
}
```

#### `compute_goal_timeline`
```
Description: Calculate when the user will reach a financial goal given current
             trajectory. Use for "when will I reach $X?", "when will I be
             debt-free?", "when can I afford a down payment?" Supports
             networth targets, savings targets, and debt payoff.
Parameters:  {
  goal_type: "networth" | "savings" | "debt_payoff" | "target_amount",
  target_amount: number,
  starting_from?: string,           // ISO date, defaults to now
  assumptions?: {
    monthly_contribution?: number,  // extra savings toward goal
    annual_return_pct?: number,
    monthly_spending_reduction?: number
  }
}
Returns:     {
  estimated_date: string,
  months_to_goal: number,
  monthly_progress_needed: number,
  current_monthly_progress: number,
  on_track: boolean,
  scenarios: {
    name: string,          // "current_pace", "with_adjustments"
    months: number,
    date: string
  }[]
}
```

#### `simulate_savings_plan`
```
Description: Model how changes to spending or income affect savings over time.
             Use when user asks "how can I double my savings?", "what if I
             cut dining by 50%?", "what if I get a $10k raise?". Compares
             current trajectory vs. modified trajectory.
Parameters:  {
  months: number,                   // simulation period
  changes: {
    spending_cuts?: { category: string, reduction_pct: number }[],
    income_changes?: { source: string, amount: number }[],  // positive = increase
    new_recurring?: { name: string, amount: number, type: "expense" | "income" }[],
    cancel_subscriptions?: string[],   // merchant names to cut
    lump_sum_events?: { month: number, amount: number, label: string }[]
  }
}
Returns:     {
  current_trajectory: { month, savings, cumulative }[],
  modified_trajectory: { month, savings, cumulative }[],
  total_difference: number,
  monthly_difference: number,
  savings_rate_change: { from_pct: number, to_pct: number },
  biggest_impact_changes: { change: string, monthly_impact: number }[]
}
```

#### `analyze_income_history`
```
Description: Analyze historical income patterns — where has the user earned
             the most, income growth over time, seasonal patterns, income
             diversification. Use for "where have I historically made the
             most money?", "how has my income grown?", "what's my most
             reliable income source?"
Parameters:  {
  start_date: string,
  end_date: string,
  group_by?: "source" | "month" | "quarter" | "year"
}
Returns:     {
  total_earned: number,
  by_source: { source, total, percentage, months_active, avg_monthly }[],
  growth: { period, income, growth_pct }[],
  best_months: { month, income, top_source }[],
  income_stability_score: number,     // 0-100, higher = more stable
  diversification_score: number       // 0-100, higher = more diversified
}
```

### 3.2c Period Comparison Skills

#### `compare_periods`
```
Description: Compare two time periods side by side — spending, income,
             savings rate, networth change. Pure arithmetic: sums both
             periods and computes deltas. Use for "how did this month
             compare to last month?", "am I doing better than last year?"
Parameters:  {
  period_a: { start_date: string, end_date: string, label?: string },
  period_b: { start_date: string, end_date: string, label?: string },
  metrics?: ("spending" | "income" | "savings_rate" | "networth_change")[]
}
Returns:     {
  period_a: { label, spending, income, savings, networth_change, by_category },
  period_b: { label, spending, income, savings, networth_change, by_category },
  differences: {
    spending_delta: number,
    spending_delta_pct: number,
    income_delta: number,
    savings_rate_delta_pct: number,
    biggest_category_changes: { category, delta, direction }[]
  }
}
```

### 3.2d What Tools Do vs. What the LLM Does

This is a critical design principle. **Tools are for atomic data retrieval and deterministic computation. The LLM is for reasoning, judgment, recommendations, and synthesis.**

```
┌─────────────────────────────────────────────────────────────────┐
│                        TOOL TERRITORY                            │
│  (scripts, SQL queries, arithmetic — same output every time)    │
│                                                                  │
│  "What are my transactions for March?"     → get_transactions   │
│  "What's my networth?"                     → compute_networth   │
│  "What's my savings rate?"                 → compute_savings_rate│
│  "Project networth at 7% for 5 years"      → project_networth   │
│  "How does March compare to February?"     → compare_periods    │
│  "Group my dining spend by merchant"       → category_deep_dive │
│  "What's my income by source?"             → income_summary     │
│  "If I save $500 more/mo, what happens?"   → simulate_savings   │
│  "When do I hit $500k at current rate?"    → goal_timeline      │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                        LLM TERRITORY                             │
│  (reasoning, judgment, creativity — requires intelligence)      │
│                                                                  │
│  "Where can I cut costs?"                                        │
│     → LLM fetches spending data, recurring txns, subscription   │
│       list via tools, then REASONS about what's cuttable        │
│                                                                  │
│  "How do I double my savings?"                                   │
│     → LLM fetches savings rate + spending breakdown + income    │
│       via tools, then REASONS about a plan                      │
│                                                                  │
│  "How do I reach $1M by 40?"                                    │
│     → LLM fetches networth + income + projections via tools,    │
│       then REASONS about steps, tradeoffs, priorities           │
│                                                                  │
│  "Anything unusual in my spending?"                              │
│     → LLM fetches recent txns + historical averages via tools,  │
│       then REASONS about what looks anomalous                   │
│                                                                  │
│  "Should I pay off debt or invest?"                              │
│     → LLM fetches debt balances + rates + investment returns    │
│       via tools, then REASONS about the tradeoff                │
│                                                                  │
│  "Build me a financial plan"                                     │
│     → LLM calls 5-8 tools across multiple loops, accumulates   │
│       data, then SYNTHESIZES a coherent plan with priorities    │
└─────────────────────────────────────────────────────────────────┘
```

**The test:** Can you write a deterministic script for it? If yes → tool. If it requires judgment, prioritization, personalization, or weighing tradeoffs → LLM reasoning over tool outputs.

**Why this matters:**
- `find_savings_opportunities` is NOT a tool — "is this subscription worth canceling?" is a judgment call based on usage frequency, user priorities, and context only the LLM can weigh
- `build_financial_plan` is NOT a tool — there's no script that outputs "pick up freelance work" vs "negotiate rent" — that's reasoning
- `detect_anomalies` is NOT a tool — "is a $450 charge unusual?" depends on context the LLM understands from memory and patterns
- `project_networth(months=60, rate=7%)` IS a tool — it's compound interest math, same answer every time
- `compare_periods(march, february)` IS a tool — it's subtraction

The agent's power comes from **chaining multiple tool calls with reasoning between them**. A complex question like "how do I double my savings?" triggers 3-5 tool calls across multiple orchestrator loops, with the LLM reasoning about what to fetch next based on what it learned from the previous tool result.

### 3.3 Memory Skills

These let the agent manage its own long-term knowledge. The agent decides what's worth remembering.

#### `memory_store`
```
Description: Store an insight, user preference, or financial pattern in
             long-term memory. Use when you learn something worth remembering
             across sessions: spending patterns, user goals, financial habits,
             important observations.
Parameters:  {
  content: string,          // The insight/fact to remember
  category: "insight" | "preference" | "pattern" | "goal" | "context",
  tags?: string[]           // e.g., ["spending", "dining", "reduction"]
}
Returns:     { memory_id: string }
```

#### `memory_search`
```
Description: Search long-term memory for relevant context. Use at the start
             of conversations or when you need background on a topic the
             user has discussed before.
Parameters:  {
  query: string,
  category?: string,
  limit?: number            // default 5
}
Returns:     Memory[] with content, category, created_at, relevance_score
```

#### `memory_update`
```
Description: Update an existing memory with new or corrected information.
             Use when a previous insight is outdated or needs refinement.
Parameters:  { memory_id: string, content: string }
Returns:     { success: boolean }
```

#### `memory_delete`
```
Description: Delete a memory that is no longer relevant.
Parameters:  { memory_id: string }
Returns:     { success: boolean }
```

### 3.4 Client DB / UI Data Skills

These write to the client DB — powering the dashboard UI. The agent uses these to update summaries, categorize transactions, add notes, etc.

#### `update_transaction_category`
```
Description: Recategorize a transaction. Use when the user says a transaction
             is miscategorized or when you detect a better category during analysis.
             This only updates the local category, not the bank's.
Parameters:  { transaction_id: string, category: string, subcategory?: string }
Returns:     { success: boolean }
```

#### `bulk_categorize_transactions`
```
Description: Categorize multiple transactions at once. Use after syncing new
             transactions or when the user asks you to clean up categories.
Parameters:  { updates: { transaction_id: string, category: string }[] }
Returns:     { updated_count: number }
```

#### `add_transaction_note`
```
Description: Add a note or tag to a transaction. Use when the user provides
             context about a transaction (e.g., "that was a birthday gift").
Parameters:  { transaction_id: string, note: string }
Returns:     { success: boolean }
```

#### `upsert_spending_summary`
```
Description: Write or update a spending summary for a period. Use after
             computing spending analysis to persist it for the dashboard.
Parameters:  {
  period: string,           // e.g., "2026-03", "2026-W12"
  period_type: "month" | "week",
  total_spending: number,
  by_category: { category: string, amount: number }[],
  vs_previous_period_pct: number,
  highlights: string[]      // key observations
}
Returns:     { success: boolean }
```

#### `upsert_networth_snapshot`
```
Description: Save a networth snapshot for historical tracking. Use after
             computing networth to persist it for trend charts.
Parameters:  {
  date: string,
  networth: number,
  assets: number,
  liabilities: number,
  breakdown: { account_id: string, value: number }[]
}
Returns:     { success: boolean }
```

#### `upsert_insight`
```
Description: Write a financial insight or tip to display on the dashboard.
             Use when you discover actionable patterns: spending spikes,
             savings opportunities, unusual activity, goal progress.
Parameters:  {
  type: "tip" | "alert" | "trend" | "milestone",
  title: string,
  body: string,
  priority: "low" | "medium" | "high",
  related_category?: string,
  expires_at?: string       // optional expiry for time-sensitive insights
}
Returns:     { insight_id: string }
```

#### `delete_insight`
```
Description: Remove an insight that is no longer relevant.
Parameters:  { insight_id: string }
Returns:     { success: boolean }
```

### 3.5 Manual Asset Skills

For assets not tracked by Plaid (real estate, crypto wallets, vehicles, etc.).

#### `crud_manual_asset`
```
Description: Create, read, update, or delete a manually tracked asset or
             liability. Use when the user wants to add a house, car, crypto
             wallet, or other asset/liability not linked via Plaid.
Parameters:  {
  action: "create" | "read" | "update" | "delete",
  asset_id?: string,        // required for update/delete
  data?: {
    name: string,
    type: "real_estate" | "vehicle" | "crypto" | "valuable" | "other_asset" | "other_liability",
    value: number,
    currency?: string,
    notes?: string
  }
}
Returns:     ManualAsset | ManualAsset[] | { success: boolean }
```

#### `update_manual_asset_value`
```
Description: Update just the value of a manual asset. Use for periodic
             revaluation (e.g., home value estimate changed).
Parameters:  { asset_id: string, value: number, note?: string }
Returns:     { success: boolean }
```

### 3.6 Plaid Integration Skills (System-Level)

These are invoked by the Plaid service or scheduler, not typically by user chat. But the agent can trigger a sync.

#### `trigger_transaction_sync`
```
Description: Trigger a fresh transaction sync from Plaid for one or all
             linked accounts. Use when the user asks for latest data or
             says "refresh my transactions".
Parameters:  { item_id?: string }  // if omitted, sync all items
Returns:     { synced_count: number, new_transactions: number }
```

#### `get_link_token`
```
Description: Generate a Plaid Link token so the user can connect a new
             bank account. Returns a token the UI uses to launch Plaid Link.
Parameters:  {}
Returns:     { link_token: string, expiration: string }
```

### 3.7 Dashboard Data Skills

Read operations for the UI to fetch precomputed data.

#### `get_dashboard_data`
```
Description: Get all data needed to render the financial dashboard:
             current networth, recent spending summary, active insights,
             account overview. Use when the user opens the app or asks
             for an overview.
Parameters:  {}
Returns:     {
  networth: NetworthSnapshot,
  spending_summary: SpendingSummary,    // current month
  insights: Insight[],
  accounts: AccountSummary[],
  networth_trend: { date, value }[]     // last 12 months
}
```

---

## 3.8 Skill Summary Table

| # | Skill Name | Domain | Type | What it does |
|---|-----------|--------|------|-------------|
| | **Bank Data (read-only)** | | | |
| 1 | `get_accounts` | Bank Data | Query | List linked accounts + balances |
| 2 | `get_transactions` | Bank Data | Query | Filter/search transactions |
| 3 | `get_balances` | Bank Data | Query | Current balances per account |
| 4 | `get_investments` | Bank Data | Query | Holdings, securities, values |
| 5 | `get_recurring_transactions` | Bank Data | Query | Subscriptions, bills, recurring income |
| | **Analysis (deterministic computation)** | | | |
| 6 | `compute_spending_summary` | Analysis | Aggregation | Group spending by category/merchant/period |
| 7 | `compute_income_summary` | Analysis | Aggregation | Group income by source/period |
| 8 | `compute_savings_rate` | Analysis | Arithmetic | (income - spending) / income per period |
| 9 | `compute_networth` | Analysis | Arithmetic | assets - liabilities, broken down |
| 10 | `compute_networth_trend` | Analysis | Aggregation | Networth data points over time |
| 11 | `compute_spending_trend` | Analysis | Aggregation | Spending data points over time |
| 12 | `compute_category_deep_dive` | Analysis | Aggregation | Merchant, frequency, day-of-week breakdown |
| 13 | `analyze_income_history` | Analysis | Aggregation | Income by source, growth, stability |
| 14 | `compare_periods` | Analysis | Arithmetic | Diff two time periods on all metrics |
| | **Modeling (deterministic projections)** | | | |
| 15 | `project_networth` | Modeling | Math | Compound interest + savings projection |
| 16 | `compute_goal_timeline` | Modeling | Math | Months to target given rate + returns |
| 17 | `simulate_savings_plan` | Modeling | Math | Current vs modified trajectory comparison |
| | **Memory** | | | |
| 18 | `memory_store` | Memory | Write | Persist insight/preference/pattern |
| 19 | `memory_search` | Memory | Read | Semantic search over memories |
| 20 | `memory_update` | Memory | Write | Revise existing memory |
| 21 | `memory_delete` | Memory | Write | Remove stale memory |
| | **Client DB / UI Data** | | | |
| 22 | `update_transaction_category` | Client DB | Write | Recategorize a transaction |
| 23 | `bulk_categorize_transactions` | Client DB | Write | Batch recategorize |
| 24 | `add_transaction_note` | Client DB | Write | Attach note to transaction |
| 25 | `upsert_spending_summary` | Client DB | Write | Persist summary for dashboard |
| 26 | `upsert_networth_snapshot` | Client DB | Write | Persist networth for trend chart |
| 27 | `upsert_insight` | Client DB | Write | Write insight/tip/alert to dashboard |
| 28 | `delete_insight` | Client DB | Write | Remove expired insight |
| | **Manual Assets** | | | |
| 29 | `crud_manual_asset` | Assets | CRUD | Create/read/update/delete manual assets |
| 30 | `update_manual_asset_value` | Assets | Write | Revalue an asset |
| | **Plaid Integration** | | | |
| 31 | `trigger_transaction_sync` | Plaid | System | Pull latest from Plaid |
| 32 | `get_link_token` | Plaid | System | Generate token for account linking UI |
| | **Dashboard** | | | |
| 33 | `get_dashboard_data` | Dashboard | Read | All data for UI render |

**Total: 33 tools**

**NOT tools — these are LLM reasoning tasks that chain the above tools:**
- "Where can I cut costs?" → LLM fetches spending + recurring txns + memory → reasons
- "How do I double my savings?" → LLM fetches savings rate + categories + simulates → reasons
- "Build me a plan to reach $X by Y" → LLM fetches networth + income + projections → synthesizes
- "Anything unusual?" → LLM fetches recent txns + historical patterns → judges
- "Should I pay off debt or invest?" → LLM fetches debt + investment data → weighs tradeoffs

---

## 3.9 How Skills Compose — Example Agent Flows

### Flow 1: User asks "How much did I spend on food this month?"

```
User → "How much did I spend on food this month?"

Loop 1: LLM calls → get_transactions(category="FOOD_AND_DRINK", start_date="2026-03-01", end_date="2026-03-23")
         Result → 47 transactions totaling $842.30

Loop 2: LLM calls → memory_search(query="food spending goals")
         Result → Memory: "User wants to keep dining under $500/month"

Loop 3: LLM responds →
         "You've spent $842.30 on food this month across 47 transactions.
          That's already $342 over your $500 target with a week left.
          Top merchants: DoorDash ($234), Whole Foods ($189), Starbucks ($87).
          Want me to break it down further?"

         LLM also calls → memory_store("March 2026: food spending significantly over $500 target at $842 by 3/23")
         LLM also calls → upsert_insight(type="alert", title="Food spending over budget", ...)
```

### Flow 2: Plaid webhook triggers new transaction sync

```
Plaid webhook → Agent message:
  { source: "plaid_webhook", message: "New transactions available for item_xxx",
    metadata: { webhook_type: "SYNC_UPDATES_AVAILABLE", item_id: "xxx" } }

Loop 1: LLM calls → trigger_transaction_sync(item_id="xxx")
         Result → 12 new transactions

Loop 2: LLM calls → bulk_categorize_transactions([...12 transactions with AI-assigned categories])

Loop 3: LLM calls → compute_spending_summary(start_date="2026-03-01", end_date="2026-03-23")
         Result → Updated totals

Loop 4: LLM calls → upsert_spending_summary(period="2026-03", ...)
         LLM calls → compute_networth(as_of_date="2026-03-23")
         LLM calls → upsert_networth_snapshot(...)

Loop 5: LLM detects unusual spending → upsert_insight(type="alert", title="Unusual $450 charge at...", ...)

Final: LLM responds (logged, not shown to user since source is webhook)
```

### Flow 3: Weekly scheduled summary

```
Scheduler → Agent message:
  { source: "scheduled", message: "Generate weekly financial summary",
    metadata: { schedule_name: "weekly_summary" } }

Loop 1: LLM calls → compute_spending_summary(start_date="2026-03-16", end_date="2026-03-23", group_by="category")
Loop 2: LLM calls → compute_spending_trend(start_date="2026-02-23", end_date="2026-03-23", interval="weekly")
Loop 3: LLM calls → compute_networth()
Loop 4: LLM calls → memory_search(query="weekly spending patterns and goals")
Loop 5: LLM generates insights, calls → upsert_insight(type="trend", title="Week 12 Summary", ...)
         LLM calls → upsert_spending_summary(period="2026-W12", ...)
         LLM calls → memory_store("Week 12: spending down 8% from week 11, on track for monthly goal")
```

### Flow 4: "How can I double my savings?"

This shows the LLM doing advisory reasoning — no "find_savings" or "build_plan" tool exists. The LLM gathers data via atomic tools, then reasons.

```
User → "How can I increase my savings 2x?"

Loop 1 (parallel tool calls — LLM gathers raw data):
  LLM calls → compute_savings_rate(start_date="2025-12-01", end_date="2026-03-23", interval="monthly")
  LLM calls → compute_spending_summary(start_date="2025-12-01", end_date="2026-03-23", group_by="category")
  LLM calls → compute_income_summary(start_date="2025-12-01", end_date="2026-03-23")
  LLM calls → get_recurring_transactions()
  LLM calls → memory_search(query="savings goals financial priorities")

Results:
  - Savings rate: 18% avg ($1,260/mo saved on $7,000/mo income, $5,740/mo spending)
  - Top categories: Rent $2,100, Dining $840, Shopping $620, Groceries $480, Transport $390...
  - Income: $7,000/mo salary
  - Recurring: Netflix $15, Hulu $18, Disney+ $14, ClassPass $49, Spotify $11, gym $45...
  - Memory: "User mentioned wanting to buy a house in 2 years"

  ** LLM REASONS (no tool needed): **
  "To double savings from $1,260 to $2,520, I need to find $1,260/mo in cuts or income.
   Looking at the data:
   - Dining at $840 is the biggest discretionary bucket, 30% cut = $252/mo
   - Shopping at $620, 25% cut = $155/mo
   - ClassPass recurring but last txn was 6 weeks ago = $49/mo
   - Duplicate streaming (3 services) = could cut 1-2 for $18-32/mo
   Let me verify the dining and shopping details, and then simulate."

Loop 2 (LLM digs deeper into specific categories):
  LLM calls → compute_category_deep_dive(category="FOOD_AND_DRINK", start_date="2025-12-01", end_date="2026-03-23")
  LLM calls → compute_category_deep_dive(category="SHOPPING", start_date="2025-12-01", end_date="2026-03-23")

Results:
  - Dining: DoorDash $234/mo, Whole Foods $189, Starbucks $87, restaurants $330
  - Shopping: Amazon $380/mo (60% orders under $25, peak at 11pm), clothing $140, misc $100

  ** LLM REASONS: **
  "DoorDash $234/mo is the biggest single lever. Late-night Amazon impulse buying
   is $228/mo. These two habits alone = $462/mo if cut in half."

Loop 3 (LLM validates with projection math):
  LLM calls → simulate_savings_plan(months=12, changes={
    spending_cuts: [
      { category: "FOOD_AND_DRINK", reduction_pct: 30 },
      { category: "SHOPPING", reduction_pct: 25 }
    ]
  })

Results:
  - Current: $1,260/mo saved → $15,120/yr
  - Modified: $2,530/mo saved → $30,360/yr (2.01x!)
  - Savings rate: 18% → 36%

Loop 4: LLM SYNTHESIZES response + persists:
  → memory_store("User goal: double savings from $1,260 to $2,520/mo. Key levers: dining -30%, shopping -25%")
  → upsert_insight(type="tip", title="Path to 2x savings", ...)

Response: "You're saving $1,260/month (18%). To double it to $2,520/month:
  1. Cut dining from $840 → $590 (-$250/mo) — your DoorDash alone is $234/mo
  2. Reduce shopping from $620 → $465 (-$155/mo) — 60% of Amazon orders are impulse buys under $25
  3. Cancel ClassPass ($49) — you haven't gone in 6 weeks
  4. Drop Hulu ($18) — you already have Netflix + Disney+
  That's $472/mo in cuts → $1,732/mo saved (still $788 short of 2x).
  For the rest, you'd need income growth or deeper cuts.
  Want me to model what happens if you also cut DoorDash entirely or pick up freelance?"
```

### Flow 5: "Where have I historically made the most money?"

```
User → "Where have I historically made most money?"

Loop 1:
  LLM calls → analyze_income_history(start_date="2024-01-01", end_date="2026-03-23", group_by="source")

Results:
  - Total earned: $168,400 over 27 months
  - Employer (TechCorp): $154,000 (91.4%) — steady $7,000/mo since 2024-07 (raise from $5,500)
  - Freelance (various): $8,200 (4.9%) — sporadic, mostly Q4 2024
  - Investment dividends: $3,100 (1.8%) — growing quarterly
  - Cash back / refunds: $3,100 (1.8%)
  - Stability score: 85/100
  - Diversification score: 22/100

Loop 2:
  LLM calls → memory_search(query="income career goals side projects")

Results:
  - Memory: "User is a senior engineer, considering freelance consulting"

Loop 3: LLM responds + calls:
  → memory_store("Income analysis: 91% from TechCorp salary. Freelance peaked Q4 2024 at ~$800/mo. Diversification very low at 22/100.")

Response: "Over the past 27 months, you've earned $168,400:
  - **TechCorp salary: $154,000 (91%)** — your raise in Jul 2024 from $5,500 to $7,000 was a +27% bump, your single biggest income event
  - **Freelance: $8,200 (5%)** — peaked in Q4 2024 when you were doing ~$800/mo, but dropped off since
  - **Investments: $3,100 (2%)** — dividends growing each quarter

  Your income is very concentrated (diversification: 22/100). If you're still thinking about freelance consulting, reviving that Q4 pace would add ~$10k/year.
  Want me to model how that would affect your networth trajectory?"
```

### Flow 6: "At my current rate, when will I hit $500k networth?"

```
User → "At current state, when would I reach $500k?"

Loop 1 (parallel):
  LLM calls → compute_networth()
  LLM calls → compute_savings_rate(start_date="2025-09-01", end_date="2026-03-23", interval="monthly")
  LLM calls → get_investments()

Results:
  - Current networth: $142,300
  - Savings rate: $1,260/mo avg
  - Investments: $67,000 in index funds

Loop 2:
  LLM calls → compute_goal_timeline(
    goal_type="networth",
    target_amount=500000,
    assumptions={ annual_return_pct: 7 }
  )

Results:
  - At current pace: 142 months (Nov 2037) — 11.8 years
  - With market returns on investments: 108 months (Mar 2035) — 9 years
  - If savings increased 50%: 86 months (May 2033) — 7.2 years

Loop 3:
  LLM calls → project_networth(months_ahead=120, scenario="all", assumptions={ annual_investment_return_pct: 7 })

Results: Full trajectory data for chart

Loop 4: LLM responds + calls:
  → memory_store("User goal: reach $500k networth. Currently at $142k. Estimated 9 years at current pace with 7% returns.")
  → upsert_insight(type="milestone", title="$500k Goal Tracker", body="At current pace: Mar 2035. Save 50% more: May 2033.", priority="medium")

Response: "You're at **$142,300** today. To reach $500k:
  - **Current pace + 7% market returns: ~9 years (Mar 2035)**
  - Current pace without returns: ~11.8 years (Nov 2037)
  - If you boost savings 50% ($1,890/mo): ~7.2 years (May 2033)

  Your $67k in index funds is doing a lot of work — compounding shaves nearly 3 years off.
  The fastest lever is increasing your savings rate. Want me to build a plan to get there faster?"
```

### Flow 7: "How should I save and invest to reach $1M by age 40?"

No "build_financial_plan" tool. The LLM IS the planner — it gathers data, computes the gap, and reasons about the steps.

```
User → "I'm 28. How should I save and invest to reach $1M by 40?"

Loop 1 (parallel — LLM gathers all relevant data):
  LLM calls → compute_networth()
  LLM calls → compute_savings_rate(start_date="2025-09-01", end_date="2026-03-23", interval="monthly")
  LLM calls → get_investments()
  LLM calls → compute_spending_summary(start_date="2025-09-01", end_date="2026-03-23", group_by="category")
  LLM calls → analyze_income_history(start_date="2024-01-01", end_date="2026-03-23", group_by="year")
  LLM calls → get_recurring_transactions()
  LLM calls → memory_search(query="age career goals investment risk tolerance")

Results:
  - Networth: $142,300 ($67k investments, $48k checking/savings, $32k manual assets, -$5k credit)
  - Savings: $1,260/mo avg (18% rate)
  - Income: $7,000/mo salary, grew 27% over 2 years
  - Top spending: Rent $2,100, Dining $840, Shopping $620...
  - Recurring: $280/mo in subscriptions
  - Memory: "User is a senior engineer, considering freelance consulting"

  ** LLM REASONS: **
  "Gap: $1M - $142k = $858k in 12 years.
   With $67k invested at 7%, that grows to ~$151k.
   Remaining $707k needs to come from new savings+returns.
   Required monthly contribution to reach $707k in 12yr at 7%: ~$3,250/mo.
   Current savings: $1,260/mo → gap of ~$2,000/mo.
   Let me project the exact numbers and model a realistic scenario."

Loop 2 (LLM runs the math):
  LLM calls → compute_goal_timeline(goal_type="networth", target_amount=1000000,
    assumptions={ annual_return_pct: 7 })
  LLM calls → simulate_savings_plan(months=144, changes={
    spending_cuts: [{ category: "FOOD_AND_DRINK", reduction_pct: 25 }, { category: "SHOPPING", reduction_pct: 20 }],
    income_changes: [{ source: "freelance", amount: 1500 }]
  })

Results:
  - Goal timeline at current pace: 17.5 years (too slow)
  - Simulated: with $1,500/mo freelance + spending cuts → $3,400/mo savings → hits $1M in ~11.8 years

  ** LLM REASONS: **
  "Close but not quite at 11.8 years. The investment returns do heavy lifting
   in later years. With salary growth factored in (27% over 2 years), it's
   achievable. Key levers: freelance income is the biggest single lever,
   tax-advantaged accounts (401k, IRA) improve effective returns, spending
   cuts are ~$500/mo realistic."

Loop 3 (LLM runs optimistic scenario with higher savings):
  LLM calls → project_networth(months_ahead=144, scenario="all",
    assumptions={ monthly_income: 8500, monthly_spending: 5100, annual_investment_return_pct: 7 })

Loop 4: LLM SYNTHESIZES the full plan + persists:
  → memory_store("User goal: $1M by age 40 (2038). Current $142k. Needs ~$3,400/mo savings. Plan: freelance + spending cuts + 401k max.")
  → upsert_insight(type="milestone", title="$1M by 40 tracker", ...)

Response: "You're at $142k. Here's a realistic path to $1M by 40:

  **The math:** You need ~$3,400/mo in savings+investments (vs $1,260 today).
  Your existing $67k in investments compounds to ~$151k on its own. The gap is ~$2,140/mo.

  **Step 1 — Freelance consulting ($1,500/mo)**
  You've been considering this. Even 10hrs/mo at $150/hr closes most of the gap.

  **Step 2 — Max 401k ($1,917/mo pre-tax)**
  That's $23k/yr tax-advantaged. If employer matches, even better.

  **Step 3 — Cut discretionary ~$500/mo**
  Dining -25% ($210/mo), shopping -20% ($124/mo), trim subscriptions ($67/mo).

  **Step 4 — Roth IRA ($583/mo)**
  $7k/yr, tax-free growth for 12 years.

  **Result:** ~$3,400/mo invested → projected to hit $1M in ~11-12 years.
  Salary growth (you got 27% in 2 years) makes this a stretch goal, not a fantasy.

  Want me to track this as a goal and check progress each month?"
```

---

## 4. Data Model Design

KISS. Single SQLite DB. 12 tables. No entry polymorphism, no raw Plaid layer.

**Data strategy: least data needed to make decisions.**
- **Transactions:** Only last 1 year. Pruned on every sync. This is enough for spending analysis, trends, and patterns.
- **Balances:** Today's snapshot per account, persisted daily in `balance_history`. Networth trend computed from these.
- **Holdings:** Current positions only (replaced on each sync). Not historical.
- **Networth:** Daily aggregate snapshot in `networth_snapshots` — precomputed for fast dashboard.
- **Manual assets:** Just `current_balance` on the account row. Update it when the value changes.

```
~/.pfa/pfa.db          — all structured data + sessions
~/.pfa/memory/         — Mem0 FAISS vectors
```

### 4.1 Client DB (SQLite)

```sql
-- 1. Plaid connections
CREATE TABLE plaid_items (
  id              TEXT PRIMARY KEY,
  plaid_id        TEXT NOT NULL UNIQUE,
  access_token    TEXT NOT NULL,
  institution_id  TEXT,
  institution_name TEXT,
  sync_cursor     TEXT,
  status          TEXT NOT NULL DEFAULT 'active',  -- active | error | revoked
  error_code      TEXT,
  last_synced_at  TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. All accounts (Plaid + manual)
CREATE TABLE accounts (
  id              TEXT PRIMARY KEY,
  plaid_item_id   TEXT REFERENCES plaid_items(id),
  plaid_account_id TEXT UNIQUE,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL,       -- depository | credit | loan | investment | property | vehicle | crypto | other_asset | other_liability
  subtype         TEXT,                -- checking, savings, credit_card, 401k, mortgage, etc.
  classification  TEXT NOT NULL,       -- asset | liability
  currency        TEXT NOT NULL DEFAULT 'USD',
  current_balance INTEGER NOT NULL DEFAULT 0,  -- cents, updated on every sync
  available_balance INTEGER,           -- cents
  institution_name TEXT,
  mask            TEXT,
  is_active       INTEGER NOT NULL DEFAULT 1,
  source          TEXT NOT NULL,       -- plaid | manual
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_accounts_classification ON accounts(classification);
CREATE INDEX idx_accounts_active ON accounts(is_active);

-- 3. Transactions (from Plaid + manual)
CREATE TABLE transactions (
  id              TEXT PRIMARY KEY,
  account_id      TEXT NOT NULL REFERENCES accounts(id),
  plaid_id        TEXT UNIQUE,
  amount          INTEGER NOT NULL,    -- cents. positive = outflow, negative = inflow (Plaid convention)
  date            TEXT NOT NULL,       -- YYYY-MM-DD
  name            TEXT NOT NULL,       -- raw description
  merchant_name   TEXT,                -- cleaned name
  category_id     TEXT REFERENCES categories(id),
  plaid_category  TEXT,                -- Plaid's original (preserved)
  direction       TEXT NOT NULL,       -- inflow | outflow | transfer
  pending         INTEGER NOT NULL DEFAULT 0,
  note            TEXT,
  tags            TEXT,                -- JSON array
  payment_channel TEXT,                -- online | in_store | other
  source          TEXT NOT NULL DEFAULT 'plaid',
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_txn_account_date ON transactions(account_id, date DESC);
CREATE INDEX idx_txn_date ON transactions(date DESC);
CREATE INDEX idx_txn_category ON transactions(category_id);
CREATE INDEX idx_txn_direction ON transactions(direction);
CREATE INDEX idx_txn_merchant ON transactions(merchant_name);

-- 4. Categories (hierarchical)
CREATE TABLE categories (
  id              TEXT PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,  -- "food_and_drink.restaurant"
  name            TEXT NOT NULL,         -- "Restaurants"
  parent_id       TEXT REFERENCES categories(id),
  classification  TEXT NOT NULL,         -- expense | income
  color           TEXT,
  icon            TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_categories_parent ON categories(parent_id);

-- 5. Balance history (one row per account per day, for networth trends)
CREATE TABLE balance_history (
  account_id      TEXT NOT NULL REFERENCES accounts(id),
  date            TEXT NOT NULL,        -- YYYY-MM-DD
  balance         INTEGER NOT NULL,     -- cents
  PRIMARY KEY (account_id, date)
);

-- 6. Networth snapshots (one per day, precomputed aggregate)
CREATE TABLE networth_snapshots (
  date            TEXT PRIMARY KEY,     -- YYYY-MM-DD
  networth        INTEGER NOT NULL,     -- cents (assets - liabilities)
  total_assets    INTEGER NOT NULL,
  total_liabilities INTEGER NOT NULL,
  breakdown       TEXT                   -- JSON: [{ account_id, name, type, balance }]
);

-- 7. Investment holdings (current only, replaced on each sync)
CREATE TABLE holdings (
  id              TEXT PRIMARY KEY,
  account_id      TEXT NOT NULL REFERENCES accounts(id),
  security_id     TEXT NOT NULL REFERENCES securities(id),
  quantity        REAL NOT NULL,
  cost_basis      INTEGER,             -- cents
  value           INTEGER NOT NULL,    -- cents (quantity * price)
  price           INTEGER NOT NULL,    -- cents per unit
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 8. Securities reference
CREATE TABLE securities (
  id              TEXT PRIMARY KEY,
  plaid_security_id TEXT UNIQUE,
  ticker          TEXT,
  name            TEXT NOT NULL,
  type            TEXT,                -- equity, etf, mutual_fund, fixed_income, cash, crypto
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 8. Insights (agent-generated, shown on dashboard)
CREATE TABLE insights (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL,        -- tip | alert | trend | milestone
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  priority        TEXT NOT NULL DEFAULT 'medium',
  related_account_id TEXT REFERENCES accounts(id),
  expires_at      TEXT,
  is_dismissed    INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_insights_active ON insights(is_dismissed, expires_at);

-- 9. Sessions
CREATE TABLE sessions (
  id              TEXT PRIMARY KEY,
  title           TEXT,
  source          TEXT NOT NULL,        -- user_chat | plaid_webhook | scheduled | system
  status          TEXT NOT NULL DEFAULT 'active',
  message_count   INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 10. Messages
CREATE TABLE messages (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL REFERENCES sessions(id),
  role            TEXT NOT NULL,        -- user | assistant | tool | system
  content         TEXT,
  tool_calls      TEXT,                -- JSON
  tool_call_id    TEXT,
  tool_name       TEXT,
  is_error        INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_messages_session ON messages(session_id, created_at);

-- 11. Schema version
CREATE TABLE schema_version (
  version         INTEGER NOT NULL,
  applied_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**12 tables. That's it.**

Key simplifications:
- **Transactions: 1 year only.** Pruned on every sync. ~3-5k rows max.
- **No entries/valuations/trades polymorphism.** Transactions are transactions. Manual assets = `current_balance` on account row.
- **No separate plaid_accounts.** Plaid IDs on `accounts` and `transactions` directly.
- **No merchants table.** `merchant_name` string. Normalize later if needed.
- **No transfers table.** `direction = 'transfer'` flag is enough.
- **No rules table.** LLM is the categorization engine.
- **No spending_summaries.** Computed on the fly — SQLite handles it in ms on 5k rows.
- **No recurring_transactions.** Computed on the fly.
- **Holdings: current only.** Replaced on each sync, not historical.
- **`networth_snapshots`:** Daily aggregate persisted at sync time. Dashboard reads this directly.

### 4.2 Memory Store (Mem0 + FAISS)

Same as before — Mem0 with Ollama for LLM + embedder, FAISS for vectors. 5 categories: insight, preference, pattern, goal, context. Fully local at `~/.pfa/memory/`.

### 4.3 Balance & Networth

```
On every sync:
  1. Update accounts.current_balance from Plaid
  2. Insert row into balance_history (per account, per day)
  3. Compute and persist networth_snapshots (daily aggregate)

For manual accounts:
  User updates current_balance directly → row in balance_history

Networth today = networth_snapshots WHERE date = today
Networth trend = SELECT date, networth FROM networth_snapshots ORDER BY date
```

---

## 5. Implementation (Built)

### 5.1 Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (ESM) |
| Runtime | Node.js 24 + tsx |
| DB | SQLite via better-sqlite3 |
| LLM | llama.cpp (native binary, built from source with Metal) |
| Model | Jackrong/Qwen3.5-9B-Claude-4.6-Opus-Reasoning-Distilled-GGUF (Q4_K_M, 5.2 GB) |
| Bank Data | Plaid SDK |
| Client | React 18 + Vite + Tailwind CSS + shadcn/ui + Recharts + Framer Motion |
| Tests | Vitest (33 tests) |

### 5.2 Project Structure

```
pfa/
├── src/
│   ├── config/index.ts          — env vars, paths
│   ├── db/
│   │   ├── index.ts             — SQLite connection, migrate()
│   │   ├── migrate.ts           — CLI migration runner
│   │   ├── schema.sql           — 12 tables
│   │   └── seed-categories.sql  — 42 seeded categories
│   ├── plaid/
│   │   ├── client.ts            — Plaid API client
│   │   ├── link.ts              — createLinkToken(), exchangePublicToken()
│   │   ├── link-cli.ts          — CLI: npm run plaid:link
│   │   └── sync.ts              — sync(): transactions (1yr), balances, holdings, networth
│   ├── tools/
│   │   ├── registry.ts          — registerTool(), getToolDefinitions(), executeTool()
│   │   ├── index.ts             — imports all tool files
│   │   ├── bank-data.ts         — 5 tools: get_accounts, get_transactions, etc.
│   │   ├── analysis.ts          — 9 tools: spending summary, networth, trends, etc.
│   │   ├── modeling.ts          — 3 tools: projections, goal timeline, savings sim
│   │   └── write-ops.ts         — 8 tools: categorize, insights, manual assets, sync, dashboard
│   ├── agent/
│   │   ├── llm.ts               — OpenAI-compatible streaming client + <tool_call>/<think> parsing
│   │   ├── session.ts           — session CRUD + message persistence
│   │   ├── orchestrator.ts      — ReAct loop with SSE streaming events
│   │   ├── server.ts            — HTTP server (SSE streaming + JSON endpoints)
│   │   ├── cli.ts               — Interactive terminal chat
│   │   └── prompts/
│   │       ├── system.md        — Agent persona + rules (editable)
│   │       ├── webhook.md       — Plaid webhook prompt
│   │       └── scheduled-weekly.md
│   └── index.ts
├── client/                       — React UI (chat-wealth-companion based)
│   └── src/
│       ├── lib/api.ts           — SSE streaming client
│       ├── components/
│       │   ├── layout/AppLayout.tsx  — 3-panel layout, state management
│       │   ├── chat/            — ChatArea, ChatInput, AgentMessage, UserMessage, ThinkingIndicator
│       │   ├── dashboard/       — DashboardPanel, StatCard, NetWorthChart, SpendingBreakdown
│       │   └── sidebar/ChatHistory.tsx
│       └── ...
├── models/                       — GGUF model files (gitignored)
├── bin/llama-server              — native llama.cpp binary (built from source)
├── scripts/
│   ├── start-llm.sh             — start llama-server with Metal + cache reuse
│   └── start-all.sh             — start all services
├── tests/tools.test.ts           — 33 tool tests
└── .pfa/pfa.db                   — SQLite database (gitignored)
```

### 5.3 How the Agent Works

```
User sends message via client UI
  │
  ▼
POST /agent/message (SSE stream)
  │
  ▼
Orchestrator: build system prompt + inject tools + session history
  │
  ▼
LOOP (max 15 iterations):
  │
  ├─ Stream tokens from llama-server (/v1/chat/completions, stream=true)
  │    │
  │    ├─ <think> tokens → SSE event { type: "thinking", content } → client shows in grey box
  │    ├─ text tokens    → SSE event { type: "text", content }     → client shows response
  │    └─ <tool_call>    → SSE event { type: "tool_call", name }   → client shows tool badge
  │
  ├─ Parse completed response for tool calls
  │
  ├─ If tool calls found:
  │    ├─ Execute each tool (SQL query / computation)
  │    ├─ SSE event { type: "tool_result", name, result } → client updates dashboard
  │    ├─ Feed results back to LLM (truncated to 3K chars)
  │    └─ Continue loop
  │
  └─ If no tool calls:
       ├─ SSE event { type: "done", message, thinking, tool_calls_made }
       └─ Return to client
```

**Tool calling approach:** Prompt-based, not API-native.
- Tool definitions injected into system prompt as compact one-liners
- Model outputs `<tool_call>{"name":"...","arguments":{...}}</tool_call>` tags
- `<think>` reasoning blocks captured and streamed separately
- Works with any local model — no dependency on provider-specific function calling APIs

**Performance optimizations:**
- Native llama-server with `--cache-reuse 256` for KV cache reuse across iterations
- `--flash-attn on` for Metal-optimized attention
- Compact system prompt (~1.5K tokens vs original 5K)
- Tool results truncated to 3K chars before feeding back
- Transactions capped at 1 year, pruned on every sync

### 5.4 All 25 Implemented Tools

| # | Tool | File | Type | Description |
|---|------|------|------|-------------|
| | **Bank Data (read-only)** | | | |
| 1 | `get_accounts` | bank-data.ts | Query | List linked accounts with balances. Filter by type or classification. |
| 2 | `get_transactions` | bank-data.ts | Query | Search transactions by date, account, category, merchant, amount, direction. |
| 3 | `get_balances` | bank-data.ts | Query | Current balances for all or specific account. |
| 4 | `get_investments` | bank-data.ts | Query | Investment holdings with security details, quantities, values. |
| 5 | `get_recurring_transactions` | bank-data.ts | Query | Detect recurring patterns (subscriptions, bills, income) from transaction frequency. |
| | **Analysis (deterministic computation)** | | | |
| 6 | `compute_spending_summary` | analysis.ts | Aggregation | Group spending by category, merchant, week, or month for a date range. |
| 7 | `compute_income_summary` | analysis.ts | Aggregation | Group income by source, month, or account for a date range. |
| 8 | `compute_savings_rate` | analysis.ts | Arithmetic | (income - spending) / income, broken down by month or quarter. |
| 9 | `compute_networth` | analysis.ts | Arithmetic | Assets - liabilities with full account breakdown. |
| 10 | `compute_networth_trend` | analysis.ts | Aggregation | Networth over time from daily snapshots (daily/weekly/monthly). |
| 11 | `compute_spending_trend` | analysis.ts | Aggregation | Spending over time with period-over-period comparison. |
| 12 | `compute_category_deep_dive` | analysis.ts | Aggregation | Single category deep dive: merchant breakdown, day-of-week, monthly trend. |
| 13 | `analyze_income_history` | analysis.ts | Aggregation | Income by source, monthly trend, stability score. |
| 14 | `compare_periods` | analysis.ts | Arithmetic | Side-by-side comparison of two date ranges on spending, income, savings rate. |
| | **Modeling (deterministic projections)** | | | |
| 15 | `project_networth` | modeling.ts | Math | Compound interest + savings projection. Runs conservative/baseline/optimistic scenarios. |
| 16 | `compute_goal_timeline` | modeling.ts | Math | Months to reach a financial target given current savings + returns. |
| 17 | `simulate_savings_plan` | modeling.ts | Math | Compare current vs modified trajectory (spending cuts, income changes). |
| | **Write Operations** | | | |
| 18 | `update_transaction_category` | write-ops.ts | Write | Recategorize a single transaction. |
| 19 | `bulk_categorize_transactions` | write-ops.ts | Write | Batch recategorize multiple transactions. |
| 20 | `add_transaction_note` | write-ops.ts | Write | Attach a note to a transaction. |
| 21 | `upsert_insight` | write-ops.ts | Write | Create a dashboard insight (tip, alert, trend, milestone). |
| 22 | `delete_insight` | write-ops.ts | Write | Remove an insight. |
| 23 | `crud_manual_asset` | write-ops.ts | CRUD | Create/read/update/delete manual assets (property, vehicle, crypto, etc). |
| 24 | `trigger_transaction_sync` | write-ops.ts | System | Pull latest from Plaid (transactions, balances, holdings, networth). |
| 25 | `get_dashboard_data` | write-ops.ts | Read | All data for UI: networth, accounts, recent transactions, insights, trends. |

**NOT tools — LLM reasoning tasks that chain multiple tools:**
- "Where can I cut costs?" → fetches spending + recurring → reasons about cuttable items
- "How do I double my savings?" → fetches savings rate + categories + simulates → reasons about plan
- "How do I reach $1M by 40?" → fetches networth + income + projections → synthesizes multi-step plan
- "Anything unusual?" → fetches recent transactions + historical patterns → judges anomalies

### 5.5 API Endpoints

| Method | Path | Returns | Description |
|--------|------|---------|-------------|
| POST | `/agent/message` | SSE stream | Send message, get streaming events (thinking, text, tool_call, tool_result, done) |
| POST | `/agent/message/sync` | JSON | Non-streaming fallback |
| GET | `/agent/sessions` | JSON | List chat sessions |
| GET | `/agent/sessions/:id/messages` | JSON | Get session message history |
| GET | `/agent/tools` | JSON | List all tool definitions |

### 5.6 How to Run

```bash
# 1. Setup (one-time)
npm install
cd client && npm install && cd ..
python3 -m venv .venv
.venv/bin/pip install huggingface-hub
.venv/bin/hf download Jackrong/Qwen3.5-9B-Claude-4.6-Opus-Reasoning-Distilled-GGUF \
  Qwen3.5-9B.Q4_K_M.gguf --local-dir ./models

# 2. Link bank (sandbox for testing)
npm run plaid:link
npm run plaid:sync

# 3. Start (3 terminals)
./scripts/start-llm.sh              # Terminal 1: LLM server
npm run serve                        # Terminal 2: Agent API on :3120
cd client && npx vite --port 5173    # Terminal 3: Client UI on :5173

# 4. Open http://localhost:5173
```
