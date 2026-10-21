import type { RawPool } from './rank';

/** The pools in a DefiLlama response, keeping only well-formed ones. Pure. */
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function toRawPools(json: unknown): RawPool[] {
  const data = (json as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  const out: RawPool[] = [];
  for (const p of data) {
    if (!p || typeof p !== 'object') continue;
    const r = p as Record<string, unknown>;
    const tvl = numOrNull(r.tvlUsd);
    if (!str(r.pool) || !str(r.chain) || !str(r.symbol) || tvl === null) continue;
    out.push({
      pool: str(r.pool),
      chain: str(r.chain),
      project: str(r.project),
      symbol: str(r.symbol),
      tvlUsd: tvl,
      apy: numOrNull(r.apy),
      apyBase: numOrNull(r.apyBase),
      apyReward: numOrNull(r.apyReward),
      apyMean30d: numOrNull(r.apyMean30d),
      stablecoin: r.stablecoin === true,
      ilRisk: typeof r.ilRisk === 'string' ? r.ilRisk : null,
      exposure: typeof r.exposure === 'string' ? r.exposure : null,
      outlier: r.outlier === true,
    });
  }
  return out;
}
