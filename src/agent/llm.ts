/**
 * OpenAI-compatible LLM client with streaming support.
 * Tool calling via prompt injection + <tool_call> tag parsing.
 * Thinking via <think> tag parsing.
 */
import { config } from '../config/index.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LLMTimings {
  prompt_tokens: number;
  completion_tokens: number;
  prompt_ms: number;
  completion_ms: number;
  prompt_tokens_per_sec: number;
  completion_tokens_per_sec: number;
}

export interface ChatResponse {
  message: ChatMessage;
  thinking: string | null;
  finish_reason: 'stop' | 'tool_calls' | 'length';
  timings?: LLMTimings;
}

export interface LLMConfig {
  baseUrl: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export function getDefaultLLMConfig(): LLMConfig {
  return {
    baseUrl: config.llm.baseUrl,
    model: config.llm.model,
    temperature: 0.3,
    maxTokens: 4096,
  };
}

export function formatToolsForPrompt(tools: ToolDef[]): string {
  const toolBlocks = tools.map(t => {
    const schema = t.parameters as Record<string, unknown>;
    const props = (schema.properties || {}) as Record<string, Record<string, unknown>>;
    const required = (schema.required || []) as string[];

    const paramLines = Object.entries(props).map(([name, prop]) => {
      const parts: string[] = [`    "${name}"`];
      if (prop.type) parts.push(`(${prop.type})`);
      if (prop.enum) parts.push(`[${(prop.enum as string[]).join(' | ')}]`);
      const req = required.includes(name) ? 'REQUIRED' : 'optional';
      parts.push(`— ${req}.`);
      if (prop.description) parts.push(prop.description as string);
      return parts.join(' ');
    });

    const paramBlock = paramLines.length > 0
      ? `  Parameters:\n${paramLines.join('\n')}`
      : '  Parameters: none';

    return `### ${t.name}\n${t.description}\n${paramBlock}`;
  }).join('\n\n');

  return `\n\n## Tools

To call a tool, output exactly:
<tool_call>{"name":"tool_name","arguments":{"param":"value"}}</tool_call>

IMPORTANT:
- "arguments" must be an object with the parameter names as keys.
- Always provide all REQUIRED parameters.
- Dates must be YYYY-MM-DD strings.

${toolBlocks}`;
}

/** Parse <tool_call> and <think> blocks from completed text */
export function parseCompleted(text: string): { toolCalls: ToolCall[]; cleanText: string; thinking: string | null } {
  const toolCalls: ToolCall[] = [];
  let cleanText = text;

  const thinkMatches: string[] = [];
  cleanText.replace(/<think>([\s\S]*?)<\/think>/g, (_, content) => {
    thinkMatches.push(content.trim());
    return '';
  });
  const thinking = thinkMatches.length > 0 ? thinkMatches.join('\n\n') : null;

  const regex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  let match;
  let idx = 0;
  while ((match = regex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      toolCalls.push({
        id: `call_${Date.now()}_${idx++}`,
        type: 'function',
        function: { name: parsed.name, arguments: JSON.stringify(parsed.arguments || {}) },
      });
    } catch { /* skip */ }
  }

  cleanText = cleanText.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').trim();
  cleanText = cleanText.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
  cleanText = cleanText.replace(/<\/?think>/g, '').trim();

  return { toolCalls, cleanText, thinking };
}

export interface StreamCallbacks {
  onThinking?: (chunk: string) => void;
  onText?: (chunk: string) => void;
  onToolCall?: (name: string) => void;
}

/**
 * Streaming chat completion. Parses <think> and <tool_call> tags
 * from the SSE stream and routes tokens to callbacks in real-time.
 */
export async function chatCompletionStream(
  messages: ChatMessage[],
  callbacks: StreamCallbacks,
  llmConfig?: Partial<LLMConfig>,
): Promise<ChatResponse> {
  const cfg = { ...getDefaultLLMConfig(), ...llmConfig };

  const apiMessages = messages.map(m => {
    if (m.role === 'tool') {
      return { role: 'user' as const, content: `<tool_result name="${m.name}">\n${m.content}\n</tool_result>` };
    }
    return { role: m.role, content: m.content || '' };
  });

  console.log('[LLM] Sending streaming request to', cfg.baseUrl);

  const requestStartTime = performance.now();

  const res = await fetch(`${cfg.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: cfg.model,
      messages: apiMessages,
      temperature: cfg.temperature,
      max_tokens: cfg.maxTokens,
      stream: true,
      stop: ['</tool_call>\n\n<tool_call>', '<tool_result>'],
      cache_prompt: true,  // llama-server: reuse KV cache for matching prompt prefix
    }),
    signal: AbortSignal.timeout(5 * 60 * 1000),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error('[LLM] Request failed:', res.status, text);
    throw new Error(`LLM request failed (${res.status}): ${text}`);
  }

  console.log('[LLM] Stream started');

  const body = res.body;
  if (!body) throw new Error('Response body is null');

  const firstTokenTime = { value: 0 };
  let fullText = '';
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = '';
  let tokenCount = 0;
  let lastChunkTimings: any = null;

  let fullThinking = '';
  let inToolCall = false;
  let tagBuffer = '';
  const emittedToolCalls = new Set<string>();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    sseBuffer += decoder.decode(value, { stream: true });
    const lines = sseBuffer.split('\n');
    sseBuffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;
      if (!data) continue;

      try {
        const chunk = JSON.parse(data);
        if (chunk.error) {
          console.error('[LLM] Stream error:', JSON.stringify(chunk.error));
          throw new Error(chunk.error.message || JSON.stringify(chunk.error));
        }

        // Capture timings from the chunk (llama-server includes these)
        if (chunk.timings) lastChunkTimings = chunk.timings;
        if (chunk.usage) lastChunkTimings = { ...lastChunkTimings, ...chunk.usage };

        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        // llama-server puts <think> content in reasoning_content for Qwen3 models
        const reasoning = delta.reasoning_content;
        if (reasoning) {
          tokenCount++;
          if (tokenCount === 1) firstTokenTime.value = performance.now();
          fullThinking += reasoning;
          callbacks.onThinking?.(reasoning);
          continue;
        }

        const content = delta.content;
        if (!content) continue;

        fullText += content;
        tokenCount++;
        if (tokenCount === 1) firstTokenTime.value = performance.now();

        // Route content: detect <tool_call> tags
        tagBuffer += content;

        if (tagBuffer.includes('<tool_call>')) {
          inToolCall = true;
          tagBuffer = '';
          continue;
        }
        if (tagBuffer.includes('</tool_call>')) {
          inToolCall = false;
          tagBuffer = '';
          continue;
        }

        // Buffer partial tags
        if (tagBuffer.includes('<')) continue;

        if (inToolCall) {
          const nameMatch = fullText.match(/<tool_call>[^]*?"name"\s*:\s*"([^"]+)"/);
          if (nameMatch && !emittedToolCalls.has(nameMatch[1])) {
            emittedToolCalls.add(nameMatch[1]);
            callbacks.onToolCall?.(nameMatch[1]);
          }
        } else {
          callbacks.onText?.(tagBuffer);
        }
        tagBuffer = '';

      } catch (parseErr) {
        if (parseErr instanceof Error && parseErr.message.includes('LLM stream error')) throw parseErr;
        console.error('[LLM] SSE parse error:', data.slice(0, 200));
      }
    }
  }

  const requestEndTime = performance.now();
  const totalMs = requestEndTime - requestStartTime;
  const ttft = firstTokenTime.value ? firstTokenTime.value - requestStartTime : totalMs;

  if (tokenCount === 0) {
    console.error('[LLM] WARNING: Zero tokens. Buffer:', sseBuffer.slice(0, 300));
  }

  // Extract server-side timings
  const cacheN = lastChunkTimings?.cache_n ?? 0;
  const promptN = lastChunkTimings?.prompt_n ?? 0;
  const predictedN = lastChunkTimings?.predicted_n ?? 0;
  const promptMs = lastChunkTimings?.prompt_ms ?? 0;
  const predictedMs = lastChunkTimings?.predicted_ms ?? 0;
  const promptTps = lastChunkTimings?.prompt_per_second ?? 0;
  const predictedTps = lastChunkTimings?.predicted_per_second ?? 0;
  const totalPromptTokens = cacheN + promptN;

  console.log(`[LLM] Stream done: ${tokenCount} SSE chunks, ${predictedN} server tokens, total=${totalMs.toFixed(0)}ms, TTFT=${ttft.toFixed(0)}ms`);

  // KV cache analysis using server's cache_n field
  if (totalPromptTokens > 0) {
    const cacheHitPct = ((cacheN / totalPromptTokens) * 100).toFixed(1);
    if (cacheN > 0) {
      console.log(`[LLM] KV CACHE HIT: ${cacheN}/${totalPromptTokens} tokens cached (${cacheHitPct}%), only ${promptN} new tokens processed`);
    } else {
      console.log(`[LLM] KV CACHE MISS: 0/${totalPromptTokens} tokens cached — full prompt processing`);
    }
  }

  // Prompt vs completion breakdown
  console.log(`[LLM] Prompt: ${promptN} new tokens in ${promptMs.toFixed(0)}ms (${promptTps.toFixed(1)} t/s)`);
  console.log(`[LLM] Completion: ${predictedN} tokens in ${predictedMs.toFixed(0)}ms (${predictedTps.toFixed(1)} t/s)`);

  const { toolCalls, cleanText, thinking: inlineThinking } = parseCompleted(fullText);
  // Prefer reasoning_content from SSE (separate field), fall back to inline <think> tags
  const thinking = fullThinking || inlineThinking;
  console.log('[LLM] Parsed: %d tool calls, %d chars text, %d chars thinking (reasoning_content=%d, inline=%d)',
    toolCalls.length, cleanText.length, thinking?.length ?? 0, fullThinking.length, inlineThinking?.length ?? 0);

  const timings: LLMTimings = {
    prompt_tokens: promptN,
    completion_tokens: predictedN,
    prompt_ms: promptMs,
    completion_ms: predictedMs,
    prompt_tokens_per_sec: promptTps,
    completion_tokens_per_sec: predictedTps,
  };

  const message: ChatMessage = { role: 'assistant', content: cleanText || null };
  if (toolCalls.length > 0) message.tool_calls = toolCalls;

  return {
    message,
    thinking,
    finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
    timings,
  };
}

/** Non-streaming version */
export async function chatCompletion(
  messages: ChatMessage[],
  llmConfig?: Partial<LLMConfig>,
): Promise<ChatResponse> {
  return chatCompletionStream(messages, {}, llmConfig);
}
