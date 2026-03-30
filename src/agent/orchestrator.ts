/**
 * Agent Orchestrator — the core ReAct loop with streaming support.
 * Uses an event queue to bridge LLM streaming callbacks with the async generator.
 */
import fs from 'fs';
import path from 'path';
import { chatCompletionStream, formatToolsForPrompt, type ChatMessage, type LLMConfig, type ChatResponse } from './llm.js';
import { getToolDefinitions, executeTool } from '../tools/index.js';
import { createSession, getSession, saveMessage, getSessionMessages, type Session } from './session.js';

const MAX_ITERATIONS = 15;

export interface AgentRequest {
  message: string;
  session_id?: string;
  source?: 'user_chat' | 'plaid_webhook' | 'scheduled' | 'system';
  llm_config?: Partial<LLMConfig>;
}

export interface ToolCallResult {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result: unknown;
}

export type StreamEvent =
  | { type: 'thinking'; content: string }
  | { type: 'text'; content: string }
  | { type: 'tool_call'; name: string }
  | { type: 'tool_result'; name: string; result: unknown }
  | { type: 'done'; session_id: string; message: string; thinking: string | null; tool_calls_made: ToolCallResult[]; iterations: number }
  | { type: 'error'; message: string };

let cachedPromptBase: string | null = null;

function loadPrompt(name: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, 'prompts', `${name}.md`), 'utf-8');
}

function buildSystemPrompt(): string {
  if (!cachedPromptBase) {
    cachedPromptBase = loadPrompt('system');
    const tools = getToolDefinitions().map(t => ({
      name: t.name, description: t.description,
      parameters: { type: 'object' as const, properties: t.parameters.properties, ...(t.parameters.required ? { required: t.parameters.required } : {}) },
    }));
    cachedPromptBase += formatToolsForPrompt(tools);
  }
  const today = new Date().toISOString().split('T')[0];
  return cachedPromptBase.replace('{{TODAY}}', today);
}

/**
 * Event queue that lets LLM callbacks push events while the generator yields them.
 */
class EventQueue {
  private queue: StreamEvent[] = [];
  private resolve: (() => void) | null = null;
  private closed = false;

  push(event: StreamEvent) {
    this.queue.push(event);
    if (this.resolve) { this.resolve(); this.resolve = null; }
  }

  close() {
    this.closed = true;
    if (this.resolve) { this.resolve(); this.resolve = null; }
  }

  async *drain(): AsyncGenerator<StreamEvent> {
    while (true) {
      while (this.queue.length > 0) {
        yield this.queue.shift()!;
      }
      if (this.closed) return;
      await new Promise<void>(r => { this.resolve = r; });
    }
  }
}

/** Streaming agent — yields events in real-time as LLM generates tokens */
export async function* runAgentStream(request: AgentRequest): AsyncGenerator<StreamEvent> {
  console.log('[Agent] Starting for:', request.message.slice(0, 80));

  let session: Session;
  try {
    session = request.session_id
      ? (getSession(request.session_id) ?? (() => { throw new Error(`Session not found: ${request.session_id}`); })())
      : createSession(request.source ?? 'user_chat');
  } catch (err: any) {
    yield { type: 'error', message: err.message };
    return;
  }

  const systemPrompt = buildSystemPrompt();
  const history = getSessionMessages(session.id);
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: request.message },
  ];
  saveMessage(session.id, { role: 'user', content: request.message });

  const toolCallsMade: ToolCallResult[] = [];
  const thinkingParts: string[] = [];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const iterStart = performance.now();
    const promptTokenEstimate = messages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0) / 4; // rough estimate
    console.log(`[Agent] ── Iteration ${i + 1}/${MAX_ITERATIONS} ── (est. ~${Math.round(promptTokenEstimate)} prompt tokens, ${messages.length} messages)`);

    // Use event queue to bridge callbacks → generator
    const eq = new EventQueue();
    let llmDone = false;
    let llmResponse: ChatResponse | null = null;
    let llmError: Error | null = null;

    // Start LLM call in background — callbacks push to event queue
    const llmPromise = chatCompletionStream(messages, {
      onThinking(chunk) {
        eq.push({ type: 'thinking', content: chunk });
      },
      onText(chunk) {
        eq.push({ type: 'text', content: chunk });
      },
      onToolCall(name) {
        eq.push({ type: 'tool_call', name });
      },
    }, request.llm_config).then(r => {
      llmResponse = r;
      llmDone = true;
      eq.close();
    }).catch(err => {
      llmError = err;
      llmDone = true;
      eq.push({ type: 'error', message: err.message });
      eq.close();
    });

    for await (const event of eq.drain()) {
      if (event.type === 'text' && !event.content) continue; // skip empty signals
      yield event;
    }

    // Wait for LLM to fully finish
    await llmPromise;

    if (llmError) {
      yield { type: 'error', message: (llmError as Error).message };
      return;
    }

    const response = llmResponse!;
    if (response.thinking) thinkingParts.push(response.thinking);

    const assistantMsg = response.message;
    messages.push(assistantMsg);
    saveMessage(session.id, assistantMsg, response.thinking);

    const iterEnd = performance.now();
    const iterMs = iterEnd - iterStart;
    console.log(`[Agent] ── Iteration ${i + 1} complete ── ${iterMs.toFixed(0)}ms wall time`);
    console.log(`[Agent]   finish_reason=${response.finish_reason}, tool_calls=${assistantMsg.tool_calls?.length ?? 0}, text=${(assistantMsg.content?.length ?? 0)} chars`);

    // No tool calls — done
    if (response.finish_reason !== 'tool_calls' || !assistantMsg.tool_calls?.length) {
      yield {
        type: 'done',
        session_id: session.id,
        message: assistantMsg.content ?? '',
        thinking: thinkingParts.length > 0 ? thinkingParts.join('\n\n') : null,
        tool_calls_made: toolCallsMade,
        iterations: i + 1,
      };
      return;
    }

    // Execute tool calls
    for (const toolCall of assistantMsg.tool_calls) {
      const toolName = toolCall.function.name;
      console.log(`[Agent] Executing tool: ${toolName}`);
      yield { type: 'tool_call', name: toolName };

      let args: Record<string, unknown> = {};
      let result: unknown;
      try {
        args = JSON.parse(toolCall.function.arguments);
        result = await executeTool(toolName, args);
      } catch (err: any) {
        result = { error: err.message };
      }

      toolCallsMade.push({ id: toolCall.id, name: toolName, args, result });
      yield { type: 'tool_result', name: toolName, result };

      let resultStr = JSON.stringify(result);
      const MAX_RESULT_CHARS = 3000;
      if (resultStr.length > MAX_RESULT_CHARS) {
        console.log(`[Agent] Tool ${toolName}: truncating ${resultStr.length} → ${MAX_RESULT_CHARS} chars`);
        resultStr = resultStr.slice(0, MAX_RESULT_CHARS) + '... (truncated)';
      }
      console.log(`[Agent] Tool ${toolName} done`);

      messages.push({ role: 'tool', content: resultStr, tool_call_id: toolCall.id, name: toolName });
      saveMessage(session.id, { role: 'tool', content: resultStr, tool_call_id: toolCall.id, name: toolName });
    }
  }

  yield {
    type: 'done',
    session_id: session.id,
    message: 'I reached the maximum number of steps.',
    thinking: thinkingParts.length > 0 ? thinkingParts.join('\n\n') : null,
    tool_calls_made: toolCallsMade,
    iterations: MAX_ITERATIONS,
  };
}

/** Non-streaming version */
export async function runAgent(request: AgentRequest) {
  let result: StreamEvent | undefined;
  for await (const event of runAgentStream(request)) {
    if (event.type === 'done' || event.type === 'error') result = event;
  }
  if (result?.type === 'done') return result;
  if (result?.type === 'error') throw new Error(result.message);
  throw new Error('Agent finished without a result');
}
