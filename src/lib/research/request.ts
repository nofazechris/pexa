import type { Platform, ResearchKind, ResearchRequest } from './types';

const clean = (s: string, max: number) => s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** Trades, crafts and creative services — found on Instagram far more than on LinkedIn. */
const TRADE = /\b(tailors?|seamstress(?:es)?|fashion designers?|braiders?|hair ?(?:stylists?|dressers?)|barbers?|make-?up(?: artists?)?|mua|nail (?:techs?|artists?)|lash(?:es)? (?:techs?|artists?)|photographers?|videographers?|caterers?|bakers?|chefs?|decorators?|event planners?|djs?|mcs?|mechanics?|plumbers?|electricians?|carpenters?|painters?|cleaners?|drivers?|tutors?|henna|tattoo(?: artists?)?|masseu(?:r|se)s?|stylists?)\b/i;

const ALL: readonly Platform[] = ['instagram', 'tiktok', 'x', 'linkedin'];
const SELLER_PLATFORMS: readonly Platform[] = ['instagram', 'tiktok', 'x'];

/** The platforms named, in a known order and without repeats. Accepts the old single `source` too. */
function platformsFrom(input: { platforms?: unknown; source?: unknown }): Platform[] {
  const raw = Array.isArray(input.platforms) ? input.platforms : typeof input.platforms === 'string' ? input.platforms.split(/[,\s]+/) : input.source ? [input.source] : [];
  const named = new Set(raw.map((p) => String(p).toLowerCase().trim()));
  if (named.has('all') || named.has('everywhere')) SELLER_PLATFORMS.forEach((p) => named.add(p));
  return ALL.filter((p) => named.has(p));
}

export type NormalizeResult = { ok: true; request: ResearchRequest } | { ok: false; message: string; missing: 'what' | 'place' | 'platform' };

/**
 * Tidy what the model proposed into a request, or say what's missing. For SELLERS the person chooses where to look — Instagram, TikTok
 * and/or X — and is asked if they haven't said; for people to hire, professionals default to LinkedIn and trades to Instagram.
 */
export function normalizeRequest(input: { kind?: unknown; platforms?: unknown; source?: unknown; what?: unknown; place?: unknown }): NormalizeResult {
  const kind: ResearchKind = input.kind === 'hire' ? 'hire' : 'vendors';
  const what = typeof input.what === 'string' ? clean(input.what, 80) : '';
  // "lagos" → "Lagos", "abuja nigeria" → "Abuja Nigeria".
  const place = typeof input.place === 'string' ? clean(input.place, 60).replace(/(^|\s)([a-z])/g, (_m, sp: string, c: string) => sp + c.toUpperCase()) : '';
  // "near me" / "closest" / "here" is not a place the search can use — the person still has to say (or share) where they are.
  const placeIsVague = /^(?:me|my area|my city|my location|near me|nearby|near by|around me|close to me|closest to me|closest|nearest|here|current location|where i am|your area)$/i.test(place.trim());
  if (placeIsVague) return { ok: false, missing: 'place', message: 'Which city or area are you in? I need a place to search near.' };
  if (what.length < 2) return { ok: false, missing: 'what', message: 'What are you looking for? For example “sneakers” or “a graphic designer”.' };
  if (!place) return { ok: false, missing: 'place', message: 'Which city or area? Results are far better with a place, e.g. Lagos.' };

  let platforms = platformsFrom(input);
  if (kind === 'vendors') {
    platforms = platforms.filter((p) => SELLER_PLATFORMS.includes(p));
    if (!platforms.length) return { ok: false, missing: 'platform', message: 'Which platform should I search for sellers — Instagram, TikTok or X?' };
  } else if (!platforms.length) {
    platforms = [TRADE.test(what) ? 'instagram' : 'linkedin'];
  } else if (TRADE.test(what)) {
    // Trades and creators are found on social networks, not LinkedIn.
    platforms = platforms.filter((p) => p !== 'linkedin');
    if (!platforms.length) platforms = ['instagram'];
  }
  return { ok: true, request: { kind, platforms, what, place } };
}
