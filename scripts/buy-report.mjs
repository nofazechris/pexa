#!/usr/bin/env node
/**
 * Buy volume report (READ-ONLY): the demand Pexa has created for Celo's Buy marketplace, with proof.
 *
 *   npm run buy:report                 summary + one line per paid purchase
 *   npm run buy:report -- --verify     also check EVERY transaction on Celo (receipt succeeded and it really
 *                                      moved the stated token, payer -> Buy's payee, for the stated amount)
 *   npm run buy:report -- --json       machine-readable (for a submission or a dashboard)
 *   npm run buy:report -- --csv        spreadsheet
 *
 * Only PAID purchases count (a quote, a cancelled or failed purchase moved no money). Payer addresses are
 * public on-chain; no usernames, emails or purchase contents are included. Reads DATABASE_URL (and optionally
 * CELO_RPC_URL) from .env; nothing is printed from them and nothing is written.
 */
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

const args = new Set(process.argv.slice(2));
const VERIFY = args.has('--verify');
const AS_JSON = args.has('--json');
const AS_CSV = args.has('--csv');

const env = {};
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=([^#\r\n]*)/);
  if (m) env[m[1]] = m[2].trim() || undefined;
}
if (!env.DATABASE_URL) {
  console.error('Missing DATABASE_URL in .env');
  process.exit(2);
}
const RPC = env.CELO_RPC_URL && /^https?:/.test(env.CELO_RPC_URL) ? env.CELO_RPC_URL : 'https://forno.celo.org';

const TOKENS = {
  USDC: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C',
  USDT: '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e',
  USAT: '0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771',
};
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const retry = async (fn, n = 4) => {
  let e;
  for (let i = 0; i < n; i++) {
    try {
      return await fn();
    } catch (x) {
      e = x;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw e;
};
const short = (a) => (a ? a.slice(0, 6) + '…' + a.slice(-4) : '');
const usd = (atomic) => (Number(atomic) / 1e6).toFixed(Number(atomic) % 10000 === 0 ? 2 : 4);
const addrTopic = (t) => '0x' + String(t).slice(26).toLowerCase();

async function rpc(method, params) {
  const res = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

/** Did this transaction succeed AND really move `amount` of `token` from `from` to `to`? */
async function verifyTx(p) {
  const receipt = await retry(() => rpc('eth_getTransactionReceipt', [p.tx_hash]));
  if (!receipt) return { ok: false, why: 'transaction not found on Celo' };
  if (receipt.status !== '0x1') return { ok: false, why: 'transaction reverted' };
  const token = (TOKENS[p.pay_token] ?? '').toLowerCase();
  if (!token) return { ok: false, why: 'unknown token' };
  const hit = receipt.logs.some(
    (l) =>
      l.address.toLowerCase() === token &&
      l.topics.length === 3 &&
      l.topics[0].toLowerCase() === TRANSFER_TOPIC &&
      addrTopic(l.topics[1]) === p.wallet_address.toLowerCase() &&
      addrTopic(l.topics[2]) === p.pay_to.toLowerCase() &&
      BigInt(l.data) === BigInt(p.price_atomic),
  );
  return hit ? { ok: true, block: parseInt(receipt.blockNumber, 16) } : { ok: false, why: 'no matching token transfer in this transaction' };
}

// Transaction-mode pooler on the same host (port 6543): reports shouldn't fight the app for the 15 session slots.
const dbUrl = new URL(env.DATABASE_URL);
if (dbUrl.hostname.endsWith('.pooler.supabase.com') && (dbUrl.port === '' || dbUrl.port === '5432')) dbUrl.port = '6543';
const sql = postgres(dbUrl.toString(), { max: 2, prepare: false, ssl: dbUrl.hostname === 'localhost' ? undefined : 'require', connect_timeout: 30 });

let rows;
try {
  rows = await retry(
    () => sql`
      select id, created_at, paid_at, capability_id, title, pay_token, price_atomic, pay_to, wallet_address, tx_hash, mode
      from buy_purchases
      where status = 'PAID' and tx_hash is not null
      order by coalesce(paid_at, created_at)`,
  );
} finally {
  await sql.end({ timeout: 2 });
}

const purchases = [];
for (const r of rows) {
  const v = VERIFY ? await verifyTx(r) : null;
  purchases.push({
    when: (r.paid_at ?? r.created_at).toISOString(),
    service: r.capability_id,
    token: r.pay_token,
    amount: usd(r.price_atomic),
    amountAtomic: String(r.price_atomic),
    payer: r.wallet_address,
    payee: r.pay_to,
    mode: r.mode,
    tx: r.tx_hash,
    celoscan: `https://celoscan.io/tx/${r.tx_hash}`,
    verified: v ? v.ok : null,
    verifyNote: v && !v.ok ? v.why : null,
  });
}

const byToken = {};
const byService = {};
for (const p of purchases) {
  byToken[p.token] = (byToken[p.token] ?? 0) + Number(p.amountAtomic);
  byService[p.service] = (byService[p.service] ?? 0) + 1;
}
const payers = new Set(purchases.map((p) => p.payer.toLowerCase()));
const summary = {
  generatedAt: new Date().toISOString(),
  network: 'Celo mainnet (42220)',
  buyPayee: [...new Set(purchases.map((p) => p.payee))],
  paidPurchases: purchases.length,
  uniquePayerWallets: payers.size,
  totalByToken: Object.fromEntries(Object.entries(byToken).map(([k, v]) => [k, usd(v)])),
  byService,
  autonomous: purchases.filter((p) => p.mode === 'autonomous').length,
  approvedByUser: purchases.filter((p) => p.mode === 'confirmed').length,
  firstPurchase: purchases[0]?.when ?? null,
  lastPurchase: purchases[purchases.length - 1]?.when ?? null,
  verifiedOnChain: VERIFY ? purchases.filter((p) => p.verified).length : 'not checked (run with --verify)',
  failedVerification: VERIFY ? purchases.filter((p) => p.verified === false).length : null,
};

if (AS_JSON) {
  console.log(JSON.stringify({ summary, purchases }, null, 2));
} else if (AS_CSV) {
  const cols = ['when', 'service', 'token', 'amount', 'payer', 'payee', 'mode', 'tx', 'celoscan', 'verified'];
  console.log(cols.join(','));
  for (const p of purchases) console.log(cols.map((c) => JSON.stringify(p[c] ?? '')).join(','));
} else {
  console.log('\nPEXA × BUY — volume report');
  console.log('='.repeat(60));
  console.log(`Network            ${summary.network}`);
  console.log(`Paid purchases     ${summary.paidPurchases}`);
  console.log(`Unique payers      ${summary.uniquePayerWallets} wallet(s)`);
  console.log(`Total paid         ${Object.entries(summary.totalByToken).map(([k, v]) => `$${v} ${k}`).join('  ') || '—'}`);
  console.log(`Approved by user   ${summary.approvedByUser}    Autonomous ${summary.autonomous}`);
  console.log(`Period             ${summary.firstPurchase?.slice(0, 10) ?? '—'} → ${summary.lastPurchase?.slice(0, 10) ?? '—'}`);
  console.log(`Buy payee          ${summary.buyPayee.join(', ') || '—'}`);
  console.log(`Services           ${Object.entries(byService).map(([k, v]) => `${k} ×${v}`).join(', ') || '—'}`);
  console.log(`On-chain check     ${VERIFY ? `${summary.verifiedOnChain} verified, ${summary.failedVerification} failed` : 'skipped (add --verify to check every transaction)'}`);
  console.log('\n' + 'WHEN (UTC)'.padEnd(17) + 'SERVICE'.padEnd(22) + 'AMOUNT'.padEnd(14) + 'PAYER'.padEnd(14) + 'TX'.padEnd(14) + (VERIFY ? 'VERIFIED' : ''));
  for (const p of purchases) {
    console.log(
      p.when.slice(0, 16).replace('T', ' ').padEnd(17) +
        p.service.slice(0, 20).padEnd(22) +
        `$${p.amount} ${p.token}`.padEnd(14) +
        short(p.payer).padEnd(14) +
        short(p.tx).padEnd(14) +
        (VERIFY ? (p.verified ? 'yes' : `NO — ${p.verifyNote}`) : ''),
    );
  }
  console.log('\nEvery row is a public Celo transaction: ' + (purchases[0]?.celoscan ?? 'https://celoscan.io/tx/<hash>'));
  console.log('Full list with links: npm run buy:report -- --csv   (or --json)\n');
}
