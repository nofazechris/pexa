import { coinsNamed } from './coin';
import { coverageNote, rankPools, type RawPool, type YieldPool, type YieldQuery } from './rank';

/**
 * What the chat card shows: the ranked pools plus the plain-words notes that keep the picture honest. When the person named a
 * coin, the answer is about THAT coin; if another coin pays notably more on the same chain, that is said openly (with how much of it
 * is temporary rewards) and an easy way to switch is offered — the person decides. Pure, so every sentence is tested.
 */

export interface Holdings {
  USDC: string;
  USDT: string;
  USAT: string;
}

/** Another coin that pays notably more than the one they asked about, and that Pexa can deposit and convert to. */
export interface ConvertHint {
  from: 'USDC' | 'USDT' | 'USAT';
  to: 'USDC' | 'USDT';
  /** What each pays, in plain words, for the card. */
  compare: string;
}

export interface YieldView {
  /** When the data was read (ISO). */
  asOf: string;
  chains: string[];
  assets: 'stablecoins' | 'any';
  symbol: string | null;
  items: YieldPool[];
  notes: string[];
  /** What the person holds in their wallet right now (human amounts), when it could be read. */
  holdings: Holdings | null;
  convert: ConvertHint | null;
}

export const YIELD_DISCLAIMER = 'Not financial advice. Rates change daily, past rates promise nothing, and you can lose money — including all of it to a smart-contract failure.';

const SWAPPABLE = ['USDC', 'USDT', 'USAT'] as const;
const pct = (n: number) => `${n >= 10 ? n.toFixed(1) : n.toFixed(2)}%`;
const payText = (p: YieldPool) => (p.apyReward > 0 ? `${pct(p.apyBase)} steady plus ${pct(p.apyReward)} temporary rewards` : `${pct(p.apyBase)} steady`);
const money = (s: string) => `$${Number(s).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** If they asked about one coin and another pays clearly more on a pool Pexa can deposit into, say so. */
function reconcile(raw: readonly RawPool[], q: YieldQuery, items: readonly YieldPool[]): ConvertHint | null {
  const asked = coinsNamed(q.symbol ?? '').find((c): c is (typeof SWAPPABLE)[number] => (SWAPPABLE as readonly string[]).includes(c));
  if (!asked) return null;
  const best = rankPools(raw, { ...q, symbol: undefined, assets: 'stablecoins', limit: 8 }).find((p) => p.depositToken);
  if (!best || !best.depositToken || best.depositToken === asked) return null;
  const mine = items.find((p) => p.depositToken === asked) ?? items[0] ?? null;
  const mineApy = mine?.apy ?? 0;
  if (best.apy < mineApy + 0.3 || best.apy < mineApy * 1.5) return null;
  return { from: asked, to: best.depositToken, compare: `${best.depositToken} on ${best.project} pays ${payText(best)}${mine ? `; ${asked} pays ${payText(mine)}` : `; nothing here pays ${asked} a lending rate`}` };
}

export function buildYieldView(raw: readonly RawPool[], q: YieldQuery, asOf: Date, extras: { holdings?: Holdings | null } = {}): YieldView {
  const items = rankPools(raw, q);
  const chains = (q.chains ?? []).filter(Boolean);
  const holdings = extras.holdings ?? null;
  const notes: string[] = [];
  const convert = reconcile(raw, q, items);

  if (!items.length) {
    const why = q.symbol && chains.length === 1 ? coverageNote(raw, chains[0], q.symbol) : null;
    notes.push(why ?? 'Nothing matched. Try another coin, another chain, or ask me to include smaller pools.');
  } else {
    if (items.some((p) => p.rewardShare >= 0.5 && p.apyReward > 0)) notes.push('Rewards are temporary incentives. The rate people will earn once they end is the “pays steadily” figure.');
    notes.push('“Check what people say” searches X and Reddit through Buy for hack, exploit or withdrawal chatter about the protocol — a few cents from your wallet, only after you approve. Posts are not proof either way.');
    if (items.some((p) => p.depositToken)) notes.push('Pexa can deposit into the Aave pools above for you (USDT or USDC, from $0.10 up to $25 at a time in beta; I cover the network fee) — you confirm every step.');
    if (items.some((p) => p.chain.toLowerCase() !== 'celo')) notes.push('Pexa can only move money on Celo. For pools on other chains this is research only; you would need to deposit there yourself.');
    if (q.symbol && /usat/i.test(q.symbol) && !items.some((p) => p.kind === 'lending')) notes.push('USAT has no lending market on Celo; it only appears in trading pools.');
  }
  if (convert) {
    const have = holdings ? holdings[convert.from] : null;
    notes.push(`You asked about ${convert.from}. For comparison: ${convert.compare}.${have !== null ? ` You hold ${money(have)} ${convert.from}.` : ''} If you’d rather use ${convert.to}, I can convert first — your call.`);
  } else if (holdings && items.some((p) => p.depositToken)) {
    const want = items.find((p) => p.depositToken)?.depositToken as 'USDT' | 'USDC';
    if (Number(holdings[want]) < 0.1) {
      const other = want === 'USDT' ? 'USDC' : 'USDT';
      notes.push(`You hold ${money(holdings[want])} ${want}${Number(holdings[other]) >= 0.1 ? ` and ${money(holdings[other])} ${other}, so I can convert some ${other} to ${want} first (or deposit the ${other} instead)` : ', so you would need to add funds first — the minimum to start is $0.10'}.`);
    }
  }
  notes.push(YIELD_DISCLAIMER);
  return { asOf: asOf.toISOString(), chains, assets: q.assets ?? 'stablecoins', symbol: q.symbol?.trim() || null, items, notes, holdings, convert };
}
