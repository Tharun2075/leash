// Leash judge page: read-only eth_call against HSK mainnet (chain 177). No wallet, no writes.
(() => {
  'use strict';
  const RPC = 'https://mainnet.hsk.xyz';
  const VAULT = '0x736076b308c720d38bb31bdf97e5726ab90f13a9';
  const AGENT = '0x186d6E32EB784e3483acb56acc1c560Eeb49e368';
  const SHOP = '0x5e11e700000000000000000000000000000000a1';
  const EXPLORER = 'https://hsk.blockscout.com';
  const SEL = {
    policies: '0x20e98698', remainingToday: '0xec52e060', merchantAllowed: '0x76b05f94',
    nextIntentId: '0x9b7b7b1e', getReceipt: '0xb63e6ac3', check: '0xb2e09624',
  };
  const REASONS = ['OK', 'NO_POLICY', 'ZERO_AMOUNT', 'NOT_ALLOWED_MERCHANT', 'OVER_PER_PAYMENT', 'OVER_DAILY_CAP', 'COOLDOWN'];
  const REASON_TEXT = [
    'Allowed: within the budget.',
    'Blocked: this agent has no active spending policy.',
    'Blocked: the payment amount is zero.',
    'Blocked: this shop is not on the allowed list.',
    'Blocked: above the per-payment limit.',
    "Blocked: would exceed today's allowance.",
    'Blocked: cooldown, the agent must wait before paying again.',
  ];
  const $ = (id) => document.getElementById(id);
  let policy = null;
  let remaining = null;

  const word = (hex) => hex.replace(/^0x/, '').toLowerCase().padStart(64, '0');
  const addr = (a) => word(a);
  const words = (data) => (data || '0x').slice(2).match(/.{64}/g) || [];
  const big = (w) => BigInt('0x' + w);
  const usd = (micro) => {
    const cents = (micro + 5000n) / 10000n;
    return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')} USD`;
  };
  const short = (h) => `${h.slice(0, 6)}…${h.slice(-4)}`;

  async function rpc(method, params) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    try {
      const r = await fetch(RPC, {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: ctl.signal,
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message || 'rpc error');
      return j.result;
    } finally { clearTimeout(t); }
  }
  const call = (data) => rpc('eth_call', [{ to: VAULT, data }, 'latest']);

  function offline(msg) {
    const e = $('live-error');
    e.hidden = false;
    e.textContent = `Could not reach the HSK mainnet RPC (${msg}). Open the contract on Blockscout to read the same values.`;
    $('policy-state').textContent = 'offline';
  }

  async function loadBudget() {
    const chain = await rpc('eth_chainId', []);
    if (parseInt(chain, 16) !== 177) throw new Error('wrong chain ' + chain);
    const [p, rem, allowed, next, block] = await Promise.all([
      call(SEL.policies + addr(AGENT)),
      call(SEL.remainingToday + addr(AGENT)),
      call(SEL.merchantAllowed + addr(AGENT) + addr(SHOP)),
      call(SEL.nextIntentId),
      rpc('eth_blockNumber', []),
    ]);
    const w = words(p);
    policy = { cap: big(w[0]), per: big(w[1]), cool: big(w[2]), active: big(w[3]) === 1n };
    remaining = big(words(rem)[0]);
    $('cap').textContent = usd(policy.cap);
    $('per').textContent = usd(policy.per);
    $('cool').textContent = policy.cool === 0n ? 'none' : `${policy.cool} s`;
    $('remaining').textContent = usd(remaining);
    $('shop-ok').textContent = big(words(allowed)[0]) === 1n ? '✓ allowed' : '✕ not listed';
    $('intents').textContent = String(big(words(next)[0]) - 1n);
    const st = $('policy-state');
    st.textContent = policy.active ? 'policy active' : 'no policy';
    st.className = 'pill ' + (policy.active ? 'ok' : 'bad');
    const usedPct = policy.cap > 0n ? Number(((policy.cap - remaining) * 1000n) / policy.cap) / 10 : 0;
    $('meter-fill').style.width = `${Math.max(0, Math.min(100, usedPct))}%`;
    const m = $('meter');
    m.setAttribute('aria-valuenow', String(usedPct));
    m.setAttribute('aria-valuetext', `${usd(policy.cap - remaining)} of ${usd(policy.cap)} used today`);
    $('block-note').textContent = `Block ${parseInt(block, 16).toLocaleString('en-US')}.`;
  }

  function explain(code, amountMicro, shop) {
    if (code === 3) return `Blocked: shop ${short(shop)} is not on the allowed list.`;
    if (code === 4 && policy) return `Blocked: ${usd(amountMicro)} is above the per-payment limit of ${usd(policy.per)}.`;
    if (code === 5 && policy && remaining !== null) return `Blocked: ${usd(amountMicro)} would exceed today's allowance (${usd(remaining)} left of ${usd(policy.cap)}).`;
    if (code === 0) return `Allowed: ${usd(amountMicro)} is within the budget. The agent may request it; the owner still approves.`;
    return REASON_TEXT[code] || `Unknown reason ${code}.`;
  }

  async function runCheck(ev) {
    if (ev) ev.preventDefault();
    const v = $('verdict');
    const shop = $('shop').value;
    const dollars = Number($('amt').value);
    if (!Number.isFinite(dollars) || dollars < 0) { v.textContent = 'Enter an amount in USD.'; v.className = 'verdict'; return; }
    const micro = BigInt(Math.round(dollars * 1e6));
    v.textContent = 'Asking mainnet…'; v.className = 'verdict';
    try {
      const res = await call(SEL.check + addr(AGENT) + addr(shop) + word(micro.toString(16)));
      const code = Number(big(words(res)[0]));
      v.textContent = `${explain(code, micro, shop)} (reason ${code} ${REASONS[code] || ''})`;
      v.className = 'verdict ' + (code === 0 ? 'ok' : 'bad');
    } catch (e) {
      v.textContent = `Could not reach mainnet (${e.message}). The real blocked 9.00 USD payment is on Blockscout, linked above.`;
    }
  }

  async function loadReceipt() {
    const checks = $('r-checks');
    const add = (cls, html) => { const li = document.createElement('li'); li.className = cls; li.innerHTML = html; checks.appendChild(li); };
    let r;
    try {
      r = await (await fetch('assets/receipt-177.json')).json();
    } catch (e) { add('bad', 'Receipt file could not be loaded.'); return null; }
    $('r-intent').textContent = `#${r.intent_id} · chain ${r.chain_id}`;
    $('r-flow').textContent = `${r.flow_id} / ${r.payment_request_id}`;
    $('r-trail').textContent = r.hsp_status_history.map((s) => s.label)
      .filter((s, i, a) => a.indexOf(s) === i).join(' → ');
    const a = document.createElement('a');
    a.href = `${EXPLORER}/tx/${encodeURIComponent(r.settle_tx)}`; a.rel = 'noopener'; a.textContent = short(r.settle_tx);
    $('r-tx').replaceChildren(a);
    $('r-sig').textContent = short(r.signature);
    add('', `Signed off chain by the Leash server; the repo's <code>GET /receipt</code> re-checks the signature.`);
    return r;
  }

  async function verifyReceipt(r) {
    const checks = $('r-checks');
    const add = (cls, text) => { const li = document.createElement('li'); li.className = cls; li.textContent = text; checks.appendChild(li); };
    const res = await call(SEL.getReceipt + word(BigInt(r.intent_id).toString(16)));
    const w = words(res).map((x) => '0x' + x);
    const pairs = [['flow id hash', r.flow_id_hash, w[0]], ['payment request hash', r.payment_request_id_hash, w[1]],
      ['policy hash', r.policy_hash, w[2]], ['HSP tx hash', r.hsp_tx_hash, w[3]]];
    let ok = 0;
    for (const [name, a, b] of pairs) if (a && b && a.toLowerCase() === b.toLowerCase()) ok += 1; else add('bad', `${name} differs from mainnet.`);
    if (ok === pairs.length) add('ok', `All 4 receipt hashes match getReceipt(${r.intent_id}) on mainnet right now.`);
  }

  function init() {
    const list = $('code-list');
    REASONS.forEach((name, i) => { const li = document.createElement('li'); li.textContent = `${name}: ${REASON_TEXT[i]}`; list.appendChild(li); });
    $('check-form').addEventListener('submit', runCheck);
    const receipt = loadReceipt();
    loadBudget()
      .then(() => runCheck())
      .then(() => receipt)
      .then((r) => (r ? verifyReceipt(r) : null))
      .catch((e) => {
        offline(e.name === 'AbortError' ? 'timeout' : e.message);
        receipt.then((r) => { if (r) { const li = document.createElement('li'); li.textContent = 'On-chain re-check needs a connection to HSK mainnet.'; $('r-checks').appendChild(li); } });
      });
  }
  init();
})();
