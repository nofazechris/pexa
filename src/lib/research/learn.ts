/**
 * The memory box, as pure rules. Two things are learned and both start from counts, not guesses:
 *
 *  1. About individual vendors — how often one came up, and what Pexa users said (good lead / bad lead / scam). A scam report puts a
 *     ceiling on the score; several good reports are a plus; nothing here ever *proves* a seller, it only adds what others found.
 *  2. About platforms — for each kind of thing in each city, how well Instagram, TikTok and X have turned up real, well-rated sellers.
 *     That yield is measured automatically from every finished search, and later used to suggest where to look first.
 *
 * No user identity is involved: only counts about public business accounts and about platforms. Pure.
 */
import type { Signal, VendorMemoryView } from './types';

export type { VendorMemoryView };

export interface MemoryFlag {
  text: string;
  cap: number;
}

/** What earlier searches and feedback add to a vendor's card: facts, and ceilings on the score. */
export function memoryEffect(mem: VendorMemoryView | null | undefined): { signals: Signal[]; flags: MemoryFlag[] } {
  const signals: Signal[] = [];
  const flags: MemoryFlag[] = [];
  if (!mem) return { signals, flags };
  const people = (n: number) => `${n} Pexa user${n === 1 ? '' : 's'}`;
  if (mem.scam >= 2) flags.push({ text: `${people(mem.scam)} reported this account as a scam.`, cap: 20 });
  else if (mem.scam === 1) flags.push({ text: 'A Pexa user reported this account as a scam.', cap: 45 });
  else if (mem.bad >= 2 && mem.bad > mem.good) flags.push({ text: `${people(mem.bad)} rated this a bad lead.`, cap: 60 });
  else if (mem.good >= 2 && mem.bad === 0) signals.push({ tone: 'good', text: `${people(mem.good)} found this a good lead.` });
  if (mem.seen >= 2) signals.push({ tone: 'info', text: `Came up in ${mem.seen} earlier Pexa searches.` });
  return { signals, flags };
}

// --- platforms ----------------------------------------------------------------------------------------------

export interface PlatformStat {
  platform: string;
  runs: number;
  shown: number;
  established: number;
  risky: number;
  ratingSum: number;
}

/** What one finished search adds to a platform's record: only the accounts that were shown from it. */
export function statDelta(platform: string, items: readonly { platform: string; verdict: string; rating: { overall: number } | null }[]): PlatformStat {
  const mine = items.filter((i) => i.platform === platform);
  return {
    platform,
    runs: 1,
    shown: mine.length,
    established: mine.filter((i) => i.verdict === 'solid').length,
    risky: mine.filter((i) => i.verdict === 'careful').length,
    ratingSum: mine.reduce((sum, i) => sum + (i.rating?.overall ?? 0), 0),
  };
}

/** Prior: with little evidence a platform scores as a middling 50, so a single lucky search can't crown it. */
const PRIOR = 50;
const PRIOR_WEIGHT = 4;

/** Average rating of the sellers a platform has turned up here (0–100), pulled toward 50 until there are enough of them. Null with no data. */
export function platformYield(s: PlatformStat | undefined): number | null {
  if (!s || s.shown === 0) return null;
  return Math.round((s.ratingSum + PRIOR * PRIOR_WEIGHT) / (s.shown + PRIOR_WEIGHT));
}

export interface PlatformAdvice {
  platform: string;
  /** "Average 4.1/5 over 9 sellers found here" — what it has actually done in this city for this kind of thing. */
  hint: string | null;
  /** Clearly the best so far, with enough sellers behind it. */
  recommended: boolean;
}

const PLATFORMS = ['instagram', 'tiktok', 'x'];
/** How many sellers must have been seen on a platform before it can be recommended, and how far ahead it must be. */
const MIN_SHOWN = 6;
const MIN_GAP = 6;

/** For each platform: what it has done here, and whether it is the clear winner. Recommends only on real evidence. */
export function advise(stats: readonly PlatformStat[]): PlatformAdvice[] {
  const by = new Map(stats.map((s) => [s.platform, s]));
  const yields = PLATFORMS.map((p) => ({ p, y: platformYield(by.get(p)), shown: by.get(p)?.shown ?? 0 }));
  const ranked = yields.filter((x) => x.y !== null && x.shown >= MIN_SHOWN).sort((a, b) => (b.y as number) - (a.y as number));
  const best = ranked[0];
  const others = yields.filter((x) => x.y !== null && x.p !== best?.p);
  const clearWinner = best && (best.y as number) >= 60 && others.every((o) => (best.y as number) - (o.y as number) >= MIN_GAP);
  return PLATFORMS.map((p) => {
    const s = by.get(p);
    const y = platformYield(s);
    return {
      platform: p,
      // The hint reports what actually happened (the plain average); the shrunk yield is only used to decide who is ahead.
      hint: s && y !== null ? `Averaged ${(s.ratingSum / s.shown / 20).toFixed(1)}/5 across ${s.shown} seller${s.shown === 1 ? '' : 's'} found here` : null,
      recommended: Boolean(clearWinner && best?.p === p),
    };
  });
}
