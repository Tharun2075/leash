// Headless run of every demo scenario; writes one JSONL transcript per scenario (used by the T8 wording check).
// Usage: node agent/run-scenarios.ts <outdir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { SCENARIOS, runScenario } from './scenarios.ts';
import type { FlowEvent } from './flow.ts';

const out = process.argv[2] ?? 'test-results/logs';
mkdirSync(out, { recursive: true });
for (const s of SCENARIOS) {
  const events: FlowEvent[] = [];
  const r = await runScenario(s.name, (e) => events.push(e), { decide: async () => s.name !== 'refuse-sign' }, undefined);
  writeFileSync(`${out}/${s.name}.jsonl`, events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  console.log(`${s.name.padEnd(18)} -> ${r.outcome}`);
}
