/**
 * Quality numbers for a finished search, measured against what a person would call right. Used by the scenario report
 * (`npm run research:metrics`) so a change to scoring that makes results worse shows up as a number, not a hunch.
 *
 * Pure.
 */
import { ownerKeys } from './dedupe';
import type { ResearchItem, ResearchResult } from './types';

export interface Expectation {
  /** Handles (without @, lowercase) that a good answer must include. */
  relevant: string[];
  /** Handles that must NOT be shown at all (a cleaning service, a clothes seller). */
  mustNotShow?: string[];
  /** Handles that may be shown but must not be called Established. */
  mustNotBeEstablished?: string[];
  /** A distance limit the answer must respect. */
  radiusKm?: number;
}

export interface Metrics {
  shown: number;
  /** Of the top five shown, the share that belong (are in `relevant`). */
  precisionAt5: number;
  /** Of the accounts that should appear, the share that did. */
  recall: number;
  /** Shown results that are the same business or the same account twice. */
  duplicates: number;
  /** Shown results measured farther than the limit. */
  geoViolations: number;
  /** "Established" labels the evidence doesn't back (trust under 78), plus Established labels on accounts that must not have one. */
  unsupportedClaims: number;
  /** Accounts that must not be shown, but were. */
  leaked: number;
  /** Paid lookups and what they cost, in dollars. */
  calls: number;
  cost: number;
}

const handleOf = (i: ResearchItem) => (i.handle ?? i.name).replace(/^@/, '').toLowerCase();

export function measure(result: ResearchResult, expect: Expectation, calls: number, costAtomic: bigint): Metrics {
  const items = result.items;
  const names = items.map(handleOf);
  const top = names.slice(0, 5);
  const relevant = expect.relevant.map((h) => h.toLowerCase());
  const banned = (expect.mustNotShow ?? []).map((h) => h.toLowerCase());
  const noEstablished = new Set((expect.mustNotBeEstablished ?? []).map((h) => h.toLowerCase()));

  const seen = new Set<string>();
  let duplicates = 0;
  for (const i of items) {
    const keys = [`${i.platform}:${handleOf(i)}`, ...ownerKeys(i)];
    if (keys.some((k) => seen.has(k))) duplicates++;
    keys.forEach((k) => seen.add(k));
  }

  return {
    shown: items.length,
    precisionAt5: top.length ? top.filter((h) => relevant.includes(h)).length / top.length : 1,
    recall: relevant.length ? relevant.filter((h) => names.includes(h)).length / relevant.length : 1,
    duplicates,
    geoViolations: expect.radiusKm ? items.filter((i) => i.distanceKm !== null && i.distanceKm > (expect.radiusKm as number)).length : 0,
    unsupportedClaims: items.filter((i) => i.verdictLabel === 'Established' && ((i.rating?.trust ?? 0) < 78 || noEstablished.has(handleOf(i)))).length,
    leaked: items.filter((i) => banned.includes(handleOf(i))).length,
    calls,
    cost: Number(costAtomic) / 1_000_000,
  };
}

/** One line per scenario, for the report. */
export function row(name: string, m: Metrics): string {
  const pct = (n: number) => `${Math.round(n * 100)}%`.padStart(4);
  return `${name.padEnd(34)} shown ${String(m.shown).padStart(2)}  P@5 ${pct(m.precisionAt5)}  recall ${pct(m.recall)}  dup ${m.duplicates}  geo ${m.geoViolations}  unsupported ${m.unsupportedClaims}  leaked ${m.leaked}  calls ${String(m.calls).padStart(2)}  $${m.cost.toFixed(3)}`;
}
