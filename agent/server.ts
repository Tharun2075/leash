// Leash demo console server: serves ui/index.html, streams flow events over SSE, takes the human's decisions.
// Node built-ins only. Security (the approval endpoint moves money in a live setup):
//  - binds to 127.0.0.1 only
//  - every request: Host must be 127.0.0.1:PORT or localhost:PORT (blocks DNS rebinding)
//  - POST: Origin must be http://127.0.0.1:PORT or http://localhost:PORT, header X-Leash-Token must equal
//    the random per-process token embedded in the served page, JSON body only (no query params), body <= 4 KB
//  - GET /events: token as ?token= (EventSource cannot set headers)
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { SCENARIOS, runScenario } from './scenarios.ts';
import type { ScenarioName } from './scenarios.ts';
import type { FlowEvent, HumanGate } from './flow.ts';

export const MAX_BODY = 4096;
const UI = fileURLToPath(new URL('../ui/index.html', import.meta.url));

export interface LeashServer { server: Server; port: number; token: string; close(): Promise<void> }

class HttpError extends Error {
  status: number;
  constructor(status: number, msg: string) { super(msg); this.status = status; }
}

function tokenOk(given: unknown, token: string): boolean {
  if (typeof given !== 'string' || given.length !== token.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(token));
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) return reject(new HttpError(415, 'JSON body required'));
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > MAX_BODY) return reject(new HttpError(413, 'body too large'));
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, 'body too large')); req.removeAllListeners('data'); req.resume(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
        resolve(v);
      } catch { reject(new HttpError(400, 'invalid JSON')); }
    });
    req.on('error', reject);
  });
}

export function startServer(port = 0, opts: { token?: string } = {}): Promise<LeashServer> {
  const token = opts.token ?? randomBytes(32).toString('hex');
  const clients = new Set<ServerResponse>();
  const waiting = new Map<string, (ok: boolean) => void>();
  let running = false;
  let bound = 0;

  const broadcast = (e: FlowEvent) => {
    const line = `data: ${JSON.stringify(e)}\n\n`;
    for (const c of clients) c.write(line);
  };
  const human: HumanGate = { decide: (step) => new Promise((resolve) => { waiting.set(step, resolve); }) };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const hosts = [`127.0.0.1:${bound}`, `localhost:${bound}`];
    if (!hosts.includes(req.headers.host ?? '')) throw new HttpError(403, 'bad Host');
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${bound}`);

    if (req.method === 'GET') {
      if (url.pathname === '/' || url.pathname === '/index.html') {
        const html = readFileSync(UI, 'utf8').replace('__LEASH_TOKEN__', token);
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY',
          'content-security-policy': "frame-ancestors 'none'",
        });
        return res.end(html);
      }
      if (url.pathname === '/scenarios') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(SCENARIOS));
      }
      if (url.pathname === '/events') {
        if (!tokenOk(url.searchParams.get('token'), token)) throw new HttpError(403, 'bad token');
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        res.write(': connected\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      throw new HttpError(404, 'not found');
    }

    if (req.method !== 'POST') throw new HttpError(405, 'method not allowed');
    const origins = hosts.map((h) => `http://${h}`);
    if (!origins.includes(req.headers.origin ?? '')) throw new HttpError(403, 'bad Origin');
    if (!tokenOk(req.headers['x-leash-token'], token)) throw new HttpError(403, 'bad token');
    if (url.search) throw new HttpError(400, 'query parameters are not accepted; send a JSON body');
    const body = await readJson(req);

    if (url.pathname === '/run') {
      const name = body.scenario as ScenarioName;
      if (!SCENARIOS.some((s) => s.name === name)) throw new HttpError(400, 'unknown scenario');
      if (running) throw new HttpError(409, 'a scenario is running');
      running = true;
      runScenario(name, broadcast, human)
        .catch((err) => { broadcast({ type: 'log', level: 'error', text: String((err as Error).message) }); broadcast({ type: 'done', outcome: 'handoff' }); })
        .finally(() => { running = false; for (const [, r] of waiting) r(false); waiting.clear(); });
      res.writeHead(202); return res.end('started');
    }
    if (url.pathname === '/decision') {
      const step = body.step;
      const answer = body.answer;
      if ((step !== 'sign' && step !== 'submit') || (answer !== 'approve' && answer !== 'refuse')) throw new HttpError(400, 'step must be sign|submit, answer approve|refuse');
      const r = waiting.get(step);
      if (!r) throw new HttpError(409, 'nothing is waiting for that step');
      waiting.delete(step);
      r(answer === 'approve');
      res.writeHead(200); return res.end('ok');
    }
    throw new HttpError(404, 'not found');
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      const status = err instanceof HttpError ? err.status : 500;
      if (!res.headersSent) res.writeHead(status, { 'content-type': 'text/plain' });
      res.end(err instanceof HttpError ? err.message : 'error');
    });
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      bound = (server.address() as AddressInfo).port;
      resolve({
        server, port: bound, token,
        close: () => new Promise((r) => { for (const c of clients) c.end(); server.close(() => r()); }),
      });
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const s = await startServer(Number(process.env.PORT ?? 8787));
  console.error(`Leash demo console on http://127.0.0.1:${s.port} (open this exact URL; the page carries the session token)`);
}
