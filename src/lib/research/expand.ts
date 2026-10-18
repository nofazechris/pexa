/**
 * Widening a search is the person's call, never automatic: it can cost more. When a distance limit left sellers out, or very few
 * were found, offer buttons for the sensible next step. Tapping one sends its text as the next message, and lookups already paid
 * for in the last few hours are reused for free.
 *
 * Pure.
 */
import type { Platform, ResearchRequest } from './types';

export interface ExpandOption {
  label: string;
  text: string;
}

const NEXT_RADIUS = [5, 10, 20, 50, 100];
const NAME: Record<string, string> = { instagram: 'Instagram', tiktok: 'TikTok', x: 'X' };
const SELLER: readonly Platform[] = ['instagram', 'tiktok', 'x'];

export function expandOptions(req: ResearchRequest, found: { shown: number; outsideRadius: number }): ExpandOption[] {
  const out: ExpandOption[] = [];
  if (req.radiusKm && found.outsideRadius > 0) {
    const next = NEXT_RADIUS.find((r) => r > (req.radiusKm as number));
    if (next) out.push({ label: `Widen to ${next} km`, text: `Same search, but within ${next} km` });
  }
  if (req.kind === 'vendors' && found.shown < 3) {
    const unused = SELLER.filter((p) => !req.platforms.includes(p));
    for (const p of unused.slice(0, 2)) out.push({ label: `Try ${NAME[p]}`, text: `Search ${NAME[p]}` });
  }
  return out.slice(0, 3);
}
