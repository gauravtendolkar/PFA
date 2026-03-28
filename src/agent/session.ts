import { v4 as uuid } from 'uuid';
import { getDb } from '../db/index.js';
import type { ChatMessage } from './llm.js';

export interface Session {
  id: string;
  title: string | null;
  source: string;
  status: string;
  message_count: number;
  created_at: string;
}

export function createSession(source: string = 'user_chat', title?: string): Session {
  const db = getDb();
  const id = uuid();
  db.prepare('INSERT INTO sessions (id, title, source) VALUES (?, ?, ?)').run(id, title ?? null, source);
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Session;
}

export function getSession(id: string): Session | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Session | undefined;
}

export function listSessions(limit: number = 20): Session[] {
  const db = getDb();
  return db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?').all(limit) as Session[];
}

export function saveMessage(sessionId: string, msg: ChatMessage): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO messages (id, session_id, role, content, tool_calls, tool_call_id, tool_name, is_error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    uuid(),
    sessionId,
    msg.role,
    msg.content ?? null,
    msg.tool_calls ? JSON.stringify(msg.tool_calls) : null,
    msg.tool_call_id ?? null,
    msg.name ?? null,
    0,
  );

  db.prepare("UPDATE sessions SET message_count = message_count + 1, updated_at = datetime('now') WHERE id = ?").run(sessionId);
}

export function getSessionMessages(sessionId: string): ChatMessage[] {
  const db = getDb();
  const rows = db.prepare('SELECT role, content, tool_calls, tool_call_id, tool_name FROM messages WHERE session_id = ? ORDER BY created_at').all(sessionId) as {
    role: string; content: string | null; tool_calls: string | null; tool_call_id: string | null; tool_name: string | null;
  }[];

  return rows.map(r => {
    const msg: ChatMessage = {
      role: r.role as ChatMessage['role'],
      content: r.content,
    };
    if (r.tool_calls) msg.tool_calls = JSON.parse(r.tool_calls);
    if (r.tool_call_id) msg.tool_call_id = r.tool_call_id;
    if (r.tool_name) msg.name = r.tool_name;
    return msg;
  });
}
