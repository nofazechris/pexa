/**
 * The research plan, as pure logic: what to buy first, what to buy next given what came back, and how the answers become a
 * shortlist. The server runs these decisions one purchase at a time (each signed by the user's own wallet inside a budget the
 * user approved); this file never touches the network, so every branch is testable.
 *
 * Each platform the person chose is its own small pipeline — search, search again under the name sellers use if few turned up, then
 * look inside each promising account individually — and the answers are merged, rated and ranked together.
 */
import { candidatesFrom as stockCandidates, focusOf, postsFromSteps, stockQueries } from './stocks/build';
import { cityOf, searchKeywords, themeFor } from './commerce';
import { igCandidates, igProfile, liPeople, tiktokCandidates, tiktokProfile, xTweets, type IgCandidate } from './read';
import { mergeSameBusiness } from './dedupe';
import { applyRatings, rankByRating, stars } from './rate';
import { BROWSER_MINUTES } from '@/lib/shopping/browser';
import { placesBody } from '@/lib/shopping/stores';
import { scoreLinkedIn } from './score';
import { groupSellers, type XSeller } from './sellers';
import { scoreInstagram, scoreTikTok, scoreXSeller } from './vendor';
import type { MarketPrice, Platform, ResearchItem, ResearchRequest, ResearchResult, VendorMemoryView } from './types';

/** The only Buy services research may spend on. Anything else is refused, whatever the model or a poisoned result suggests. */
export const SERVICE = {
  igSearch: 'monid.instagram.tikhub.api-v1-instagram-v2-search-users',
  igProfile: 'instagram.profile',
  tiktokSearch: 'monid.tiktok.tikhub.api-v1-tiktok-web-fetch-search-user',
  tiktokProfile: 'tiktok.profile',
  xSearch: 'x.posts.search',
  xTimeline: 'monid.x.tikhub.api-v1-twitter-web-fetch-user-post-tweet',
  liSearch: 'monid.linkedin.apify.harvestapi-linkedin-profile-search-by-services',
  redditSearch: 'reddit.posts.search',
  browser: 'browser.sessions.create',
  places: 'google.places.search',
} as const;

export const ALLOWED_SERVICES: ReadonlySet<string> = new Set(Object.values(SERVICE));

const HOUR = 3600_000;

/**
 * How long an answer you already bought stays good enough to reuse instead of paying again. A profile changes slowly; a search
 * result list and a feed of recent posts go stale sooner. Zero means never reuse.
 */
export function freshForMs(capabilityId: string): number {
  switch (capabilityId) {
    case SERVICE.igProfile:
    case SERVICE.tiktokProfile:
    case SERVICE.liSearch:
      return 12 * HOUR;
    case SERVICE.igSearch:
    case SERVICE.tiktokSearch:
    case SERVICE.xSearch:
    case SERVICE.redditSearch:
      return 6 * HOUR;
    case SERVICE.xTimeline:
      return 3 * HOUR;
    case SERVICE.places:
      return 12 * HOUR; // shops and their reviews change slowly; the same question asked again today costs nothing
    default:
      return 0;
  }
}

/** How many Instagram / TikTok accounts get a closer look, each. */
export const MAX_CHECKS = 5;
/** How many X sellers get their own recent posts read. */
export const MAX_X_CHECKS = 3;
/** If the first search on a platform turns up fewer accounts than this, search again under the name sellers use. */
const MIN_ACCOUNTS = 3;
/** The longest shortlist shown. */
const MAX_ITEMS = 8;
/** How many X sellers make the shortlist. */
const MAX_X_SHOWN = 5;
/** Hard stop on purchases in one research, whatever happens. */
export const MAX_PURCHASES = 14;
/** The ceiling a research can ever have, even if asked for more. */
export const RESEARCH_HARD_CAP_ATOMIC = 250_000n; // $0.25

/** Rough prices, only for the estimate shown before anything is bought. The real price is quoted per purchase. */
const EST = { search: 7_000n, lookup: 5_000n, li: 103_000n };

/** Typical cost of researching on these platforms. */
export function estimateFor(platforms: readonly Platform[]): bigint {
  let total = 0n;
  for (const p of platforms) {
    if (p === 'linkedin') total += EST.li;
    else if (p === 'x') total += EST.lookup + EST.lookup * BigInt(MAX_X_CHECKS);
    else total += EST.search + EST.lookup * BigInt(MAX_CHECKS);
  }
  return total;
}

/** The most a research may spend: about twice the typical cost, never under $0.10 or over the hard cap. */
export function capFor(req: ResearchRequest): bigint {
  if (req.kind === 'stores') return 50_000n; // one search at four cents, with a little room
  if (req.kind === 'page') return 20_000n; // one short browser session, about four thousandths of a dollar
  if (req.kind === 'stocks') return 100_000n; // four searches at about half a cent each, with room to spare
  if (req.platforms.length === 1 && req.platforms[0] === 'linkedin') return 150_000n;
  const doubled = estimateFor(req.platforms) * 2n;
  const rounded = ((doubled + 9_999n) / 10_000n) * 10_000n;
  const cap = rounded < 100_000n ? 100_000n : rounded;
  return cap > RESEARCH_HARD_CAP_ATOMIC ? RESEARCH_HARD_CAP_ATOMIC : cap;
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

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www./, '');
  } catch {
    return 'that page';
  }
};
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const NAME: Record<Platform, string> = { instagram: 'Instagram', tiktok: 'TikTok', x: 'X', linkedin: 'LinkedIn', reddit: 'Reddit' };
const list = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

export function describePlan(req: ResearchRequest): PlanText {
  if (req.kind === 'stocks' && focusOf(req.what)) {
    const sym = focusOf(req.what);
    return {
      title: `Refresh the talk about $${sym}`,
      steps: [`Search X for the most-liked and the newest posts about $${sym} (two searches)`, `Search Reddit for $${sym} (one search)`, 'Count how many different people are talking, leaving out copy-pasted promotion, and compare with last time', 'Show it next to the stock’s price — nothing is bought or sold, and nothing here is advice'],
      estimate: dollars(15_000n),
      cap: dollars(100_000n),
      capAtomic: 100_000n,
    };
  }
  if (req.kind === 'stocks') {
    return {
      title: sentence(`research ${req.what} people are talking about`),
      steps: [
        'Search X for the most-liked and the newest posts about stocks (two searches)',
        'Search Reddit for what’s hot and the best-argued write-ups (two searches)',
        'Pick out the tickers that come up across different people, and leave out copy-pasted promotion',
        'Look up each ticker’s real price history (free, public data) to see whether the talk matches the price',
        'Show what the evidence says in plain words — nothing is bought or sold, and nothing here is advice',
      ],
      estimate: dollars(20_000n),
      cap: dollars(100_000n),
      capAtomic: 100_000n,
    };
  }
  if (req.kind === 'stores') {
    return {
      title: sentence(`find stores selling ${req.what}${req.place ? ` near ${req.place}` : ''}`),
      steps: [
        `Search Google Maps (through Buy) for “${placesBody(req.what, req.place).textQuery}”`,
        'Read each store’s address, rating and number of reviews, phone, website and whether it is open now',
        'Measure how far each is from you and put the nearest first — nothing is bought, and nothing is paid to a store',
      ],
      estimate: dollars(40_000n),
      cap: dollars(50_000n),
      capAtomic: 50_000n,
    };
  }
  if (req.kind === 'page') {
    const host = hostOf(req.what);
    return {
      title: `Read the page on ${host} in a private browser`,
      steps: [
        `Rent a private browser from Buy for ${BROWSER_MINUTES} minutes`,
        `Open ${host} in it and read the product name, the price and whether it is in stock`,
        'Close the browser, and keep what I read with your shopping list — nothing on the page is clicked, filled in or bought',
      ],
      estimate: dollars(4_212n),
      cap: dollars(20_000n),
      capAtomic: 20_000n,
    };
  }
  const where = req.place ? ` in ${req.place}` : '';
  const capAtomic = capFor(req);
  const names = list(req.platforms.map((p) => NAME[p]));
  const social = req.platforms.filter((p) => p !== 'linkedin' && p !== 'x');
  const steps = [`Search ${names} for ${req.kind === 'hire' ? req.what : `sellers of ${req.what}`}${where}${req.kind === 'vendors' ? ', and leave out anything that isn’t actually selling it' : ''}`];
  if (social.length) steps.push(`Look inside each promising ${list(social.map((p) => NAME[p]))} account one by one (up to ${MAX_CHECKS} each): activity, followers, account age, payment terms, red flags`);
  if (req.platforms.includes('x')) steps.push('Read the recent posts of the best X sellers themselves, not just the search hits');
  if (req.platforms.includes('linkedin')) steps.push('Compare the people LinkedIn returns on fit, closeness and how complete their profiles are');
  const lean = { closest: 'weighing how close they are most', cheapest: 'weighing price most', trusted: 'weighing trust most', balanced: '' }[req.priority ?? 'balanced'];
  const limit = req.radiusKm ? `, and keep only sellers measured within ${req.radiusKm} km (straight-line)` : '';
  steps.push(`Rate each one out of 5${lean ? `, ${lean}` : ''} and rank by that and distance${limit}, with the prices and the phone, WhatsApp or email they published — nothing is paid to anyone`);
  return {
    title: sentence(req.kind === 'hire' ? `find ${req.what}${where}` : `find sellers of ${req.what}${where}`),
    steps,
    estimate: dollars(estimateFor(req.platforms)),
    cap: dollars(capAtomic),
    capAtomic,
  };
}

// --- deciding the next purchase -----------------------------------------------------------------------------

export type StepRole = 'places' | 'browse' | 'search' | 'fallback' | 'vet' | 'tsearch' | 'tsearch2' | 'tvet' | 'xsearch' | 'xvet' | 'lsearch' | 'sx1' | 'sx2' | 'sr1' | 'sr2';
export type StepOutcome = 'OPEN' | 'PAID' | 'UNCERTAIN' | 'FAILED';

/** One purchase made (or being made) for this research, with what it returned once paid. */
export interface StepState {
  role: StepRole;
  /** The account a `vet`, `tvet` or `xvet` step looked at. */
  ref: string | null;
  outcome: StepOutcome;
  priceAtomic: bigint;
  output?: unknown;
}

export type FinishReason = 'done' | 'search_failed' | 'uncertain' | 'limit' | 'unreadable';

export type Next =
  | { action: 'buy'; role: StepRole; capabilityId: string; input: Record<string, unknown>; ref: string | null; label: string }
  | { action: 'finish'; reason: FinishReason };

/** Accounts worth spending a lookup on: skip names that say they are a cleaning/repair/lesson page; then verified, then naming the product, then public, then bigger. */
export function rankCandidates(cands: readonly IgCandidate[], what: string): IgCandidate[] {
  const theme = themeFor(what);
  const nameText = (c: IgCandidate) => `${c.username.replace(/[._]/g, ' ')} ${c.fullName ?? ''} ${c.bio ?? ''}`;
  const looksAdjacent = (c: IgCandidate) => theme.adjacent.test(nameText(c)) && !/\b(?:store|shop|plug|stock|sell|sales|collection)\b/i.test(nameText(c));
  const relevance = (c: IgCandidate) => (theme.product.test(nameText(c)) ? 1 : 0);
  return cands
    .filter((c) => !looksAdjacent(c))
    .map((c, i) => ({ c, i }))
    .sort(
      (a, b) =>
        Number(a.c.isPrivate === true) - Number(b.c.isPrivate === true) ||
        Number(b.c.verified === true) - Number(a.c.verified === true) ||
        relevance(b.c) - relevance(a.c) ||
        (b.c.followers ?? 0) - (a.c.followers ?? 0) ||
        a.i - b.i,
    )
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

function candidatesFrom(steps: readonly StepState[], roles: StepRole[], read: (o: unknown) => IgCandidate[]): IgCandidate[] {
  const seen = new Set<string>();
  const out: IgCandidate[] = [];
  for (const s of paidOutputs(steps, ...roles)) {
    for (const c of read(s.output)) {
      if (!seen.has(c.username)) {
        seen.add(c.username);
        out.push(c);
      }
    }
  }
  return out;
}

/** All the Instagram accounts any paid search returned. */
export const foundAccounts = (steps: readonly StepState[]) => candidatesFrom(steps, ['search', 'fallback'], igCandidates);
/** All the TikTok accounts any paid search returned. */
export const foundTikTok = (steps: readonly StepState[]) => candidatesFrom(steps, ['tsearch', 'tsearch2'], tiktokCandidates);

/** Every X author we have posts from — the search hits, plus the timelines we fetched — judged. */
export function foundXSellers(steps: readonly StepState[], req: ResearchRequest): XSeller[] {
  const tweets = [...paidOutputs(steps, 'xsearch').flatMap((s) => xTweets(s.output)), ...paidOutputs(steps, 'xvet').flatMap((s) => xTweets(s.output, s.ref ?? undefined))];
  const checked = new Set(paidOutputs(steps, 'xvet').map((s) => s.ref ?? ''));
  return groupSellers(tweets, themeFor(req.what), req.place, checked);
}

/** Every account this run has looked at, by platform — so what Pexa already knows about them can be loaded before they are scored. */
export function accountKeys(req: ResearchRequest, steps: readonly StepState[]): { platform: string; handle: string }[] {
  if (req.kind === 'stocks' || req.kind === 'page' || req.kind === 'stores') return [];
  const out: { platform: string; handle: string }[] = [];
  if (req.platforms.includes('instagram')) for (const s of steps) if (s.role === 'vet' && s.ref) out.push({ platform: 'instagram', handle: s.ref });
  if (req.platforms.includes('tiktok')) for (const s of steps) if (s.role === 'tvet' && s.ref) out.push({ platform: 'tiktok', handle: s.ref });
  if (req.platforms.includes('x')) for (const s of foundXSellers(steps, req)) out.push({ platform: 'x', handle: s.username });
  return out;
}

/** The X search: tweets that look like selling posts (or, for people to hire, offers of work) for this in this city. */
export function xQuery(req: ResearchRequest): string {
  const city = cityOf(req.place);
  const intent = req.kind === 'hire' ? '(hire OR available OR portfolio OR "dm for" OR booking)' : '("for sale" OR price OR "dm to order" OR "order now" OR available)';
  return `(${req.what}) ${intent} ${city}`.replace(/\s+/g, ' ').trim().slice(0, 300);
}

const buy = (role: StepRole, capabilityId: string, input: Record<string, unknown>, label: string, ref: string | null = null): Next => ({ action: 'buy', role, capabilityId, input, ref, label });

/** A social platform that is searched for accounts, then each promising one looked inside. */
function accountsNext(req: ResearchRequest, steps: readonly StepState[], c: { name: string; search: StepRole; again: StepRole; vet: StepRole; searchId: string; vetId: string; found: IgCandidate[]; vetInput: (u: string) => Record<string, unknown> }): Next | null {
  const keywords = searchKeywords(req.what, req.place, themeFor(req.what), req.kind === 'hire' ? 'hire' : 'vendors');
  const searches = steps.filter((s) => s.role === c.search || s.role === c.again);
  const where = req.place ? ` in ${req.place}` : '';
  if (searches.length === 0) return buy(c.search, c.searchId, { queryParams: { keyword: keywords[0] } }, `Searching ${c.name} for ${req.what}${where}`);
  if (c.found.length < MIN_ACCOUNTS && keywords.length > 1 && searches.length < 2) return buy(c.again, c.searchId, { queryParams: { keyword: keywords[1] } }, `Searching ${c.name} again: “${keywords[1]}”`);
  const targets = rankCandidates(c.found, req.what).slice(0, MAX_CHECKS);
  const looked = new Set(steps.filter((s) => s.role === c.vet).map((s) => s.ref));
  const next = targets.find((t) => !looked.has(t.username));
  if (!next) return null;
  return buy(c.vet, c.vetId, c.vetInput(next.username), `Checking ${c.name} @${next.username} (${looked.size + 1} of ${targets.length})`, next.username);
}

function xNext(req: ResearchRequest, steps: readonly StepState[]): Next | null {
  const where = req.place ? ` in ${req.place}` : '';
  if (!steps.some((s) => s.role === 'xsearch')) return buy('xsearch', SERVICE.xSearch, { query: xQuery(req), type: 'latest' }, `Searching X for ${req.what}${where}`);
  const looked = new Set(steps.filter((s) => s.role === 'xvet').map((s) => s.ref));
  const targets = foundXSellers(steps, req)
    .filter((s) => s.kind === 'seller')
    .sort((a, b) => (b.followers ?? 0) - (a.followers ?? 0))
    .slice(0, MAX_X_CHECKS);
  const next = targets.find((t) => !looked.has(t.username));
  if (!next) return null;
  return buy('xvet', SERVICE.xTimeline, { queryParams: { screen_name: next.username } }, `Reading @${next.username}’s recent posts on X (${looked.size + 1} of ${targets.length})`, next.username);
}

function linkedinNext(req: ResearchRequest, steps: readonly StepState[]): Next | null {
  if (steps.some((s) => s.role === 'lsearch')) return null;
  const where = req.place ? ` in ${req.place}` : '';
  return buy('lsearch', SERVICE.liSearch, { maxResults: 5, body: { profileScraperMode: 'Full', search: req.what.slice(0, 200), ...(req.place ? { locations: [req.place] } : {}) } }, `Searching LinkedIn for ${req.what}${where}`);
}

const SEARCH_ROLES: StepRole[] = ['search', 'fallback', 'tsearch', 'tsearch2', 'xsearch', 'lsearch'];

export function decideNext(req: ResearchRequest, steps: readonly StepState[]): Next {
  if (steps.length >= MAX_PURCHASES) return { action: 'finish', reason: 'limit' };
  if (steps.some((s) => s.outcome === 'UNCERTAIN')) return { action: 'finish', reason: 'uncertain' };

  if (req.kind === 'stores') {
    if (!steps.some((s) => s.role === 'places')) return buy('places', SERVICE.places, placesBody(req.what, req.place), `Searching Google Maps for ${req.what}`);
    return steps.some((s) => s.outcome === 'PAID') ? { action: 'finish', reason: 'done' } : { action: 'finish', reason: 'search_failed' };
  }

  if (req.kind === 'page') {
    if (!steps.some((s) => s.role === 'browse')) return buy('browse', SERVICE.browser, { durationMinutes: BROWSER_MINUTES }, 'Renting a private browser');
    return steps.some((s) => s.outcome === 'PAID') ? { action: 'finish', reason: 'done' } : { action: 'finish', reason: 'search_failed' };
  }

  if (req.kind === 'stocks') {
    for (const q of stockQueries(req.what)) {
      if (!steps.some((s) => s.role === q.role)) return { action: 'buy', role: q.role, capabilityId: q.capabilityId, input: q.input, ref: null, label: q.label };
    }
    if (!steps.some((s) => s.outcome === 'PAID')) return { action: 'finish', reason: 'search_failed' };
    // Answers with plenty in them that we still read no posts from are ones we can't read: say so rather than "nothing found".
    if (postsFromSteps(steps).posts.length === 0 && steps.some((s) => s.outcome === 'PAID' && hasContent(s.output))) return { action: 'finish', reason: 'unreadable' };
    return { action: 'finish', reason: 'done' };
  }

  for (const p of req.platforms) {
    const n =
      p === 'instagram'
        ? accountsNext(req, steps, { name: 'Instagram', search: 'search', again: 'fallback', vet: 'vet', searchId: SERVICE.igSearch, vetId: SERVICE.igProfile, found: foundAccounts(steps), vetInput: (username) => ({ username }) })
        : p === 'tiktok'
          ? accountsNext(req, steps, { name: 'TikTok', search: 'tsearch', again: 'tsearch2', vet: 'tvet', searchId: SERVICE.tiktokSearch, vetId: SERVICE.tiktokProfile, found: foundTikTok(steps), vetInput: (username) => ({ username }) })
          : p === 'x'
            ? xNext(req, steps)
            : linkedinNext(req, steps);
    if (n) return n;
  }

  // Nothing more to buy on any platform.
  if (!steps.some((s) => s.outcome === 'PAID' && SEARCH_ROLES.includes(s.role))) return { action: 'finish', reason: 'search_failed' };
  const nobody = foundAccounts(steps).length === 0 && foundTikTok(steps).length === 0 && foundXSellers(steps, req).length === 0 && paidOutputs(steps, 'lsearch').flatMap((s) => liPeople(s.output)).length === 0;
  // An answer with plenty in it that we still found nobody in is one we can't read — say so rather than "found no one".
  if (nobody && steps.some((s) => s.outcome === 'PAID' && hasContent(s.output))) return { action: 'finish', reason: 'unreadable' };
  return { action: 'finish', reason: 'done' };
}

// --- the answer ---------------------------------------------------------------------------------------------

/** A store search: what Google returned is read and ranked on the server afterwards (distances need the network). */
function assembleStores(req: ResearchRequest, steps: readonly StepState[], reason: FinishReason): ResearchResult {
  const notes: string[] = [];
  if (reason === 'uncertain') notes.push('The payment for the search didn’t confirm, so I stopped. It may have gone through — check Purchases & receipts before searching again.');
  if (reason === 'search_failed') notes.push('The search didn’t come back, and nothing was charged for what failed.');
  return { request: req, summary: reason === 'done' ? 'I searched Google Maps.' : 'I couldn’t search for stores just now.', items: [], notes, spent: dollars(spentOn(steps)), market: null, skipped: [] };
}

/** A page read: the browser is rented here; what it saw is filled in on the server (it needs the network). */
function assemblePage(req: ResearchRequest, steps: readonly StepState[], reason: FinishReason): ResearchResult {
  const notes: string[] = [];
  if (reason === 'uncertain') notes.push('The payment for the browser didn’t confirm, so I stopped. It may have gone through — check Purchases & receipts before trying again.');
  if (reason === 'search_failed') notes.push('The browser couldn’t be rented, and nothing was charged.');
  return { request: req, summary: reason === 'done' ? 'I rented a browser for this page.' : 'I couldn’t read the page.', items: [], notes, spent: dollars(spentOn(steps)), market: null, skipped: [] };
}

/** Stock research: the tickers with real attention. Prices are joined on the server afterwards (it needs the network). */
function assembleStocks(req: ResearchRequest, steps: readonly StepState[], reason: FinishReason, now: Date): ResearchResult {
  const focus = focusOf(req.what);
  const { candidates, read } = stockCandidates(steps, now, focus);
  const notes: string[] = [];
  if (reason === 'uncertain') notes.push('One payment didn’t confirm, so I stopped. It may have gone through — check Purchases & receipts before searching again.');
  if (reason === 'limit') notes.push('I stopped at my purchase limit for one search.');
  if (reason === 'unreadable') notes.push('The searches did answer, but in a shape I couldn’t read reliably, so I spent no more on them. The raw answers are saved under Purchases.');
  if (reason === 'search_failed') notes.push('The searches didn’t come back, and nothing was charged for what failed.');
  const spent = steps.filter((s) => s.outcome === 'PAID' || s.outcome === 'UNCERTAIN').reduce((a, s) => a + s.priceAtomic, 0n);
  return {
    request: req,
    summary: focus ? `I read ${read.x + read.reddit} posts about $${focus}: ${candidates[0]?.authors ?? 0} different people were talking about it.` : candidates.length ? `I read ${read.x + read.reddit} posts and found ${candidates.length} tickers that different people are talking about.` : 'I couldn’t find a stock that several different people were talking about.',
    items: [],
    notes,
    spent: dollars(spent),
    market: null,
    skipped: [],
    stocks: { theme: req.what, asOf: now.toISOString(), read, items: [], unverified: [], profileNote: null, candidates },
  };
}

const spentOn = (steps: readonly StepState[]) => steps.filter((s) => s.outcome === 'PAID' || s.outcome === 'UNCERTAIN').reduce((a, s) => a + s.priceAtomic, 0n);

const BASE_NOTE = 'A public profile can show an account is active and looks real — it can’t prove they deliver. Ask for proof first (a video of the item, a past customer to speak to), prefer pay on delivery, and start small. Pexa only does the research; you deal with the seller yourself.';

/** One sentence for the top of the shortlist: how many, and the best one. */
export function buildSummary(req: ResearchRequest, items: readonly ResearchItem[], reason: FinishReason, market: MarketPrice | null = null, skipped = 0): string {
  const where = req.place ? ` in ${req.place}` : '';
  if (!items.length) {
    if (reason === 'unreadable') return `I got a response for ${req.what}${where} but couldn’t read it properly — that’s on my side, not yours. I stopped there so it cost no more.`;
    if (reason === 'search_failed') return `I couldn’t get results for ${req.what}${where} just now, and you weren’t charged for anything that failed. Try again in a moment.`;
    if (skipped > 0) return `I found accounts that came up for “${req.what}”${where}, but none of them actually sells it (see what I left out below). Try different words, another platform, or a bigger nearby city.`;
    return `I didn’t find anyone for “${req.what}”${where}. Try different words, another platform, or a bigger nearby city.`;
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
  const named = skipped.filter((s) => /service|related|something other/i.test(s.reason)).slice(0, 3);
  const rest = skipped.length - named.length;
  const parts = named.map((s) => `${s.name} (${s.reason.replace(/^Looks like a /, 'looks like a ')})`);
  if (rest > 0) parts.push(`${rest} other account${rest === 1 ? '' : 's'} that ${rest === 1 ? 'isn’t' : 'aren’t'} selling it`);
  return `Left out: ${parts.join('; ')}.`;
}

/** The shortlist from everything bought: only accounts that sell what was asked for, rated and ranked (distances are added by the server). */
export function assemble(req: ResearchRequest, steps: readonly StepState[], reason: FinishReason, now: Date, memory: ReadonlyMap<string, VendorMemoryView> = new Map()): ResearchResult {
  if (req.kind === 'stocks') return assembleStocks(req, steps, reason, now);
  if (req.kind === 'page') return assemblePage(req, steps, reason);
  if (req.kind === 'stores') return assembleStores(req, steps, reason);
  const mem = (platform: string, handle: string) => memory.get(`${platform}:${handle.toLowerCase()}`) ?? null;
  const spent = dollars(spentOn(steps));
  const notes: string[] = [];
  const all: ResearchItem[] = [];

  if (req.platforms.includes('linkedin')) {
    all.push(...paidOutputs(steps, 'lsearch').flatMap((s) => liPeople(s.output)).map((p) => scoreLinkedIn(p, { what: req.what, place: req.place }, now)));
    notes.push('Ask for past work or a reference before you pay anyone you haven’t met.');
  }
  if (req.platforms.includes('instagram')) {
    const found = foundAccounts(steps);
    const vetted = new Map<string, ReturnType<typeof igProfile>>();
    for (const s of steps) if (s.role === 'vet' && s.outcome === 'PAID' && s.ref) vetted.set(s.ref, igProfile(s.output));
    const lookedAt = found.filter((c) => steps.some((s) => s.role === 'vet' && s.ref === c.username));
    all.push(...lookedAt.map((c) => scoreInstagram(c, vetted.get(c.username) ?? null, now, req.place, req.what, mem('instagram', c.username))));
    const unchecked = rankCandidates(found, req.what).filter((c) => !lookedAt.includes(c)).length;
    if (unchecked > 0) notes.push(`I found ${unchecked} more Instagram account${unchecked === 1 ? '' : 's'} but only looked inside the top ${lookedAt.length} to keep the cost down. Ask me to look further if you want.`);
    if (lookedAt.some((c) => !vetted.get(c.username))) notes.push('For some Instagram accounts the lookup came back empty, so I can’t say how active they are.');
  }
  if (req.platforms.includes('tiktok')) {
    const found = foundTikTok(steps);
    const vetted = new Map<string, ReturnType<typeof tiktokProfile>>();
    for (const s of steps) if (s.role === 'tvet' && s.outcome === 'PAID' && s.ref) vetted.set(s.ref, tiktokProfile(s.output));
    const lookedAt = found.filter((c) => steps.some((s) => s.role === 'tvet' && s.ref === c.username));
    all.push(...lookedAt.map((c) => scoreTikTok(c, vetted.get(c.username) ?? null, now, req.place, req.what, mem('tiktok', c.username))));
    const unchecked = rankCandidates(found, req.what).filter((c) => !lookedAt.includes(c)).length;
    if (unchecked > 0) notes.push(`I found ${unchecked} more TikTok account${unchecked === 1 ? '' : 's'} but only looked inside the top ${lookedAt.length} to keep the cost down.`);
  }
  if (req.platforms.includes('x')) {
    const xItems = foundXSellers(steps, req).map((s) => scoreXSeller(s, { what: req.what, place: req.place }, req.kind, now, mem('x', s.username)));
    const matches = xItems.filter((i) => i.relevance === 'match').sort((a, b) => Number(b.signals.some((s) => /Checked their own/.test(s.text))) - Number(a.signals.some((s) => /Checked their own/.test(s.text)))).slice(0, MAX_X_SHOWN);
    all.push(...matches, ...xItems.filter((i) => i.relevance !== 'match'));
  }

  // Only accounts that sell what was asked for are shown; the rest are named (services) or counted (not selling) so nothing vanishes silently.
  const shown = all.filter((i) => i.relevance === 'match');
  const skipped: { name: string; reason: string }[] = [];
  let unrelated = 0;
  for (const i of all) {
    if (i.relevance === 'adjacent') skipped.push({ name: i.handle ?? i.name, reason: i.skipReason ?? 'not a seller of this' });
    else if (i.relevance === 'unrelated') {
      if (i.skipReason && /something other/.test(i.skipReason)) skipped.push({ name: i.handle ?? i.name, reason: i.skipReason });
      else unrelated++;
    }
  }
  if (unrelated > 0) skipped.push({ name: `${unrelated} other account${unrelated === 1 ? '' : 's'}`, reason: 'weren’t selling it' });

  const rated = applyRatings(mergeSameBusiness(shown), { what: req.what, place: req.place, kind: req.kind, priority: req.priority });
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
