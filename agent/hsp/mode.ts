// HSP_MODE=live|mock picks the HSP backend. LEASH_HSP is the older name and still works.
// Mock is the default until HashKey allowlists our egress IP for the QA gateway (it answers 403 today).
export type HspMode = 'live' | 'mock';

export const HSP_MOCK_LABEL = 'HSP mock (QA access pending)';
export const HSP_LIVE_LABEL = 'HSP live (QA gateway)';

export function hspMode(env: NodeJS.ProcessEnv = process.env): HspMode {
  const v = (env.HSP_MODE ?? env.LEASH_HSP ?? 'mock').toLowerCase();
  if (v !== 'live' && v !== 'mock') throw new Error(`HSP_MODE must be live or mock, got "${v}"`);
  return v;
}

export const modeLabel = (m: HspMode) => (m === 'live' ? HSP_LIVE_LABEL : HSP_MOCK_LABEL);
