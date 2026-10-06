/**
 * Social/web APIs return huge payloads — mostly image URLs, tracking ids and nested duplicates. The agent
 * only needs the signal (who said what, when, how popular), so we prune before it reads a result:
 * drop media/boilerplate, shorten long text, keep the first few items of long lists, then fit a budget.
 * Pure and deterministic; it never invents or alters values, only omits and shortens.
 */

/** Keys that describe media: dropped when their value is a link or a nested blob (never when it is plain text). */
const MEDIA_KEY = /(thumb|avatar|profile_?pic|picture|photo|favicon|display_?url|image|img|icon|cover|banner|video_?url|media_?url|preview)/i;
/** Keys that are pure bookkeeping, dropped whatever their value. */
const BOOKKEEPING_KEY = /^(cursor|next_?cursor|etag|signature|sig|trace_?id|tracking|typename|extensions|urls)$/i;
const MAX_STRING = 280;
/** Fields that carry program output or logs keep far more text than a social post snippet. */
const LONG_TEXT_KEY = /^(stdout|stderr|output|log|logs|result|results|content|body)$/i;
const MAX_LONG_STRING = 2400;
const MAX_ITEMS_START = 12;
const MAX_DEPTH = 7;

function isNoiseKey(key: string, val: unknown): boolean {
  if (key.startsWith('__') || BOOKKEEPING_KEY.test(key)) return true;
  if (!MEDIA_KEY.test(key)) return false;
  return (typeof val === 'string' && /^(https?:|data:|\/\/)/i.test(val.trim())) || (typeof val === 'object' && val !== null);
}

function slimValue(v: unknown, depth: number, maxItems: number, maxString = MAX_STRING): unknown {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'string') {
    const t = v.trim();
    if (!t) return undefined;
    return t.length > maxString ? t.slice(0, maxString - 1) + '…' : t;
  }
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (depth >= MAX_DEPTH) return undefined;

  if (Array.isArray(v)) {
    const items = v.slice(0, maxItems).map((x) => slimValue(x, depth + 1, maxItems, maxString)).filter((x) => x !== undefined);
    if (v.length > maxItems) items.push(`(+${v.length - maxItems} more not shown)`);
    return items.length ? items : undefined;
  }
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (isNoiseKey(k, val)) continue;
      const s = slimValue(val, depth + 1, maxItems, LONG_TEXT_KEY.test(k) ? MAX_LONG_STRING : MAX_STRING);
      if (s !== undefined && !(typeof s === 'object' && s !== null && Object.keys(s).length === 0)) out[k] = s;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return undefined;
}

/** Prune `value`, shrinking list lengths until the JSON fits `maxChars`. Reports whether anything was left out. */
export function slimForAgent(value: unknown, maxChars: number): { output: unknown; truncated: boolean } {
  const fits = (x: unknown) => JSON.stringify(x ?? null).length <= maxChars;
  let truncated = false;
  for (let items = MAX_ITEMS_START; items >= 1; items = Math.floor(items / 2)) {
    const s = slimValue(value, 0, items, typeof value === 'string' ? maxChars : MAX_STRING) ?? null;
    if (items < MAX_ITEMS_START) truncated = true;
    if (fits(s)) return { output: s, truncated: truncated || JSON.stringify(s).includes('more not shown') };
  }
  // Still too large (e.g. one giant string): cut the text, say so.
  const text = JSON.stringify(slimValue(value, 0, 1) ?? null);
  return { output: text.slice(0, maxChars), truncated: true };
}
