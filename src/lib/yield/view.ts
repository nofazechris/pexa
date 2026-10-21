import { coverageNote, rankPools, type RawPool, type YieldPool, type YieldQuery } from './rank';

/**
 * What the chat card shows: the ranked pools plus the plain-words notes that keep the picture honest. Pure, so every sentence is
 * tested.
 */

export interface YieldView {
  /** When the data was read (ISO). */
  asOf: string;
  chains: string[];
  assets: 'stablecoins' | 'any';
  symbol: string | null;
  items: YieldPool[];
  notes: string[];
}

export const YIELD_DISCLAIMER = 'Not financial advice. Rates change daily, past rates promise nothing, and you can lose money — including all of it to a smart-contract failure.';

export function buildYieldView(raw: readonly RawPool[], q: YieldQuery, asOf: Date): YieldView {
  const items = rankPools(raw, q);
  const chains = (q.chains ?? []).filter(Boolean);
  const notes: string[] = [];

  if (!items.length) {
    const why = q.symbol && chains.length === 1 ? coverageNote(raw, chains[0], q.symbol) : null;
    notes.push(why ?? 'Nothing matched. Try another coin, another chain, or ask me to include smaller pools.');
  } else {
    if (items.some((p) => p.rewardShare >= 0.5 && p.apyReward > 0)) notes.push('Rewards are temporary incentives. The rate people will earn once they end is the “pays steadily” figure.');
    notes.push('“Check what people say” searches X and Reddit through Buy for hack, exploit or withdrawal chatter about the protocol — a few cents from your wallet, only after you approve. Posts are not proof either way.');
    if (items.some((p) => p.depositToken)) notes.push('Pexa can deposit into the Aave pools above for you (USDT or USDC, up to $25 at a time in beta) — you confirm every step.');
    if (items.some((p) => p.chain.toLowerCase() !== 'celo')) notes.push('Pexa can only move money on Celo. For pools on other chains this is research only; you would need to deposit there yourself.');
    if (q.symbol && /usat/i.test(q.symbol) && !items.some((p) => p.kind === 'lending')) notes.push('USAT has no lending market on Celo; it only appears in trading pools.');
  }
  notes.push(YIELD_DISCLAIMER);
  return { asOf: asOf.toISOString(), chains, assets: q.assets ?? 'stablecoins', symbol: q.symbol?.trim() || null, items, notes };
}
