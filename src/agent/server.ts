/**
 * HTTP server exposing the agent via a standard API.
 *
 * POST /agent/message        — send a message, get SSE stream back
 * POST /agent/message/sync   — send a message, get JSON response (non-streaming)
 * GET  /agent/sessions       — list sessions
 * GET  /agent/sessions/:id/messages — get session messages
 * GET  /agent/tools          — list available tools
 */
import http from 'http';
import { migrate } from '../db/index.js';
import { runAgentStream, runAgent, type AgentRequest } from './orchestrator.js';
import { listSessions, getSessionMessages } from './session.js';
import { getToolDefinitions } from '../tools/index.js';
import { detectCurrentModel, cleanup } from './model-manager.js';

const PORT = parseInt(process.env.PFA_PORT || '3120', 10);

function json(res: http.ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  try {
    // POST /agent/message — SSE streaming
    if (req.method === 'POST' && url.pathname === '/agent/message') {
      let body: AgentRequest;
      try { body = JSON.parse(await readBody(req)); } catch { return json(res, { error: 'Invalid JSON' }, 400); }
      if (!body.message) return json(res, { error: 'message is required' }, 400);

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });

      let eventCount = 0;
      for await (const event of runAgentStream(body)) {
        const payload = JSON.stringify(event);
        res.write(`data: ${payload}\n\n`);
        eventCount++;
        if (event.type === 'thinking') {
          process.stdout.write('T');
        } else if (event.type === 'text') {
          process.stdout.write('.');
        } else {
          console.log(`\n[SSE] ${event.type}:`, event.type === 'tool_call' ? (event as any).name : event.type === 'done' ? 'done' : '');
        }
      }
      console.log(`\n[SSE] Stream complete: ${eventCount} events`);

      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    // POST /agent/message/sync — JSON response (non-streaming fallback)
    if (req.method === 'POST' && url.pathname === '/agent/message/sync') {
      let body: AgentRequest;
      try { body = JSON.parse(await readBody(req)); } catch { return json(res, { error: 'Invalid JSON' }, 400); }
      if (!body.message) return json(res, { error: 'message is required' }, 400);
      const result = await runAgent(body);
      return json(res, result);
    }

    // GET /agent/sessions
    if (req.method === 'GET' && url.pathname === '/agent/sessions') {
      return json(res, listSessions());
    }

    // GET /agent/sessions/:id/messages
    const sessionMatch = url.pathname.match(/^\/agent\/sessions\/([^/]+)\/messages$/);
    if (req.method === 'GET' && sessionMatch) {
      return json(res, getSessionMessages(sessionMatch[1]));
    }

    // GET /agent/tools
    if (req.method === 'GET' && url.pathname === '/agent/tools') {
      return json(res, getToolDefinitions());
    }

    // GET /simplefin/connections — list all SimpleFIN connections
    if (req.method === 'GET' && url.pathname === '/simplefin/connections') {
      const db = (await import('../db/index.js')).getDb();
      const items = db.prepare(`
        SELECT i.id, i.institution_name, i.status, i.last_synced_at, i.created_at,
          (SELECT COUNT(*) FROM accounts WHERE simplefin_item_id = i.id AND is_active = 1) as account_count
        FROM simplefin_items i ORDER BY i.created_at DESC
      `).all();
      return json(res, items);
    }

    // DELETE /simplefin/connections/:id — delete a connection and its data
    const connDeleteMatch = url.pathname.match(/^\/simplefin\/connections\/([^/]+)$/);
    if (req.method === 'DELETE' && connDeleteMatch) {
      const db = (await import('../db/index.js')).getDb();
      const itemId = connDeleteMatch[1];
      db.transaction(() => {
        // Get account IDs for this connection
        const accounts = db.prepare('SELECT id FROM accounts WHERE simplefin_item_id = ?').all(itemId) as { id: string }[];
        for (const acct of accounts) {
          db.prepare('DELETE FROM transactions WHERE account_id = ?').run(acct.id);
          db.prepare('DELETE FROM balance_history WHERE account_id = ?').run(acct.id);
          db.prepare('DELETE FROM holdings WHERE account_id = ?').run(acct.id);
        }
        db.prepare('DELETE FROM accounts WHERE simplefin_item_id = ?').run(itemId);
        db.prepare('DELETE FROM simplefin_items WHERE id = ?').run(itemId);
      })();
      return json(res, { success: true });
    }

    // DELETE /agent/sessions/:id — delete a session and its messages
    const sessionDeleteMatch = url.pathname.match(/^\/agent\/sessions\/([^/]+)$/);
    if (req.method === 'DELETE' && sessionDeleteMatch) {
      const db = (await import('../db/index.js')).getDb();
      const sid = sessionDeleteMatch[1];
      db.transaction(() => {
        db.prepare('DELETE FROM messages WHERE session_id = ?').run(sid);
        db.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
      })();
      return json(res, { success: true });
    }

    // GET /settings/prompt — get current system prompt
    if (req.method === 'GET' && url.pathname === '/settings/prompt') {
      const fs = await import('fs');
      const path = await import('path');
      const promptPath = path.join(import.meta.dirname, 'prompts', 'system.md');
      const content = fs.readFileSync(promptPath, 'utf-8');
      return json(res, { content, tags: ['{{TODAY}}'] });
    }

    // PUT /settings/prompt — update system prompt
    if (req.method === 'PUT' && url.pathname === '/settings/prompt') {
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { return json(res, { error: 'Invalid JSON' }, 400); }
      if (typeof body.content !== 'string') return json(res, { error: 'content is required' }, 400);
      const fs = await import('fs');
      const path = await import('path');
      const promptPath = path.join(import.meta.dirname, 'prompts', 'system.md');
      fs.writeFileSync(promptPath, body.content);
      return json(res, { success: true });
    }

    // POST /simplefin/claim — claim a SimpleFIN setup token
    if (req.method === 'POST' && url.pathname === '/simplefin/claim') {
      const { claimAndSave } = await import('../simplefin/link.js');
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { return json(res, { error: 'Invalid JSON' }, 400); }
      if (!body.setup_token) return json(res, { error: 'setup_token is required' }, 400);
      const itemId = await claimAndSave(body.setup_token);
      return json(res, { item_id: itemId });
    }

    // POST /simplefin/sync — trigger a SimpleFIN sync
    if (req.method === 'POST' && url.pathname === '/simplefin/sync') {
      const { sync } = await import('../simplefin/sync.js');
      let body: Record<string, unknown> = {};
      try { body = JSON.parse(await readBody(req)); } catch { /* no body is fine */ }
      const results = await sync(body.item_id as string | undefined);
      return json(res, results);
    }

    json(res, { error: 'Not found' }, 404);
  } catch (err: any) {
    console.error('Request error:', err);
    json(res, { error: err.message }, 500);
  }
});

migrate();
detectCurrentModel();
server.timeout = 10 * 60 * 1000;

process.on('SIGTERM', () => { cleanup(); process.exit(0); });
process.on('SIGINT', () => { cleanup(); process.exit(0); });
server.listen(PORT, () => {
  console.log(`PFA agent server running on http://localhost:${PORT}`);
  console.log('  POST /agent/message      — SSE streaming');
  console.log('  POST /agent/message/sync — JSON (non-streaming)');
  console.log('  GET  /agent/sessions     — list sessions');
  console.log('  GET  /agent/tools        — list available tools');
});
