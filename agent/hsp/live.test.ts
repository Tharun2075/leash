import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeQa } from '../hsp-live.ts';
import { McpHspAdapter } from './mcp.ts';
import { REQUIRED_TOOLS } from './types.ts';

// Runs only when asked (HSP_LIVE_TEST=1 + HSP_ALLOWLIST_CONFIRMED=1) AND the QA gateway answers without 403.
const asked = process.env.HSP_LIVE_TEST === '1' && process.env.HSP_ALLOWLIST_CONFIRMED === '1';

test('HSP live: QA gateway lists all required tools', { skip: !asked && 'set HSP_LIVE_TEST=1 HSP_ALLOWLIST_CONFIRMED=1' }, async (t) => {
  const p = await probeQa();
  if (!p.reachable) return t.skip(`QA still blocked (${p.status})`);
  const hsp = new McpHspAdapter();
  await hsp.connect();
  try { for (const n of REQUIRED_TOOLS) assert.ok(hsp.schemas.has(n), n); } finally { await hsp.close(); }
});
