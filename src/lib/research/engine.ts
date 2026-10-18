/**
 * The research plan, as pure logic: what to buy first, what to buy next given what came back, and how the answers become a
 * shortlist. The server runs these decisions one purchase at a time (each signed by the user's own wallet inside a budget the
 * user approved); this file never touches the network, so every branch is testable.
 */
import { cityOf, searchKeywords, themeFor } from './commerce';
import { igCandidates, igProfile, liPeople, xTweets, type IgCandidate } from './read';
import { applyRatings, rankByRating, stars } from './rate';
import { scoreLinkedIn } from './score';
import { groupSellers, type XSeller } from './sellers';
import { scoreInstagram, scoreXSeller } from './vendor';
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
export const MAX_CHECKS = 4;
/** If the first Instagram search turns up fewer accounts than this, search again under the name sellers use. */
const MIN_ACCOUNTS = 3;
/** How many X accounts make the shortlist (their profile arrives with the search, so they cost nothing extra). */
const MAX_X = 4;
/** The longest shortlist shown. */
const MAX_ITEMS = 6;
/** Hard stop on purchases in one research, whatever happens. */
export const MAX_PURCHASES = 8;
/** The ceiling a research can ever have, even if asked for more. */
export const RESEARCH_HARD_CAP_ATOMIC = 250_000n; // $0.25

/** Rough prices, only for the estimate shown before anything is bought. The real price is quoted per purchase. */
const EST = { igSearch: 7_000n, igProfile: 5_000n, xSearch: 5_000n, liSearch: 103_000n };

export function capFor(req: ResearchRequest): bigint {
  return req.source === 'linkedin' ? 150_000n : 100_000n;
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
      `Search Instagram and X for sellers of ${req.what}${where}, and leave out anything that isn’t actually selling it`,
      `Look inside the top ${MAX_CHECKS} Instagram accounts: posts, followers, account age, red flags (no posts, “old account disabled”, tiny new pages)`,
      'Rate each one out of 5 and rank by that and distance, with the prices and the phone, WhatsApp or email they published — nothing is paid to anyone',
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

/** Accounts worth spending a lookup on: skip names that say they are a cleaning/repair/lesson page, then those naming the product, public, verified. */
export function rankCandidates(cands: readonly IgCandidate[], what: string): IgCandidate[] {
  const theme = themeFor(what);
  const nameText = (c: IgCandidate) => `${c.username.replace(/[._]/g, ' ')} ${c.fullName ?? ''} ${c.bio ?? ''}`;
  const looksAdjacent = (c: IgCandidate) => theme.adjacent.test(nameText(c)) && !/\b(?:store|shop|plug|stock|sell|sales|collection)\b/i.test(nameText(c));
  const relevance = (c: IgCandidate) => (theme.product.test(nameText(c)) ? 1 : 0);
  return cands
    .filter((c) => !looksAdjacent(c))
    .map((c, i) => ({ c, i }))
    .sort((a, b) => Number(a.c.isPrivate === true) - Number(b.c.isPrivate === true) || relevance(b.c) - relevance(a.c) || Number(b.c.verified === true) - Number(a.c.verified === true) || a.i - b.i)
    .map((x) => x.c);
}

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

/** Every X author in the results, judged: sellers of the thing, nearby services, and everyone else. */
export function foundXSellers(steps: readonly StepState[], req: ResearchRequest): XSeller[] {
  const tweets = paidOutputs(steps, 'xsearch').flatMap((s) => xTweets(s.output));
  return groupSellers(tweets, themeFor(req.what), req.place);
}

/** The X search: tweets that look like selling posts (or, for people to hire, offers of work) for this in this city. */
export function xQuery(req: ResearchRequest): string {
  const city = cityOf(req.place);
  const intent = req.kind === 'hire' ? '(hire OR available OR portfolio OR "dm for" OR booking)' : '("for sale" OR price OR "dm to order" OR "order now" OR available)';
  return `(${req.what}) ${intent} ${city}`.replace(/\s+/g, ' ').trim().slice(0, 300);
}

const xStep = (req: ResearchRequest): Next => ({ action: 'buy', role: 'xsearch', capabilityId: SERVICE.xSearch, input: { query: xQuery(req), type: 'latest' }, ref: null, label: `Searching X for ${req.what}${req.place ? ` in ${req.place}` : ''}` });

export function decideNext(req: ResearchRequest, steps: readonly StepState[]): Next {
  if (steps.length >= MAX_PURCHASES) return { action: 'finish', reason: 'limit' };
  if (steps.some((s) => s.outcome === 'UNCERTAIN')) return { action: 'finish', reason: 'uncertain' };

  const searches = steps.filter((s) => s.role === 'search' || s.role === 'fallback');
  const xTried = steps.some((s) => s.role === 'xsearch');
  const where = req.place ? ` in ${req.place}` : '';
  const keywords = searchKeywords(req.what, req.place, themeFor(req.what), req.kind);
  const xAuthors = foundXSellers(steps, req).length;
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
    if (!paid.length && xAuthors === 0) return { action: 'finish', reason: 'search_failed' };
    const liFound = paid.flatMap((s) => liPeople(s.output)).length;
    return { action: 'finish', reason: liFound === 0 && xAuthors === 0 && anyContent ? 'unreadable' : 'done' };
  }

  // Instagram: search, then X, then (if few accounts turned up) the same thing under the name sellers use, then look inside the best few.
  if (searches.length === 0) {
    return { action: 'buy', role: 'search', capabilityId: SERVICE.igSearch, input: { queryParams: { keyword: keywords[0] } }, ref: null, label: `Searching Instagram for ${req.what}${where}` };
  }
  if (!xTried) return xStep(req);

  const found = foundAccounts(steps);
  if (found.length < MIN_ACCOUNTS && keywords.length > 1 && searches.length < 2) {
    return { action: 'buy', role: 'fallback', capabilityId: SERVICE.igSearch, input: { queryParams: { keyword: keywords[1] } }, ref: null, label: `Searching Instagram again: “${keywords[1]}”` };
  }
  const anySearchPaid = searches.some((s) => s.outcome === 'PAID');
  if (!anySearchPaid && searches.every((s) => s.outcome === 'FAILED')) return { action: 'finish', reason: xAuthors > 0 ? 'done' : 'search_failed' };
  // An answer with plenty in it that we still found nobody in is one we can't read — more searches would be read the same way, so don't pay for them.
  if (found.length === 0 && xAuthors === 0 && anyContent) return { action: 'finish', reason: 'unreadable' };

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

/** One sentence for the top of the shortlist: how many, and the best one. */
export function buildSummary(req: ResearchRequest, items: readonly ResearchItem[], reason: FinishReason, market: MarketPrice | null = null, skipped = 0): string {
  const where = req.place ? ` in ${req.place}` : '';
  if (!items.length) {
    if (reason === 'unreadable') return `I got a response for ${req.what}${where} but couldn’t read it properly — that’s on my side, not yours. I stopped there so it cost no more.`;
    if (reason === 'search_failed') return `I couldn’t get results for ${req.what}${where} just now, and you weren’t charged for anything that failed. Try again in a moment.`;
    if (skipped > 0) return `I found accounts that came up for “${req.what}”${where}, but none of them actually sells it (see what I left out below). Try different words, or a bigger nearby city.`;
    return `I didn’t find anyone for “${req.what}”${where}. Try different words or a bigger nearby city.`;
  }
  const best = items[0];
  const who = best.handle ?? best.name;
  const km = best.distanceKm !== null ? (best.distanceKm < 1 ? ', under 1 km from you' : `, about ${Math.round(best.distanceKm)} km from you`) : best.nearness === 'area' ? ', in your area' : best.nearness === 'city' ? `, in ${best.location ?? 'your city'}` : '';
  const strong = items.some((i) => i.verdict === 'solid');
  const score = best.rating ? `${stars(best.rating.overall)}/5, ` : '';
  const typical = market ? ` Typical price: ${market.text}.` : '';
  return strong
    ? `Found ${items.length} for ${req.what}${where}. Best rated: ${who} (${score}${best.verdictLabel.toLowerCase()}${km}).${typical}`
    : `Found ${items.length} for ${req.what}${where}, but none is well established — ${who} rates best (${score}${best.verdictLabel.toLowerCase()}${km}). Be careful and check before you spend.${typical}`;
}

/** The notes about what was left out: named when it was a nearby service, counted when it simply wasn't selling. */
export function skippedNote(skipped: readonly { name: string; reason: string }[]): string | null {
  if (!skipped.length) return null;
  const named = skipped.filter((s) => /service|related/i.test(s.reason)).slice(0, 3);
  const rest = skipped.length - named.length;
  const parts = named.map((s) => `${s.name} (${s.reason.replace(/^Looks like a /, 'looks like a ')})`);
  if (rest > 0) parts.push(`${rest} other account${rest === 1 ? '' : 's'} that ${rest === 1 ? 'isn’t' : 'aren’t'} selling it`);
  return `Left out: ${parts.join('; ')}.`;
}

/** The shortlist from everything bought: only accounts that sell what was asked for, rated and ranked (distances are added by the server). */
export function assemble(req: ResearchRequest, steps: readonly StepState[], reason: FinishReason, now: Date): ResearchResult {
  const spent = dollars(spentOn(steps));
  const notes: string[] = [];
  const all: ResearchItem[] = [];

  if (req.source === 'linkedin') {
    all.push(...paidOutputs(steps, 'search').flatMap((s) => liPeople(s.output)).map((p) => scoreLinkedIn(p, { what: req.what, place: req.place }, now)));
    notes.push('Ask for past work or a reference before you pay anyone you haven’t met.');
  } else {
    const found = foundAccounts(steps);
    const vetted = new Map<string, ReturnType<typeof igProfile>>();
    for (const s of steps) if (s.role === 'vet' && s.outcome === 'PAID' && s.ref) vetted.set(s.ref, igProfile(s.output));
    const lookedAt = found.filter((c) => steps.some((s) => s.role === 'vet' && s.ref === c.username));
    all.push(...lookedAt.map((c) => scoreInstagram(c, vetted.get(c.username) ?? null, now, req.place, req.what)));
    const unchecked = rankCandidates(found, req.what).filter((c) => !lookedAt.includes(c)).length;
    if (unchecked > 0) notes.push(`I found ${unchecked} more Instagram account${unchecked === 1 ? '' : 's'} but only looked inside the top ${lookedAt.length} to keep the cost down. Ask me to look further if you want.`);
    if (lookedAt.some((c) => !vetted.get(c.username))) notes.push('For some Instagram accounts the lookup came back empty, so I can’t say how active they are.');
  }
  const sellers = foundXSellers(steps, req);
  const xItems = sellers.map((s) => scoreXSeller(s, { what: req.what, place: req.place }, req.kind, now));
  // X: show the selling accounts (best-evidenced first), and keep the others only to say what was left out.
  const xMatches = xItems.filter((i) => i.relevance === 'match').sort((a, b) => (b.stats.length ? 1 : 0) - (a.stats.length ? 1 : 0)).slice(0, MAX_X);
  all.push(...xMatches, ...xItems.filter((i) => i.relevance !== 'match'));

  // Only accounts that sell what was asked for are shown; the rest are named (services) or counted (not selling) so nothing vanishes silently.
  const shown = all.filter((i) => i.relevance === 'match');
  const skipped: { name: string; reason: string }[] = [];
  let unrelated = 0;
  for (const i of all) {
    if (i.relevance === 'adjacent') skipped.push({ name: i.handle ?? i.name, reason: i.skipReason ?? 'not a seller of this' });
    else if (i.relevance === 'unrelated') unrelated++;
  }
  if (unrelated > 0) skipped.push({ name: `${unrelated} other account${unrelated === 1 ? '' : 's'}`, reason: 'weren’t selling it' });

  const rated = applyRatings(shown, { what: req.what, place: req.place, kind: req.kind });
  const ranked = rankByRating(rated.items).slice(0, MAX_ITEMS);
  if (ranked.some((i) => i.contact.phone || i.contact.email)) notes.push('Phone numbers and emails shown are only what each person published on their own profile.');
  if (ranked.length && ranked.every((i) => i.nearness === 'unknown' || i.nearness === 'other')) notes.push('None of them shows a location near you — ask each one where they are before you commit.');
  const left = skippedNote(skipped);
  if (left) notes.push(left);
  notes.push(BASE_NOTE);
  if (reason === 'uncertain') notes.unshift('One payment didn’t confirm, so I stopped. It may have gone through — check Purchases & receipts before searching again.');
  if (reason === 'limit') notes.unshift('I stopped at my purchase limit for one search.');
  if (reason === 'unreadable') notes.unshift('The search did answer, but in a shape I couldn’t read reliably, so I didn’t spend more on it. The raw answer is saved under Purchases.');

  return { request: req, summary: buildSummary(req, ranked, reason, rated.market, skipped.length), items: ranked, notes, spent, market: rated.market, skipped };
}
