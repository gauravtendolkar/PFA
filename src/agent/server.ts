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
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

    json(res, { error: 'Not found' }, 404);
  } catch (err: any) {
    console.error('Request error:', err);
    json(res, { error: err.message }, 500);
  }
});

migrate();
server.timeout = 10 * 60 * 1000;
server.listen(PORT, () => {
  console.log(`PFA agent server running on http://localhost:${PORT}`);
  console.log('  POST /agent/message      — SSE streaming');
  console.log('  POST /agent/message/sync — JSON (non-streaming)');
  console.log('  GET  /agent/sessions     — list sessions');
  console.log('  GET  /agent/tools        — list available tools');
});
