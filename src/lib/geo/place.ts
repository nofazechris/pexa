/**
 * Places, as plain text. A person's area ("Yaba, Lagos") comes from their phone via a reverse lookup; a vendor's area comes
 * from what their profile says. Everything here is pure: turning an address into a short label, comparing two places by name,
 * and the straight-line distance between two points.
 */

/** The parts of an OpenStreetMap address we use (all optional; which exist varies by country). */
export interface OsmAddress {
  suburb?: string;
  neighbourhood?: string;
  quarter?: string;
  city_district?: string;
  borough?: string;
  village?: string;
  town?: string;
  city?: string;
  municipality?: string;
  county?: string;
  state?: string;
  country?: string;
}

const unique = (xs: (string | undefined)[]) => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    const t = x?.trim();
    if (t && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      out.push(t);
    }
  }
  return out;
};

/**
 * "Yaba, Lagos", "Bariga, Lagos", "Brooklyn, New York": the smallest area, the town if different, and the state or region —
 * at most three names, no postcodes, no street. Null when the address has nothing usable.
 */
export function placeLabel(a: OsmAddress): string | null {
  const area = a.suburb ?? a.neighbourhood ?? a.quarter ?? a.city_district ?? a.borough;
  const town = a.city ?? a.town ?? a.village ?? a.municipality ?? a.county;
  const stateName = a.state?.replace(/\s+state$/i, '').replace(/\s+province$/i, '');
  // Nigeria's capital territory is known by its city: "Karum, Federal Capital Territory" should read "Karum, Abuja".
  const region = stateName === 'Federal Capital Territory' ? 'Abuja' : stateName;
  const parts = unique([area, town, region]).slice(0, 3);
  // A label of one name is only worth having if it is a real place name.
  return parts.length ? parts.join(', ') : null;
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** The names in a place: "Yaba, Lagos" → ["Yaba", "Lagos"]. */
export function placeParts(place: string): string[] {
  return place
    .split(/[,/|·•]/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 2);
}

export type Nearness = 'area' | 'city' | 'other' | 'unknown';

/**
 * How close a place named in a profile ("Surulere, Lagos", "📍 Ikeja") is to the person's area, by name alone:
 * `area` = it names their neighbourhood, `city` = same city or region, `other` = a place that isn't theirs, `unknown` = none given.
 */
export function nearness(text: string | null | undefined, place: string): Nearness {
  const t = text?.trim();
  if (!t) return 'unknown';
  const hay = fold(t);
  const parts = placeParts(place).map(fold);
  if (!parts.length) return 'other';
  const areaNames = parts.length > 1 ? parts.slice(0, -1) : [];
  const has = (n: string) => n.length >= 3 && new RegExp(`(^|[^a-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(hay);
  if (areaNames.some(has)) return 'area';
  if (parts.some(has)) return 'city';
  return 'other';
}

export interface Point {
  lat: number;
  lon: number;
}

/** Straight-line distance in kilometres. */
export function haversineKm(a: Point, b: Point): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** "under 1 km away", "about 4 km away", "about 120 km away". */
export function distanceText(km: number): string {
  if (km < 1) return 'under 1 km away';
  if (km < 10) return `about ${Math.round(km)} km away`;
  return `about ${Math.round(km / 5) * 5} km away`;
}

/** Latitude and longitude as sent by a phone, kept to a neighbourhood (about 1 km), or null if they aren't real coordinates. */
export function roundedPoint(lat: unknown, lon: unknown): Point | null {
  const la = typeof lat === 'string' ? Number(lat) : lat;
  const lo = typeof lon === 'string' ? Number(lon) : lon;
  if (typeof la !== 'number' || typeof lo !== 'number' || !Number.isFinite(la) || !Number.isFinite(lo)) return null;
  if (Math.abs(la) > 90 || Math.abs(lo) > 180) return null;
  return { lat: Math.round(la * 100) / 100, lon: Math.round(lo * 100) / 100 };
}
