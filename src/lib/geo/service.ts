import 'server-only';
import { placeLabel, roundedPoint, type OsmAddress, type Point } from './place';

/** A found place: its point, and how specific it is (a country or state is too big to measure a distance to). */
export interface Found extends Point {
  precise: boolean;
}

/**
 * Place lookups through OpenStreetMap's public Nominatim service (free, no key). Used for two small things:
 *   • turn a phone's position into an area name ("Yaba, Lagos") — the position is rounded to about 1 km first, is never
 *     stored, and only the name goes anywhere else;
 *   • turn a vendor's stated area into a point, so we can say roughly how far away they are.
 * Nominatim asks for at most one request a second and a real User-Agent, so calls are spaced out and cached. Every call
 * fails soft: no answer means "no distance" or "type your city", never an error for the person.
 */

const BASE = 'https://nominatim.openstreetmap.org';
const HEADERS = { 'user-agent': 'Pexa/1.0 (https://pexaapp.xyz)', 'accept-language': 'en' };
const TIMEOUT_MS = 6000;
const GAP_MS = 1100;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE = 500;

let chain: Promise<unknown> = Promise.resolve();
let lastCallAt = 0;

/** Run `fn` after every earlier lookup and at least GAP_MS after the previous request. */
function spaced<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = lastCallAt + GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCallAt = Date.now();
    return fn();
  });
  chain = run.catch(() => undefined);
  return run;
}

const cache = new Map<string, { at: number; value: unknown }>();
function remember<T>(key: string, value: T): T {
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: Date.now(), value });
  return value;
}
function recall<T>(key: string): { hit: true; value: T } | { hit: false } {
  const c = cache.get(key);
  return c && Date.now() - c.at < CACHE_TTL_MS ? { hit: true, value: c.value as T } : { hit: false };
}

/** The area name for a position ("Yaba, Lagos"), or null if it can't be worked out. */
export async function reverseGeocode(lat: unknown, lon: unknown): Promise<string | null> {
  const p = roundedPoint(lat, lon);
  if (!p) return null;
  const key = `r:${p.lat},${p.lon}`;
  const hit = recall<string | null>(key);
  if (hit.hit) return hit.value;
  try {
    const res = await spaced(() => fetch(`${BASE}/reverse?format=jsonv2&zoom=14&addressdetails=1&lat=${p.lat}&lon=${p.lon}`, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) }));
    if (!res.ok) return null;
    const j = (await res.json()) as { address?: OsmAddress };
    return remember(key, j.address ? placeLabel(j.address) : null);
  } catch {
    return null;
  }
}

/** A point for a place named in text ("Surulere, Lagos"), or null. */
export async function geocode(text: string): Promise<Found | null> {
  const q = text.replace(/\s+/g, ' ').trim().slice(0, 120);
  if (q.length < 3) return null;
  const key = `f:${q.toLowerCase()}`;
  const hit = recall<Found | null>(key);
  if (hit.hit) return hit.value;
  try {
    const res = await spaced(() => fetch(`${BASE}/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) }));
    if (!res.ok) return null;
    const j = (await res.json()) as { lat?: string; lon?: string; addresstype?: string }[];
    const first = j[0];
    const lat = first ? Number(first.lat) : NaN;
    const lon = first ? Number(first.lon) : NaN;
    const precise = !['country', 'state', 'region', 'province', 'continent'].includes(first?.addresstype ?? '');
    return remember(key, Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon, precise } : null);
  } catch {
    return null;
  }
}
