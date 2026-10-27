import { haversineKm, type Point } from '@/lib/geo/place';
import type { OptionSnap } from './options';
import { sellerKind } from './page';

/**
 * Nearby stores from a Google Places search (bought through Buy). Real businesses with an address, a rating and review count, a
 * phone number and an opening state — a much firmer footing than a social profile. Facts only: how far, how it is reviewed, whether
 * it is open. Pexa doesn't pick for the person and doesn't pay a store; the person walks in or calls. Pure.
 */

export interface StoreHit {
  id: string;
  name: string;
  address: string | null;
  point: Point | null;
  rating: number | null;
  reviews: number;
  phone: string | null;
  website: string | null;
  mapsUrl: string | null;
  /** true / false when Google knows, null when it doesn't. */
  openNow: boolean | null;
  status: 'OPERATIONAL' | 'CLOSED_TEMPORARILY' | 'CLOSED_PERMANENTLY' | null;
  types: string[];
}

export interface StoreView extends StoreHit {
  /** Straight-line kilometres from the person's place, when both could be pinned down. */
  distanceKm: number | null;
  /** "Well reviewed", "Good reviews", "Mixed reviews", "Poorly reviewed", "Few reviews". */
  label: string;
  /** One honest line: rating, review count, open now. */
  note: string;
  /** The shop's own site is a known brand or retailer. */
  siteKind: 'official' | 'retailer' | 'unknown' | null;
}

export interface StoreResult {
  query: string;
  place: string;
  stores: StoreView[];
  /** Facts worth saying first: who is closest, who is reviewed best. */
  highlights: string[];
  /** Were distances measured? */
  measured: boolean;
}

// --- asking ---------------------------------------------------------------------------------------

const STORE_WORD = /\b(stores?|shops?|dealers?|markets?|outlets?|showrooms?|boutiques?|pharmac(?:y|ies)|supermarkets?|mall|distributors?|suppliers?)\b/i;

/** The request body for Places text search: one query, a handful of results. Plain text only, so it is always a valid body. */
export function placesBody(what: string, place: string, count = 8): { textQuery: string; maxResultCount: number } {
  const item = what.replace(/\s+/g, ' ').trim().slice(0, 80);
  const where = place.replace(/\s+/g, ' ').trim().slice(0, 60);
  const text = `${item}${STORE_WORD.test(item) ? '' : ' store'}${where ? ` in ${where}` : ''}`;
  return { textQuery: text.slice(0, 200), maxResultCount: Math.max(1, Math.min(10, count)) };
}

// --- reading what Google returned ---------------------------------------------------------------------

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown, max = 300): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The `places` list wherever it sits in what was stored (the purchase output may be wrapped). */
function placesList(output: unknown, depth = 0): unknown[] {
  let root = output;
  if (typeof root === 'string') {
    try {
      root = JSON.parse(root);
    } catch {
      return [];
    }
  }
  const o = rec(root);
  if (Array.isArray(o.places)) return o.places;
  if (depth >= 3) return [];
  for (const v of Object.values(o)) if (v && typeof v === 'object') {
    const found = placesList(v, depth + 1);
    if (found.length) return found;
  }
  return [];
}

const STATUS = ['OPERATIONAL', 'CLOSED_TEMPORARILY', 'CLOSED_PERMANENTLY'] as const;

export function parsePlaces(output: unknown): StoreHit[] {
  const out: StoreHit[] = [];
  for (const raw of placesList(output)) {
    const p = rec(raw);
    const name = str(rec(p.displayName).text, 120) ?? str(p.displayName, 120);
    if (!name) continue;
    const loc = rec(p.location);
    const lat = num(loc.latitude);
    const lon = num(loc.longitude);
    const status = STATUS.find((s) => s === p.businessStatus) ?? null;
    out.push({
      id: str(p.id, 120) ?? name,
      name,
      address: str(p.formattedAddress, 200),
      point: lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null,
      rating: num(p.rating),
      reviews: Math.max(0, Math.round(num(p.userRatingCount) ?? 0)),
      phone: str(p.nationalPhoneNumber, 40) ?? str(p.internationalPhoneNumber, 40),
      website: webUrl(p.websiteUri),
      mapsUrl: webUrl(p.googleMapsUri),
      openNow: typeof rec(p.regularOpeningHours).openNow === 'boolean' ? (rec(p.regularOpeningHours).openNow as boolean) : null,
      status,
      types: Array.isArray(p.types) ? p.types.filter((t): t is string => typeof t === 'string').slice(0, 6) : [],
    });
  }
  return out;
}

/** Only ordinary web links are ever shown as links. */
function webUrl(v: unknown): string | null {
  const s = str(v, 500);
  if (!s) return null;
  try {
    const u = new URL(s);
    return (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}

// --- judging and ranking --------------------------------------------------------------------------------

export function reviewLabel(rating: number | null, reviews: number): string {
  if (rating === null || reviews === 0) return 'No reviews yet';
  if (reviews < 10) return 'Few reviews';
  if (rating >= 4.3 && reviews >= 50) return 'Well reviewed';
  if (rating >= 4 && reviews >= 15) return 'Good reviews';
  if (rating < 3.5) return 'Poorly reviewed';
  return 'Mixed reviews';
}

function noteFor(h: StoreHit): string {
  const parts: string[] = [];
  if (h.rating !== null && h.reviews > 0) parts.push(`${h.rating.toFixed(1)}★ from ${h.reviews.toLocaleString('en-US')} Google review${h.reviews === 1 ? '' : 's'}`);
  if (h.status === 'CLOSED_TEMPORARILY') parts.push('temporarily closed');
  else if (h.openNow === true) parts.push('open now');
  else if (h.openNow === false) parts.push('closed right now');
  if (h.address) parts.push(h.address);
  return parts.join(' · ');
}

const kmText = (km: number) => (km < 1 ? 'under 1 km away' : `${km < 10 ? km.toFixed(1) : Math.round(km)} km away`);

/** Drop what has closed for good, attach distance and a plain review label, and sort: nearest first (poorly reviewed or closed ones last). */
export function rankStores(hits: readonly StoreHit[], origin: Point | null): StoreView[] {
  const views = hits
    .filter((h) => h.status !== 'CLOSED_PERMANENTLY')
    .map<StoreView>((h) => {
      const host = h.website ? new URL(h.website).hostname.replace(/^www\./, '') : null;
      return { ...h, distanceKm: origin && h.point ? Math.round(haversineKm(origin, h.point) * 10) / 10 : null, label: reviewLabel(h.rating, h.reviews), note: noteFor(h), siteKind: host ? sellerKind(host) : null };
    });
  const demoted = (v: StoreView) => (v.status === 'CLOSED_TEMPORARILY' || v.label === 'Poorly reviewed' ? 1 : 0);
  // Keep Google's own order (relevance) among stores we can't measure; otherwise nearest first.
  return views
    .map((v, i) => ({ v, i }))
    .sort((a, b) => demoted(a.v) - demoted(b.v) || (a.v.distanceKm !== null && b.v.distanceKm !== null ? a.v.distanceKm - b.v.distanceKm : a.i - b.i))
    .map((x) => x.v);
}

/** The facts to say first, no pick made for the person. */
export function highlightsOf(stores: readonly StoreView[]): string[] {
  const out: string[] = [];
  const open = stores.filter((s) => s.status !== 'CLOSED_TEMPORARILY');
  const closest = open.filter((s) => s.distanceKm !== null).sort((a, b) => (a.distanceKm as number) - (b.distanceKm as number))[0];
  if (closest && closest.distanceKm !== null) out.push(`Closest: ${closest.name}, ${kmText(closest.distanceKm)}${closest.rating !== null && closest.reviews >= 5 ? `, ${closest.rating.toFixed(1)}★` : ''}.`);
  const best = open.filter((s) => s.rating !== null && s.reviews >= 20).sort((a, b) => (b.rating as number) - (a.rating as number) || b.reviews - a.reviews)[0];
  if (best && best.rating !== null) out.push(`Best reviewed: ${best.name}, ${best.rating.toFixed(1)}★ from ${best.reviews.toLocaleString('en-US')} reviews${best.distanceKm !== null ? `, ${kmText(best.distanceKm)}` : ''}.`);
  return out;
}

export const MAX_STORES = 4;

/** The shopping-list options for the best of these stores. */
export function storeOptions(stores: readonly StoreView[], now: Date): OptionSnap[] {
  return stores.slice(0, MAX_STORES).map((s) => ({
    source: 'store' as const,
    name: s.name,
    handle: null,
    url: s.website,
    mapsUrl: s.mapsUrl,
    rating: null,
    label: s.label,
    distanceKm: s.distanceKm,
    price: null,
    phone: s.phone,
    whatsapp: null,
    note: [s.note, s.siteKind === 'official' ? 'Its site is the brand’s own.' : null].filter(Boolean).join(' '),
    checkedAt: now.toISOString(),
  }));
}
