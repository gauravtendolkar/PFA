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

export interface ChatResponse {
  message: ChatMessage;
  thinking: string | null;
  finish_reason: 'stop' | 'tool_calls' | 'length';
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
  // Compact format: one line per tool to minimize tokens
  const toolLines = tools.map(t => {
    const requiredParams = t.parameters && typeof t.parameters === 'object' && 'properties' in t.parameters
      ? Object.keys((t.parameters as any).properties || {}).join(', ')
      : '';
    return `- ${t.name}(${requiredParams}): ${t.description}`;
  }).join('\n');

  return `\n\n## Tools

Call tools with <tool_call>{"name":"tool_name","arguments":{...}}</tool_call>

${toolLines}`;
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

  let fullText = '';
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = '';
  let tokenCount = 0;

  // Incremental tag state — O(1) per token instead of O(N) regex rescans
  let inThink = false;
  let inToolCall = false;
  let tagBuffer = '';
  const emittedToolCalls = new Set<string>(); // prevent duplicate onToolCall emissions

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

        const delta = chunk.choices?.[0]?.delta?.content;
        if (!delta) continue;

        fullText += delta;
        tokenCount++;

        // Route tokens using incremental state machine
        tagBuffer += delta;

        // Check if tagBuffer completes a tag
        if (tagBuffer.includes('<think>')) {
          inThink = true;
          tagBuffer = tagBuffer.split('<think>').pop() || '';
          if (tagBuffer) callbacks.onThinking?.(tagBuffer);
          tagBuffer = '';
          continue;
        }
        if (tagBuffer.includes('</think>')) {
          const before = tagBuffer.split('</think>')[0];
          if (before && inThink) callbacks.onThinking?.(before);
          inThink = false;
          tagBuffer = tagBuffer.split('</think>').pop() || '';
          continue;
        }
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

        // If inside a partial tag (starts with '<'), buffer it
        if (tagBuffer.includes('<')) continue;

        // Emit buffered content
        if (inThink) {
          callbacks.onThinking?.(tagBuffer);
        } else if (inToolCall) {
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

  console.log(`[LLM] Stream done: ${tokenCount} tokens`);
  if (tokenCount === 0) {
    console.error('[LLM] WARNING: Zero tokens. Buffer:', sseBuffer.slice(0, 300));
  }

  const { toolCalls, cleanText, thinking } = parseCompleted(fullText);
  console.log('[LLM] Parsed: %d tool calls, %d chars text, %d chars thinking',
    toolCalls.length, cleanText.length, thinking?.length ?? 0);

  const message: ChatMessage = { role: 'assistant', content: cleanText || null };
  if (toolCalls.length > 0) message.tool_calls = toolCalls;

  return {
    message,
    thinking,
    finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
  };
}

/** Non-streaming version */
export async function chatCompletion(
  messages: ChatMessage[],
  llmConfig?: Partial<LLMConfig>,
): Promise<ChatResponse> {
  return chatCompletionStream(messages, {}, llmConfig);
}
