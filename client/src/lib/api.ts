export interface ToolCallResult {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result: unknown;
}

export interface AgentDoneEvent {
  session_id: string;
  message: string;
  thinking: string | null;
  tool_calls_made: ToolCallResult[];
  iterations: number;
}

export type StreamEvent =
  | { type: 'thinking'; content: string }
  | { type: 'text'; content: string }
  | { type: 'tool_call'; name: string }
  | { type: 'tool_result'; name: string; result: unknown }
  | { type: 'done' } & AgentDoneEvent
  | { type: 'error'; message: string };

export type ActivityItem =
  | { kind: 'thinking'; content: string }
  | { kind: 'tool_call'; name: string }
  | { kind: 'tool_result'; name: string; result: unknown }
  | { kind: 'text'; content: string };

export interface StreamCallbacks {
  onActivity: (item: ActivityItem) => void;
  onStatusChange: (status: string) => void;
  /** Streaming final response text — show in chat with cursor */
  onStreamText: (fullTextSoFar: string) => void;
  onDone: (event: AgentDoneEvent) => void;
  onError: (message: string) => void;
}

export async function sendMessageStream(
  message: string,
  callbacks: StreamCallbacks,
  sessionId?: string,
): Promise<void> {
  const res = await fetch('/agent/message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, session_id: sessionId }),
  });

  if (!res.ok) {
    callbacks.onError(`Agent error (${res.status}): ${await res.text()}`);
    return;
  }
  if (!res.body) { callbacks.onError('No response body'); return; }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  let thinkingAccum = '';
  let textAccum = '';
  const seenToolCalls = new Set<string>();

  // Track whether we've seen a tool_call in this iteration.
  // If text is followed by tool_call → it's intermediate text (goes to activity).
  // If text is followed by done → it's final response (goes to chat stream).
  // We can't know until the next event, so we buffer and decide on transition.
  let pendingTextIsIntermediate = false;

  function flushThinking() {
    if (thinkingAccum) {
      callbacks.onActivity({ kind: 'thinking', content: thinkingAccum });
      thinkingAccum = '';
    }
  }

  /** Flush buffered text as intermediate activity (NOT final response) */
  function flushTextAsActivity() {
    if (textAccum) {
      callbacks.onActivity({ kind: 'text', content: textAccum });
      textAccum = '';
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') return;

      try {
        const event = JSON.parse(data) as StreamEvent;

        switch (event.type) {
          case 'thinking':
            // If we had pending text and now we're thinking again → it was intermediate
            if (textAccum) flushTextAsActivity();
            thinkingAccum += event.content;
            callbacks.onStatusChange('Thinking...');
            pendingTextIsIntermediate = false;
            break;

          case 'text':
            flushThinking();
            textAccum += event.content;
            // Optimistically stream to chat — if a tool_call follows, we'll move it to activity
            callbacks.onStreamText(textAccum);
            callbacks.onStatusChange('Responding...');
            break;

          case 'tool_call':
            if (seenToolCalls.has(event.name)) break;
            seenToolCalls.add(event.name);
            flushThinking();
            // Text before a tool_call is intermediate — move to activity, clear from chat
            if (textAccum) {
              flushTextAsActivity();
              callbacks.onStreamText(''); // clear chat streaming
            }
            callbacks.onStatusChange(`Calling ${event.name}...`);
            callbacks.onActivity({ kind: 'tool_call', name: event.name });
            pendingTextIsIntermediate = true;
            break;

          case 'tool_result':
            callbacks.onActivity({ kind: 'tool_result', name: event.name, result: event.result });
            seenToolCalls.clear();
            callbacks.onStatusChange('Thinking...');
            pendingTextIsIntermediate = false;
            break;

          case 'done':
            flushThinking();
            // Don't flush remaining text to activity — it's the final response
            // (it's already being streamed to chat via onStreamText)
            textAccum = '';
            callbacks.onDone(event as unknown as AgentDoneEvent);
            break;

          case 'error':
            callbacks.onError(event.message);
            break;
        }
      } catch { /* skip malformed */ }
    }
  }
}

export interface Session {
  id: string;
  title: string | null;
  source: string;
  status: string;
  message_count: number;
  created_at: string;
  updated_at: string;
}

export async function getSessions(): Promise<Session[]> {
  const res = await fetch('/agent/sessions');
  return res.json();
}
