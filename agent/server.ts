// Leash demo console server: serves ui/index.html, streams flow events over SSE, takes the human's decisions.
// Node built-ins only. Binds to 127.0.0.1.
import { createServer } from 'node:http';
import type { ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SCENARIOS, runScenario } from './scenarios.ts';
import type { ScenarioName } from './scenarios.ts';
import type { FlowEvent, HumanGate } from './flow.ts';

const PORT = Number(process.env.PORT ?? 8787);
const UI = fileURLToPath(new URL('../ui/index.html', import.meta.url));
const clients = new Set<ServerResponse>();
let running = false;
const waiting = new Map<string, (ok: boolean) => void>();

function broadcast(e: FlowEvent) {
  const line = `data: ${JSON.stringify(e)}\n\n`;
  for (const c of clients) c.write(line);
  console.log(JSON.stringify(e));
}

const human: HumanGate = {
  decide: (step) => new Promise((resolve) => { waiting.set(step, resolve); }),
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(readFileSync(UI));
  }
  if (req.method === 'GET' && url.pathname === '/scenarios') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(SCENARIOS));
  }
  if (req.method === 'GET' && url.pathname === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write(': connected\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (req.method === 'POST' && url.pathname === '/run') {
    const name = url.searchParams.get('scenario') as ScenarioName;
    if (!SCENARIOS.some((s) => s.name === name)) { res.writeHead(400); return res.end('unknown scenario'); }
    if (running) { res.writeHead(409); return res.end('a scenario is running'); }
    running = true;
    for (const [, r] of waiting) r(false);
    waiting.clear();
    runScenario(name, broadcast, human)
      .catch((err) => { broadcast({ type: 'log', level: 'error', text: String((err as Error).message) }); broadcast({ type: 'done', outcome: 'handoff' }); })
      .finally(() => { running = false; });
    res.writeHead(202); return res.end('started');
  }
  if (req.method === 'POST' && url.pathname === '/decision') {
    const step = url.searchParams.get('step') ?? '';
    const answer = url.searchParams.get('answer');
    const r = waiting.get(step);
    if (!r) { res.writeHead(409); return res.end('nothing is waiting for that step'); }
    waiting.delete(step);
    r(answer === 'approve');
    res.writeHead(200); return res.end('ok');
  }
  res.writeHead(404); res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => console.error(`Leash demo console on http://127.0.0.1:${PORT}`));
