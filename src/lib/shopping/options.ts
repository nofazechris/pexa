import type { ResearchItem, ResearchResult } from '@/lib/research/types';

/**
 * The shopping list keeps a small snapshot of the best options found for each thing someone is trying to buy, and says in plain
 * words what changed the next time it is researched. Facts only: who, where, how they rated, what they published — never a pick
 * for the person, never a promise. Pure.
 */

export type OptionSource = 'instagram' | 'tiktok' | 'x' | 'web' | 'store';

export interface OptionSnap {
  source: OptionSource;
  name: string;
  handle: string | null;
  url: string | null;
  /** A store's place on the map (opens directions). */
  mapsUrl?: string | null;
  /** Pexa's rating, 0–100 (null for a web page, which isn't rated). */
  rating: number | null;
  /** "Established", "Unproven", "High risk", "Official brand store", "Major retailer"… */
  label: string;
  distanceKm: number | null;
  /** What they published for this item: the usual price in their own currency. */
  price: { text: string; median: number; currency: string } | null;
  phone: string | null;
  whatsapp: string | null;
  /** One honest line: how it was found, or what to watch for. */
  note: string | null;
  checkedAt: string;
}

export const MAX_OPTIONS = 5;

const keyOf = (o: Pick<OptionSnap, 'source' | 'handle' | 'url' | 'name'>) => `${o.source}:${(o.handle ?? o.url ?? o.name).toLowerCase()}`;

function fromItem(i: ResearchItem, at: string): OptionSnap {
  return {
    source: i.platform === 'instagram' || i.platform === 'tiktok' || i.platform === 'x' ? i.platform : 'web',
    name: i.name,
    handle: i.handle,
    url: i.url,
    rating: i.rating?.overall ?? null,
    label: i.verdictLabel,
    distanceKm: i.distanceKm,
    price: i.prices?.matched ? { text: i.prices.text, median: i.prices.median, currency: i.prices.currency } : null,
    phone: i.contact.phone,
    whatsapp: i.contact.whatsapp,
    note: i.signals.find((s) => s.tone === 'warn')?.text ?? null,
    checkedAt: at,
  };
}

/** The best checked, on-topic results of a research, best first. */
export function optionsFromResult(result: Pick<ResearchResult, 'items'>, now: Date): OptionSnap[] {
  return result.items
    .filter((i) => i.checked && i.relevance === 'match' && i.verdict !== 'careful')
    .slice(0, MAX_OPTIONS)
    .map((i) => fromItem(i, now.toISOString()));
}

const money = (o: OptionSnap['price']) => (o ? o.text : 'no price');

/** What changed between two researches of the same thing, in plain words. Nothing on the first run (there is nothing to compare). */
export function diffOptions(prev: readonly OptionSnap[], next: readonly OptionSnap[]): string[] {
  if (!prev.length) return [];
  const out: string[] = [];
  const before = new Map(prev.map((o) => [keyOf(o), o]));
  const after = new Map(next.map((o) => [keyOf(o), o]));

  const top = next[0];
  if (top && !before.has(keyOf(top)) && (top.rating ?? 0) >= (prev[0]?.rating ?? 0)) out.push(`A new top option: ${top.handle ?? top.name} (${top.label.toLowerCase()}${top.rating !== null ? `, rated ${(top.rating / 20).toFixed(1)}/5` : ''}).`);
  for (const [k, o] of after) {
    const was = before.get(k);
    if (!was || !was.price || !o.price || was.price.currency !== o.price.currency || was.price.median <= 0) continue;
    const change = (o.price.median / was.price.median - 1) * 100;
    if (Math.abs(change) >= 10) out.push(`${o.handle ?? o.name} now shows ${money(o.price)}, ${change < 0 ? 'down' : 'up'} ${Math.abs(change).toFixed(0)}% from ${money(was.price)}.`);
  }
  for (const [k, o] of before) if (!after.has(k) && o === prev[0]) out.push(`${o.handle ?? o.name}, which was your top option last time, didn’t come up this time.`);
  return out;
}

/** How many of each kind the list keeps: rated sellers, nearby stores, web pages. */
const KEEP = { sellers: MAX_OPTIONS, stores: 4, pages: 4 } as const;

/** The list in its fixed order — rated sellers, then nearby stores, then web pages — each kind kept short. */
export function arrange(options: readonly OptionSnap[]): OptionSnap[] {
  return [
    ...options.filter((o) => o.source !== 'web' && o.source !== 'store').slice(0, KEEP.sellers),
    ...options.filter((o) => o.source === 'store').slice(0, KEEP.stores),
    ...options.filter((o) => o.source === 'web').slice(0, KEEP.pages),
  ];
}

/** Add or replace a web page's option (one per page address); the newest page is kept when there are too many. */
export function withWebOption(options: readonly OptionSnap[], web: OptionSnap): OptionSnap[] {
  const rest = options.filter((o) => !(o.source === 'web' && o.url === web.url));
  const others = rest.filter((o) => o.source !== 'web');
  const pages = [web, ...rest.filter((o) => o.source === 'web')];
  return arrange([...others, ...pages]);
}

/** A new search of one kind replaces that kind's options and leaves the others alone. */
export function withStores(options: readonly OptionSnap[], stores: readonly OptionSnap[]): OptionSnap[] {
  return arrange([...options.filter((o) => o.source !== 'store'), ...stores]);
}
