/**
 * The research plan, as pure logic: what to buy first, what to buy next given what came back, and how the answers become a
 * shortlist. The server runs these decisions one purchase at a time (each signed by the user's own wallet inside a budget the
 * user approved); this file never touches the network, so every branch is testable.
 */
import { igCandidates, igProfile, liPeople, type IgCandidate } from './read';
import { scoreInstagram, scoreLinkedIn, verdictRank } from './score';
import type { ResearchItem, ResearchRequest, ResearchResult } from './types';

/** The only Buy services research may spend on. Anything else is refused, whatever the model or a poisoned result suggests. */
export const SERVICE = {
  igSearch: 'monid.instagram.tikhub.api-v1-instagram-v2-search-users',
  igGeneral: 'monid.instagram.tikhub.api-v1-instagram-v2-general-search',
  igProfile: 'instagram.profile',
  liSearch: 'monid.linkedin.apify.harvestapi-linkedin-profile-search-by-services',
} as const;

export const ALLOWED_SERVICES: ReadonlySet<string> = new Set(Object.values(SERVICE));

/** How many accounts get a closer look. */
export const MAX_CHECKS = 3;
/** Hard stop on purchases in one research, whatever happens. */
export const MAX_PURCHASES = 6;
/** The ceiling a research can ever have, even if asked for more. */
export const RESEARCH_HARD_CAP_ATOMIC = 250_000n; // $0.25

/** Rough prices, only for the estimate shown before anything is bought. The real price is quoted per purchase. */
const EST = { igSearch: 7_000n, igProfile: 5_000n, liSearch: 103_000n };

export function capFor(req: ResearchRequest): bigint {
  return req.source === 'linkedin' ? 150_000n : 60_000n;
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
      steps: [`Search LinkedIn for ${req.what}${where}`, 'Compare the top 5 on fit, location and how complete their profile is', 'Give you a shortlist — nothing is paid to anyone'],
      estimate: dollars(EST.liSearch),
      cap: dollars(capAtomic),
      capAtomic,
    };
  }
  return {
    title: sentence(req.kind === 'hire' ? `find ${req.what}${where}` : `find sellers of ${req.what}${where}`),
    steps: [`Search Instagram for ${req.what}${where}`, `Look inside the top ${MAX_CHECKS} accounts: how active, how established, whether the following looks real`, 'Give you a ranked shortlist — nothing is paid to anyone'],
    estimate: dollars(EST.igSearch + EST.igProfile * BigInt(MAX_CHECKS)),
    cap: dollars(capAtomic),
    capAtomic,
  };
}

// --- deciding the next purchase -----------------------------------------------------------------------------

export type StepRole = 'search' | 'fallback' | 'vet';
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

export type Next =
  | { action: 'buy'; role: StepRole; capabilityId: string; input: Record<string, unknown>; ref: string | null; label: string }
  | { action: 'finish'; reason: 'done' | 'search_failed' | 'uncertain' | 'limit' | 'unreadable' };

/** Accounts worth looking at first: public ones, verified ones, ones whose name or bio matches what was asked for. */
export function rankCandidates(cands: readonly IgCandidate[], what: string): IgCandidate[] {
  // "sneakers" must match "sneaker_plug": compare word stems.
  const wanted = what.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3).map((w) => (w.length > 4 ? w.replace(/(?:es|s)$/, '') : w));
  const relevance = (c: IgCandidate) => {
    const text = `${c.username} ${c.fullName ?? ''} ${c.bio ?? ''}`.toLowerCase();
    return wanted.filter((w) => text.includes(w)).length;
  };
  return cands
    .map((c, i) => ({ c, i }))
    .sort((a, b) => Number(a.c.isPrivate === true) - Number(b.c.isPrivate === true) || relevance(b.c) - relevance(a.c) || Number(b.c.verified === true) - Number(a.c.verified === true) || a.i - b.i)
    .map((x) => x.c);
}

const keyword = (req: ResearchRequest) => `${req.what} ${req.place}`.trim().slice(0, 120);

/** Does a reply carry real data (rather than an empty list or a short message)? */
export function hasContent(output: unknown): boolean {
  try {
    return JSON.stringify(output ?? null).length > 240;
  } catch {
    return false;
  }
}

/** All the accounts any paid search returned. */
export function foundAccounts(steps: readonly StepState[]): IgCandidate[] {
  const seen = new Set<string>();
  const out: IgCandidate[] = [];
  for (const s of steps) {
    if (s.outcome !== 'PAID' || (s.role !== 'search' && s.role !== 'fallback')) continue;
    for (const c of igCandidates(s.output)) {
      if (!seen.has(c.username)) {
        seen.add(c.username);
        out.push(c);
      }
    }
  }
  return out;
}

export function decideNext(req: ResearchRequest, steps: readonly StepState[]): Next {
  if (steps.length >= MAX_PURCHASES) return { action: 'finish', reason: 'limit' };
  if (steps.some((s) => s.outcome === 'UNCERTAIN')) return { action: 'finish', reason: 'uncertain' };

  const searches = steps.filter((s) => s.role === 'search' || s.role === 'fallback');
  const where = req.place ? ` in ${req.place}` : '';

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
    const paid = searches.filter((s) => s.outcome === 'PAID');
    if (!paid.length) return { action: 'finish', reason: 'search_failed' };
    return { action: 'finish', reason: liPeople(paid[0].output).length === 0 && hasContent(paid[0].output) ? 'unreadable' : 'done' };
  }

  // Instagram: search, (if nothing came back) one broader search, then look inside the best few accounts.
  if (searches.length === 0) {
    return { action: 'buy', role: 'search', capabilityId: SERVICE.igSearch, input: { queryParams: { keyword: keyword(req) } }, ref: null, label: `Searching Instagram for ${req.what}${where}` };
  }
  const found = foundAccounts(steps);
  const anyPaid = searches.some((s) => s.outcome === 'PAID');
  if (!anyPaid && searches.every((s) => s.outcome === 'FAILED')) {
    if (searches.length < 2) {
      return { action: 'buy', role: 'fallback', capabilityId: SERVICE.igGeneral, input: { queryParams: { keyword: keyword(req) } }, ref: null, label: 'Trying a wider Instagram search' };
    }
    return { action: 'finish', reason: 'search_failed' };
  }
  // An answer with plenty in it that we still found no accounts in is one we can't read — a wider search would be read the same way, so don't pay for it.
  if (found.length === 0 && searches.some((s) => s.outcome === 'PAID' && hasContent(s.output))) return { action: 'finish', reason: 'unreadable' };
  if (found.length === 0 && searches.length < 2 && searches.every((s) => s.outcome === 'PAID')) {
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

const BASE_NOTE = 'A public profile can show an account is active and looks real — it can’t prove they deliver. Start with a small test payment.';

export function assemble(req: ResearchRequest, steps: readonly StepState[], reason: Extract<Next, { action: 'finish' }>['reason'], now: Date): ResearchResult {
  const spent = dollars(spentOn(steps));
  const where = req.place ? ` in ${req.place}` : '';
  const notes: string[] = [];
  let items: ResearchItem[] = [];

  if (req.source === 'linkedin') {
    const people = steps.filter((s) => s.outcome === 'PAID' && s.role === 'search').flatMap((s) => liPeople(s.output));
    items = people.map((p) => scoreLinkedIn(p, { what: req.what, place: req.place }));
    items.sort((a, b) => verdictRank(a.verdict) - verdictRank(b.verdict));
    notes.push('Ask for past work or a reference before you pay anyone you haven’t met.');
  } else {
    const found = foundAccounts(steps);
    const vetted = new Map<string, ReturnType<typeof igProfile>>();
    for (const s of steps) if (s.role === 'vet' && s.outcome === 'PAID' && s.ref) vetted.set(s.ref, igProfile(s.output));
    const lookedAt = rankCandidates(found, req.what).filter((c) => steps.some((s) => s.role === 'vet' && s.ref === c.username));
    items = lookedAt.map((c) => scoreInstagram(c, vetted.get(c.username) ?? null, now));
    items.sort((a, b) => verdictRank(a.verdict) - verdictRank(b.verdict));
    const unchecked = found.length - lookedAt.length;
    if (unchecked > 0) notes.push(`I found ${unchecked} more account${unchecked === 1 ? '' : 's'} but only looked inside the top ${lookedAt.length} to keep the cost down. Ask me to look further if you want.`);
    if (lookedAt.some((c) => !vetted.get(c.username))) notes.push('For some accounts the lookup came back empty, so I can’t say how active they are.');
  }
  notes.push(BASE_NOTE);
  if (reason === 'uncertain') notes.unshift('One payment didn’t confirm, so I stopped. It may have gone through — check Purchases & receipts before searching again.');
  if (reason === 'limit') notes.unshift('I stopped at my purchase limit for one search.');
  if (reason === 'unreadable') notes.unshift('The search did answer, but in a shape I couldn’t read reliably, so I didn’t spend more on it. The raw answer is saved under Purchases.');

  let summary: string;
  if (reason === 'unreadable' && !items.length) {
    summary = `I got a response for ${req.what}${where} but couldn’t read it properly — that’s on my side, not yours. I stopped there so it cost no more.`;
  } else if (reason === 'search_failed' && !items.length) {
    summary = `I couldn’t get results for ${req.what}${where} just now, and you weren’t charged for anything that failed. Try again in a moment.`;
  } else if (!items.length) {
    summary = `I didn’t find ${req.source === 'linkedin' ? 'people' : 'accounts'} for “${req.what}”${where}. Try different words or a bigger nearby city.`;
  } else {
    const best = items[0];
    const good = items.filter((i) => i.verdict === 'solid');
    const who = best.handle ?? best.name;
    summary = good.length
      ? `Found ${items.length} for ${req.what}${where}. Best signals: ${who} (${best.verdictLabel.toLowerCase()}).`
      : `Found ${items.length} for ${req.what}${where}, but none stands out strongly — ${who} is the closest. Go carefully and test with a small payment first.`;
  }
  return { request: req, summary, items, notes, spent };
}
