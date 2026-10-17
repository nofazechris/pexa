/**
 * The research plan, as pure logic: what to buy first, what to buy next given what came back, and how the answers become a
 * shortlist. The server runs these decisions one purchase at a time (each signed by the user's own wallet inside a budget the
 * user approved); this file never touches the network, so every branch is testable.
 */
import { nearness } from '@/lib/geo/place';
import { igCandidates, igProfile, liPeople, xPeople, type IgCandidate, type XPerson } from './read';
import { applyRatings, rankByRating, stars } from './rate';
import { scoreInstagram, scoreLinkedIn, scoreX } from './score';
import type { MarketPrice, ResearchItem, ResearchRequest, ResearchResult } from './types';

/** The only Buy services research may spend on. Anything else is refused, whatever the model or a poisoned result suggests. */
export const SERVICE = {
  igSearch: 'monid.instagram.tikhub.api-v1-instagram-v2-search-users',
  igGeneral: 'monid.instagram.tikhub.api-v1-instagram-v2-general-search',
  igProfile: 'instagram.profile',
  xSearch: 'x.posts.search',
  liSearch: 'monid.linkedin.apify.harvestapi-linkedin-profile-search-by-services',
} as const;

export const ALLOWED_SERVICES: ReadonlySet<string> = new Set(Object.values(SERVICE));

/** How many Instagram accounts get a closer look. */
export const MAX_CHECKS = 3;
/** How many X accounts make the shortlist (their profile arrives with the search, so they cost nothing extra). */
const MAX_X = 4;
/** The longest shortlist shown. */
const MAX_ITEMS = 6;
/** Hard stop on purchases in one research, whatever happens. */
export const MAX_PURCHASES = 7;
/** The ceiling a research can ever have, even if asked for more. */
export const RESEARCH_HARD_CAP_ATOMIC = 250_000n; // $0.25

/** Rough prices, only for the estimate shown before anything is bought. The real price is quoted per purchase. */
const EST = { igSearch: 7_000n, igProfile: 5_000n, xSearch: 5_000n, liSearch: 103_000n };

export function capFor(req: ResearchRequest): bigint {
  return req.source === 'linkedin' ? 150_000n : 80_000n;
}

/** "$0.022", "$0.06", "$0.103": two decimals at least, thousandths when needed. */
export function dollars(atomic: bigint | number | string): string {
  const n = Number(atomic) / 1e6;
  const s = n.toFixed(3).replace(/0$/, '');
  return `$${s}`;
}

export interface PlanText {
  title: string;
  steps: string[];
  estimate: string;
  cap: string;
  capAtomic: bigint;
}

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function describePlan(req: ResearchRequest): PlanText {
  const where = req.place ? ` in ${req.place}` : '';
  const capAtomic = capFor(req);
  if (req.source === 'linkedin') {
    return {
      title: `Find ${req.what}${where}`,
      steps: [`Search LinkedIn and X for ${req.what}${where}`, 'Compare them on fit, how close they are to you, and how complete their profile is', 'Give you a shortlist with the phone, WhatsApp or email they published — nothing is paid to anyone'],
      estimate: dollars(EST.liSearch + EST.xSearch),
      cap: dollars(capAtomic),
      capAtomic,
    };
  }
  return {
    title: sentence(req.kind === 'hire' ? `find ${req.what}${where}` : `find sellers of ${req.what}${where}`),
    steps: [
      `Search Instagram and X for ${req.what}${where}`,
      `Look inside the top ${MAX_CHECKS} Instagram accounts: how active, how established, whether the following looks real`,
      'Rank them by how solid they look and how close they are to you, with the phone, WhatsApp or email they published — nothing is paid to anyone',
    ],
    estimate: dollars(EST.igSearch + EST.xSearch + EST.igProfile * BigInt(MAX_CHECKS)),
    cap: dollars(capAtomic),
    capAtomic,
  };
}

// --- deciding the next purchase -----------------------------------------------------------------------------

export type StepRole = 'search' | 'xsearch' | 'fallback' | 'vet';
export type StepOutcome = 'OPEN' | 'PAID' | 'UNCERTAIN' | 'FAILED';

/** One purchase made (or being made) for this research, with what it returned once paid. */
export interface StepState {
  role: StepRole;
  /** The account a `vet` step looked at. */
  ref: string | null;
  outcome: StepOutcome;
  priceAtomic: bigint;
  output?: unknown;
}

export type FinishReason = 'done' | 'search_failed' | 'uncertain' | 'limit' | 'unreadable';

export type Next =
  | { action: 'buy'; role: StepRole; capabilityId: string; input: Record<string, unknown>; ref: string | null; label: string }
  | { action: 'finish'; reason: FinishReason };

/** Words in a request, reduced to a stem so "sneakers" matches "sneaker_plug". */
const stems = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3)
    .map((w) => (w.length > 4 ? w.replace(/(?:es|s)$/, '') : w));

/** Accounts worth looking at first: public ones, ones whose name or bio matches what was asked for, verified ones. */
export function rankCandidates(cands: readonly IgCandidate[], what: string): IgCandidate[] {
  const wanted = stems(what);
  const relevance = (c: IgCandidate) => {
    const text = `${c.username} ${c.fullName ?? ''} ${c.bio ?? ''}`.toLowerCase();
    return wanted.filter((w) => text.includes(w)).length;
  };
  return cands
    .map((c, i) => ({ c, i }))
    .sort((a, b) => Number(a.c.isPrivate === true) - Number(b.c.isPrivate === true) || relevance(b.c) - relevance(a.c) || Number(b.c.verified === true) - Number(a.c.verified === true) || a.i - b.i)
    .map((x) => x.c);
}

/** X accounts worth showing: bio or name matching the request, then nearer the person, then bigger. */
export function rankXPeople(people: readonly XPerson[], req: ResearchRequest): XPerson[] {
  const wanted = stems(req.what);
  const relevance = (p: XPerson) => {
    const text = `${p.bio ?? ''} ${p.name ?? ''}`.toLowerCase();
    return wanted.filter((w) => text.includes(w)).length;
  };
  const near = (p: XPerson) => ({ area: 0, city: 1, unknown: 2, other: 3 })[nearness(p.location, req.place)];
  return people
    .map((p, i) => ({ p, i }))
    .sort((a, b) => relevance(b.p) - relevance(a.p) || near(a.p) - near(b.p) || (b.p.followers ?? 0) - (a.p.followers ?? 0) || a.i - b.i)
    .map((x) => x.p);
}

const keyword = (req: ResearchRequest) => `${req.what} ${req.place.replace(/,/g, ' ')}`.replace(/\s+/g, ' ').trim().slice(0, 120);

/** Does a reply carry real data (rather than an empty list or a short message)? */
export function hasContent(output: unknown): boolean {
  try {
    return JSON.stringify(output ?? null).length > 240;
  } catch {
    return false;
  }
}

const paidOutputs = (steps: readonly StepState[], ...roles: StepRole[]) => steps.filter((s) => s.outcome === 'PAID' && roles.includes(s.role));

/** All the Instagram accounts any paid search returned. */
export function foundAccounts(steps: readonly StepState[]): IgCandidate[] {
  const seen = new Set<string>();
  const out: IgCandidate[] = [];
  for (const s of paidOutputs(steps, 'search', 'fallback')) {
    for (const c of igCandidates(s.output)) {
      if (!seen.has(c.username)) {
        seen.add(c.username);
        out.push(c);
      }
    }
  }
  return out;
}

/** All the X accounts the people search returned. */
export function foundXPeople(steps: readonly StepState[]): XPerson[] {
  const seen = new Set<string>();
  const out: XPerson[] = [];
  for (const s of paidOutputs(steps, 'xsearch')) {
    for (const p of xPeople(s.output)) {
      if (!seen.has(p.username)) {
        seen.add(p.username);
        out.push(p);
      }
    }
  }
  return out;
}

const xStep = (req: ResearchRequest): Next => ({ action: 'buy', role: 'xsearch', capabilityId: SERVICE.xSearch, input: { query: keyword(req), type: 'people' }, ref: null, label: `Searching X for ${req.what}${req.place ? ` in ${req.place}` : ''}` });

export function decideNext(req: ResearchRequest, steps: readonly StepState[]): Next {
  if (steps.length >= MAX_PURCHASES) return { action: 'finish', reason: 'limit' };
  if (steps.some((s) => s.outcome === 'UNCERTAIN')) return { action: 'finish', reason: 'uncertain' };

  const searches = steps.filter((s) => s.role === 'search' || s.role === 'fallback');
  const xTried = steps.some((s) => s.role === 'xsearch');
  const where = req.place ? ` in ${req.place}` : '';
  const xFound = foundXPeople(steps).length;
  const anyContent = steps.some((s) => s.outcome === 'PAID' && hasContent(s.output));

  if (req.source === 'linkedin') {
    if (searches.length === 0) {
      return {
        action: 'buy',
        role: 'search',
        capabilityId: SERVICE.liSearch,
        input: { maxResults: 5, body: { profileScraperMode: 'Full', search: req.what.slice(0, 200), ...(req.place ? { locations: [req.place] } : {}) } },
        ref: null,
        label: `Searching LinkedIn for ${req.what}${where}`,
      };
    }
    if (!xTried) return xStep(req);
    const paid = searches.filter((s) => s.outcome === 'PAID');
    if (!paid.length && xFound === 0) return { action: 'finish', reason: 'search_failed' };
    const liFound = paid.flatMap((s) => liPeople(s.output)).length;
    return { action: 'finish', reason: liFound === 0 && xFound === 0 && anyContent ? 'unreadable' : 'done' };
  }

  // Instagram: search, then X people, (if nothing came back) one broader search, then look inside the best few accounts.
  if (searches.length === 0) {
    return { action: 'buy', role: 'search', capabilityId: SERVICE.igSearch, input: { queryParams: { keyword: keyword(req) } }, ref: null, label: `Searching Instagram for ${req.what}${where}` };
  }
  if (!xTried) return xStep(req);

  const found = foundAccounts(steps);
  const anySearchPaid = searches.some((s) => s.outcome === 'PAID');
  if (!anySearchPaid && searches.every((s) => s.outcome === 'FAILED')) {
    if (searches.length < 2) {
      return { action: 'buy', role: 'fallback', capabilityId: SERVICE.igGeneral, input: { queryParams: { keyword: keyword(req) } }, ref: null, label: 'Trying a wider Instagram search' };
    }
    return { action: 'finish', reason: xFound > 0 ? 'done' : 'search_failed' };
  }
  // An answer with plenty in it that we still found nobody in is one we can't read — a wider search would be read the same way, so don't pay for it.
  if (found.length === 0 && xFound === 0 && anyContent) return { action: 'finish', reason: 'unreadable' };
  if (found.length === 0 && xFound === 0 && searches.length < 2 && searches.every((s) => s.outcome === 'PAID')) {
    return { action: 'buy', role: 'fallback', capabilityId: SERVICE.igGeneral, input: { queryParams: { keyword: keyword(req) } }, ref: null, label: 'Nothing yet — trying a wider Instagram search' };
  }

  const targets = rankCandidates(found, req.what).slice(0, MAX_CHECKS);
  const looked = new Set(steps.filter((s) => s.role === 'vet').map((s) => s.ref));
  const next = targets.find((t) => !looked.has(t.username));
  if (next) {
    const n = looked.size + 1;
    return { action: 'buy', role: 'vet', capabilityId: SERVICE.igProfile, input: { username: next.username }, ref: next.username, label: `Checking @${next.username} (${n} of ${Math.min(MAX_CHECKS, targets.length)})` };
  }
  return { action: 'finish', reason: 'done' };
}

// --- the answer ---------------------------------------------------------------------------------------------

const spentOn = (steps: readonly StepState[]) => steps.filter((s) => s.outcome === 'PAID' || s.outcome === 'UNCERTAIN').reduce((a, s) => a + s.priceAtomic, 0n);

const BASE_NOTE = 'A public profile can show an account is active and looks real — it can’t prove they deliver. Ask for proof first (a video of the item, a past customer to speak to) and start small. Pexa only does the research; you deal with the seller yourself.';

/** One sentence for the top of the shortlist: how many, and the best one (nearest of the solid ones). */
export function buildSummary(req: ResearchRequest, items: readonly ResearchItem[], reason: FinishReason, market: MarketPrice | null = null): string {
  const where = req.place ? ` in ${req.place}` : '';
  if (!items.length) {
    if (reason === 'unreadable') return `I got a response for ${req.what}${where} but couldn’t read it properly — that’s on my side, not yours. I stopped there so it cost no more.`;
    if (reason === 'search_failed') return `I couldn’t get results for ${req.what}${where} just now, and you weren’t charged for anything that failed. Try again in a moment.`;
    return `I didn’t find anyone for “${req.what}”${where}. Try different words or a bigger nearby city.`;
  }
  const best = items[0];
  const who = best.handle ?? best.name;
  const km = best.distanceKm !== null ? (best.distanceKm < 1 ? ', under 1 km from you' : `, about ${Math.round(best.distanceKm)} km from you`) : best.nearness === 'area' ? ', in your area' : best.nearness === 'city' ? `, in ${best.location ?? 'your city'}` : '';
  const good = items.some((i) => i.verdict === 'solid');
  const score = best.rating ? `${stars(best.rating.overall)}/5, ` : '';
  const typical = market ? ` Typical price: ${market.text}.` : '';
  return good
    ? `Found ${items.length} for ${req.what}${where}. Best rated: ${who} (${score}${best.verdictLabel.toLowerCase()}${km}).${typical}`
    : `Found ${items.length} for ${req.what}${where}, but none stands out strongly — ${who} rates best (${score}${best.verdictLabel.toLowerCase()}${km}). Go carefully and check before you spend.${typical}`;
}

/** The shortlist from everything bought, ranked by trust then closeness (by name only — distances are added by the server). */
export function assemble(req: ResearchRequest, steps: readonly StepState[], reason: FinishReason, now: Date): ResearchResult {
  const spent = dollars(spentOn(steps));
  const notes: string[] = [];
  const items: ResearchItem[] = [];

  if (req.source === 'linkedin') {
    items.push(...paidOutputs(steps, 'search').flatMap((s) => liPeople(s.output)).map((p) => scoreLinkedIn(p, { what: req.what, place: req.place }, now)));
    notes.push('Ask for past work or a reference before you pay anyone you haven’t met.');
  } else {
    const found = foundAccounts(steps);
    const vetted = new Map<string, ReturnType<typeof igProfile>>();
    for (const s of steps) if (s.role === 'vet' && s.outcome === 'PAID' && s.ref) vetted.set(s.ref, igProfile(s.output));
    const lookedAt = rankCandidates(found, req.what).filter((c) => steps.some((s) => s.role === 'vet' && s.ref === c.username));
    items.push(...lookedAt.map((c) => scoreInstagram(c, vetted.get(c.username) ?? null, now, req.place, req.what)));
    const unchecked = found.length - lookedAt.length;
    if (unchecked > 0) notes.push(`I found ${unchecked} more Instagram account${unchecked === 1 ? '' : 's'} but only looked inside the top ${lookedAt.length} to keep the cost down. Ask me to look further if you want.`);
    if (lookedAt.some((c) => !vetted.get(c.username))) notes.push('For some Instagram accounts the lookup came back empty, so I can’t say how active they are.');
  }
  items.push(...rankXPeople(foundXPeople(steps), req).slice(0, MAX_X).map((p) => scoreX(p, { what: req.what, place: req.place }, req.kind, now)));

  const rated = applyRatings(items, { what: req.what, place: req.place, kind: req.kind });
  const ranked = rankByRating(rated.items).slice(0, MAX_ITEMS);
  if (ranked.some((i) => i.contact.phone || i.contact.email)) notes.push('Phone numbers and emails shown are only what each person published on their own profile.');
  if (ranked.length && ranked.every((i) => i.nearness === 'unknown' || i.nearness === 'other')) notes.push('None of them shows a location near you — ask each one where they are before you commit.');
  notes.push(BASE_NOTE);
  if (reason === 'uncertain') notes.unshift('One payment didn’t confirm, so I stopped. It may have gone through — check Purchases & receipts before searching again.');
  if (reason === 'limit') notes.unshift('I stopped at my purchase limit for one search.');
  if (reason === 'unreadable') notes.unshift('The search did answer, but in a shape I couldn’t read reliably, so I didn’t spend more on it. The raw answer is saved under Purchases.');

  return { request: req, summary: buildSummary(req, ranked, reason, rated.market), items: ranked, notes, spent, market: rated.market };
}
