#!/usr/bin/env node
/**
 * Wallet audit (READ-ONLY). Proves the "one wallet per user" invariant, and shows what's out of line.
 *
 *   npm run wallets:audit
 *
 * For every user it compares three things:
 *   1. our database's pinned wallet(s) for the active chain,
 *   2. every Privy embedded wallet the user actually has,
 *   3. the CANONICAL wallet by the app's rule (oldest embedded wallet — mirrors src/lib/wallets/select.ts),
 * and reports balances so you can see at a glance that any extra wallet is empty. Nothing is written
 * or deleted. Reads DATABASE_URL, PRIVY_APP_ID, PRIVY_APP_SECRET, CELO_RPC_URL from .env (never printed).
 */
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { PrivyClient } from '@privy-io/server-auth';
import { createPublicClient, http, formatEther, formatUnits, erc20Abi } from 'viem';
import { celo } from 'viem/chains';

const env = {};
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=([^#\r\n]*)/);
  if (m) env[m[1]] = m[2].trim() || undefined;
}
for (const k of ['DATABASE_URL', 'PRIVY_APP_ID', 'PRIVY_APP_SECRET']) {
  if (!env[k]) { console.error(`Missing ${k} in .env`); process.exit(2); }
}

const retry = async (fn, n = 5) => { let e; for (let i = 0; i < n; i++) { try { return await fn(); } catch (x) { e = x; await new Promise((r) => setTimeout(r, 2500)); } } throw e; };
const short = (a) => a.slice(0, 6) + '…' + a.slice(-4);
const toMs = (v) => (v == null ? null : v instanceof Date ? v.getTime() : typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : null);

// Mirrors listEmbeddedWallets() in src/lib/wallets/select.ts — oldest first, stable for unknown ages.
function embeddedOldestFirst(accounts) {
  return accounts
    .filter((a) => a.type === 'wallet' && a.walletClientType === 'privy' && a.chainType === 'ethereum' && typeof a.address === 'string')
    .map((a, index) => ({ a, index, t: toMs(a.firstVerifiedAt) ?? toMs(a.verifiedAt) }))
    .sort((x, y) => (x.t != null && y.t != null && x.t !== y.t ? x.t - y.t : x.index - y.index))
    .map((x) => x.a);
}

const chainId = env.CELO_NETWORK === 'sepolia' ? 11142220 : 42220;
const sql = postgres(env.DATABASE_URL, { max: 1, prepare: false, ssl: 'require', idle_timeout: 5, connect_timeout: 15 });
const privy = new PrivyClient(env.PRIVY_APP_ID, env.PRIVY_APP_SECRET);
const rpc = createPublicClient({ chain: celo, transport: http(env.CELO_RPC_URL || 'https://forno.celo.org') });
const USDC = '0xcebA9300f2b948710d2653dD7B07f33A8B32118C';

const balance = async (address) => {
  try {
    const [c, u] = await Promise.all([
      retry(() => rpc.getBalance({ address })),
      retry(() => rpc.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [address] })),
    ]);
    return { celo: formatEther(c), usdc: formatUnits(u, 6), hasFunds: c > 0n || u > 0n };
  } catch { return { celo: '?', usdc: '?', hasFunds: null }; }
};

const users = await retry(() => sql`select u.id, u.privy_did, u.created_at, p.username from users u left join profiles p on p.user_id = u.id order by u.created_at`);
const dbWallets = await retry(() => sql`select user_id, chain_id, address from wallets`);
const byUser = new Map();
for (const w of dbWallets) (byUser.get(w.user_id) ?? byUser.set(w.user_id, []).get(w.user_id)).push(w);

let problems = 0, extras = 0, extrasWithFunds = 0, totalPrivy = 0;
console.log(`Active chain ${chainId} · ${users.length} users\n`);
for (const u of users) {
  const rows = (byUser.get(u.id) ?? []).filter((r) => r.chain_id === chainId);
  const embedded = embeddedOldestFirst((await retry(() => privy.getUser(u.privy_did))).linkedAccounts);
  totalPrivy += embedded.length;
  const canonical = embedded[0]?.address;
  const pinned = rows[0]?.address;
  const issues = [];
  if (rows.length > 1) issues.push(`DB has ${rows.length} rows for this chain (expected 1)`);
  if (rows.length === 0) issues.push('no wallet pinned in DB yet');
  if (pinned && canonical && pinned.toLowerCase() !== canonical.toLowerCase()) issues.push('pinned wallet ≠ canonical (oldest) wallet');
  if (pinned && !embedded.some((e) => e.address.toLowerCase() === pinned.toLowerCase())) issues.push('pinned wallet is not one of the user’s Privy wallets');
  problems += issues.length;

  console.log(`@${u.username ?? '(no username yet)'}  ${issues.length ? '⚠️  ' + issues.join('; ') : '✅'}`);
  console.log(`   pinned in DB : ${pinned ? short(pinned) : '—'}   canonical: ${canonical ? short(canonical) : '—'}   Privy wallets: ${embedded.length}`);
  for (const [i, e] of embedded.entries()) {
    const isPinned = pinned && e.address.toLowerCase() === pinned.toLowerCase();
    const b = await balance(e.address);
    if (!isPinned) { extras++; if (b.hasFunds) extrasWithFunds++; }
    console.log(`   ${isPinned ? '● IN USE ' : '○ unused '} ${short(e.address)}  CELO ${b.celo}  USDC ${b.usdc}${!isPinned && b.hasFunds ? '   ⚠️ HAS FUNDS — do not discard' : ''}`);
  }
}
console.log(`\nSummary: ${totalPrivy} Privy wallets for ${users.length} users · ${extras} unused extras (${extrasWithFunds} holding funds) · ${problems} mismatches`);
await sql.end({ timeout: 5 });
process.exit(problems ? 1 : 0);
