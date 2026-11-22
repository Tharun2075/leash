// One-command retry for live HSP once HashKey allowlists our egress IP:
//   HSP_ALLOWLIST_CONFIRMED=1 npm run hsp:live
// Sends ONE probe to the QA gateway. 403 -> prints "still blocked" and exits 3 (no retry loop).
// Otherwise runs the 'happy' scenario with HSP_MODE=live through the same flow the demo uses.
import { HSP_QA_URL } from './hsp/mcp.ts';
import { runScenario } from './scenarios.ts';

export type Probe = { reachable: boolean; status: number | 'network-error' };

export async function probeQa(url = process.env.HSP_QA_URL ?? HSP_QA_URL): Promise<Probe> {
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }), signal: AbortSignal.timeout(15_000) });
    await r.body?.cancel();
    return { reachable: r.status !== 403, status: r.status };
  } catch {
    return { reachable: false, status: 'network-error' };
  }
}

if (import.meta.main) {
  if (process.env.HSP_ALLOWLIST_CONFIRMED !== '1') {
    console.error('Set HSP_ALLOWLIST_CONFIRMED=1 only after HSP Operations confirms our egress IP. Not probing.');
    process.exit(2);
  }
  const p = await probeQa();
  if (!p.reachable) {
    console.error(`HSP QA still blocked (${p.status}). Staying on HSP_MODE=mock.`);
    process.exit(3);
  }
  process.env.HSP_MODE = 'live';
  const r = await runScenario('happy', (e) => console.log(JSON.stringify(e)), { decide: async () => true });
  console.log(JSON.stringify({ probe: p.status, outcome: r.outcome }));
  process.exit(r.outcome === 'settled' ? 0 : 1);
}
