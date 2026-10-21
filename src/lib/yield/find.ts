import type { RawPool } from './rank';

/** The symbol with the Tether sign normalised, lowercase: "USD₮" → "usdt". */
export const normSymbol = (s: string) => s.toLowerCase().replace(/₮/g, 't');

/**
 * The pool a person means by "the Aave USDT pool on Celo": same chain, a symbol that contains what they said, and (when given) a
 * project that contains it. If several match, the biggest by money deposited wins and the count of others is returned.
 */
export function findPool(pools: readonly RawPool[], q: { poolId?: string; chain?: string; project?: string; symbol?: string }): { pool: RawPool; others: number } | null {
  if (q.poolId) {
    const exact = pools.find((p) => p.pool === q.poolId);
    return exact ? { pool: exact, others: 0 } : null;
  }
  if (!q.chain || !q.symbol) return null;
  const chain = q.chain.trim().toLowerCase();
  const symbol = normSymbol(q.symbol.trim());
  const project = q.project?.trim().toLowerCase();
  const hits = pools
    .filter((p) => p.chain.toLowerCase() === chain && normSymbol(p.symbol).includes(symbol) && (!project || p.project.toLowerCase().includes(project)))
    .sort((a, b) => b.tvlUsd - a.tvlUsd);
  return hits.length ? { pool: hits[0], others: hits.length - 1 } : null;
}
