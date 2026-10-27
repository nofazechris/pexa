import 'server-only';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import type { ResearchSessionRow } from '@/lib/db/schema';
import { buyAvailable, cancelPurchase, getApprovalPayload, getPurchase, preparePurchase } from '@/lib/buy/service';
import { parseMaybeJson } from '@/lib/buy/slim';
import { geocode } from '@/lib/geo/service';
import { haversineKm, placeParts } from '@/lib/geo/place';
import { ALLOWED_SERVICES, RESEARCH_HARD_CAP_ATOMIC, freshForMs, accountKeys, assemble, buildSummary, capFor, decideNext, describePlan, dollars, type FinishReason, type StepRole, type StepState } from './engine';
import { loadVendorMemory, recordRun } from './memory';
import { applyRadius, applyRatings, rankByRating } from './rate';
import { priorityFrom } from './request';
import { lookupPrices } from './stocks/prices-service';
import { buildStockItems, focusOf } from './stocks/build';
import { recordTraction } from './stocks/watchlist';
import { talkSince } from './stocks/watch';
import { recordResearch } from '@/lib/shopping/service';
import { getInvestorProfile } from '@/lib/profile/service';
import { summary as profileSummary } from '@/lib/profile/investor';
import { expandOptions } from './expand';
import { fillPage } from './page';
import type { Platform, ResearchKind, ResearchPlanView, ResearchRequest, ResearchResult } from './types';

/**
 * Research runs as a series of small Buy purchases under ONE budget the user approves up front ("up to $0.06"). Every
 * purchase is still its own x402 payment, signed by the user's own wallet in their browser — the budget only saves them
 * tapping Approve for each one. The server decides each next purchase from the answers so far, and refuses anything
 * outside the allow-list, over the budget, or beyond the purchase limit. The browser drives it: ask for the next step,
 * sign it, pay, ask again.
 */

interface StepRef {
  purchaseId: string;
  role: StepRole;
  ref: string | null;
  /** This answer was bought earlier by the same person and is still fresh, so reusing it cost nothing. */
  cached?: boolean;
}

/** An answer this person already paid for with exactly this request, recent enough to reuse. Never another person's. */
async function freshPurchase(userId: string, capabilityId: string, input: Record<string, unknown>): Promise<string | null> {
  const ttl = freshForMs(capabilityId);
  if (!ttl) return null;
  const [row] = await getDb()
    .select({ id: schema.buyPurchases.id, responseJson: schema.buyPurchases.responseJson })
    .from(schema.buyPurchases)
    .where(and(eq(schema.buyPurchases.userId, userId), eq(schema.buyPurchases.capabilityId, capabilityId), eq(schema.buyPurchases.requestBody, JSON.stringify(input)), eq(schema.buyPurchases.status, 'PAID'), gte(schema.buyPurchases.createdAt, new Date(Date.now() - ttl))))
    .orderBy(desc(schema.buyPurchases.createdAt))
    .limit(1);
  return row?.responseJson ? row.id : null;
}

export type Advance =
  | { kind: 'pay'; purchaseId: string; from: string; typedData: unknown; price: string; token: string; label: string; step: number; spent: string; cap: string }
  | { kind: 'wait'; message: string }
  | { kind: 'done'; result: ResearchResult }
  | { kind: 'failed'; message: string };

export { normalizeRequest } from './request';

const requestOf = (r: ResearchSessionRow): ResearchRequest => ({ kind: r.kind as ResearchKind, platforms: r.source.split(',').filter(Boolean) as Platform[], what: r.what, place: r.place, priority: priorityFrom(r.priority), radiusKm: r.radiusKm ?? null, ...(r.shoppingItemId ? { itemId: r.shoppingItemId } : {}) });

function stepsOf(r: ResearchSessionRow): StepRef[] {
  try {
    const v = JSON.parse(r.stepsJson);
    return Array.isArray(v) ? v.filter((s): s is StepRef => typeof s?.purchaseId === 'string') : [];
  } catch {
    return [];
  }
}

async function load(userId: string, id: string): Promise<ResearchSessionRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await getDb()
    .select()
    .from(schema.researchSessions)
    .where(and(eq(schema.researchSessions.id, id), eq(schema.researchSessions.userId, userId)))
    .limit(1);
  return row ?? null;
}

/** Nothing is bought here: it only records the request and what it would cost. */
export async function createResearch(userId: string, request: ResearchRequest): Promise<{ ok: true; plan: ResearchPlanView } | { ok: false; message: string }> {
  if (!buyAvailable()) return { ok: false, message: 'Research uses Buy, which runs on Celo mainnet only.' };
  const text = describePlan(request);
  const cap = text.capAtomic > RESEARCH_HARD_CAP_ATOMIC ? RESEARCH_HARD_CAP_ATOMIC : capFor(request);
  const [row] = await getDb()
    .insert(schema.researchSessions)
    .values({ userId, kind: request.kind, source: request.platforms.join(','), what: request.what, place: request.place, priority: request.priority ?? 'balanced', radiusKm: request.radiusKm ?? null, shoppingItemId: request.itemId ?? null, capAtomic: cap.toString() })
    .returning();
  return { ok: true, plan: { sessionId: row.id, request, title: text.title, steps: text.steps, estimate: text.estimate, cap: dollars(cap), capAtomic: cap.toString() } };
}

export async function cancelResearch(userId: string, id: string): Promise<boolean> {
  const row = await load(userId, id);
  if (!row || (row.status !== 'PLANNED' && row.status !== 'RUNNING')) return false;
  // Drop any quote still waiting for a signature.
  for (const s of stepsOf(row)) await cancelPurchase(userId, s.purchaseId).catch(() => false);
  await getDb().update(schema.researchSessions).set({ status: 'CANCELLED', updatedAt: new Date() }).where(eq(schema.researchSessions.id, row.id));
  return true;
}

export async function getResearchResult(userId: string, id: string): Promise<ResearchResult | null> {
  const row = await load(userId, id);
  if (!row?.resultJson) return null;
  try {
    return JSON.parse(row.resultJson) as ResearchResult;
  } catch {
    return null;
  }
}

/**
 * Add "about N km away" to the shortlist where we can: the person's area and the place a profile states are both looked up, and
 * only when the stated place is specific enough to measure to (not just a country, not just the same city by name). Anything
 * that fails or takes too long simply gets no distance — the shortlist is shown either way.
 */
async function addDistances(result: ResearchResult): Promise<void> {
  const origin = result.request.place ? await geocode(result.request.place) : null;
  if (!origin || !origin.precise) return;
  const todo = result.items.filter((i) => i.location && i.nearness !== 'area' && !(i.nearness === 'city' && placeParts(i.location).length < 2)).slice(0, 5);
  for (const item of todo) {
    const there = await geocode(item.location as string);
    if (there?.precise) item.distanceKm = Math.round(haversineKm(origin, there) * 10) / 10;
  }
}

/**
 * Stock research, second half: look up real prices for the tickers people are talking about, drop any symbol the price source
 * doesn't know, and build the evidence for each. Nothing is recommended; the person's own profile only adds how it sits with them.
 */
async function enrichStocks(result: ResearchResult, userId: string): Promise<void> {
  const s = result.stocks;
  if (!s) return;
  const profile = await getInvestorProfile(userId);
  const candidatesOf = s.candidates;
  const prices = await lookupPrices(candidatesOf.slice(0, 10).map((c) => c.symbol));
  const { items, unverified } = buildStockItems(candidatesOf, prices, profile);
  s.items = items;
  s.unverified = unverified;
  s.candidates = [];
  s.profileNote = profile && !profile.skipped ? profileSummary(profile) : null;
  const read = s.read.x + s.read.reddit;
  const focus = focusOf(result.request.what);
  if (focus) {
    s.focus = focus;
    const heat = candidatesOf.find((c) => c.symbol === focus);
    const now = { authors: heat?.authors ?? 0, posts: heat?.posts ?? 0 };
    const rec = await recordTraction(userId, focus, now).catch(() => ({ watched: false, previous: null, change: null }));
    result.summary = items.length ? `I read ${read} posts about $${focus}: ${now.authors} different ${now.authors === 1 ? 'person was' : 'people were'} talking about it. Here it is next to its price.` : `I couldn’t find a stock with the symbol ${focus}.`;
    if (rec.watched && rec.previous) result.notes.push(`Compared with last time: ${talkSince(rec.previous, now)}.`);
    if (rec.change) result.notes.push(`${rec.change.title}. ${rec.change.detail}`);
    result.notes.push('Pexa can’t buy or sell stocks. Talk on social media is not a reason to buy, and a stock that is popular can fall. Not financial advice.');
    return;
  }
  result.summary = items.length ? `I read ${read} posts on X and Reddit and found ${items.length} stock${items.length === 1 ? '' : 's'} that different people are talking about. Here is what the posts and the prices say — it is evidence, not a recommendation.` : result.summary;
  if (unverified.length) result.notes.push(`Left out ${unverified.join(', ')}: the price source doesn’t know ${unverified.length === 1 ? 'it' : 'them'}, so ${unverified.length === 1 ? 'it' : 'they'} may not be real stocks.`);
  if (items.length && items.every((i) => i.price === null)) result.notes.push('I couldn’t reach the price source just now, so there are no prices here. Ask me again in a few minutes.');
  result.notes.push('Pexa can’t buy or sell stocks. Talk on social media is not a reason to buy, and a stock that is popular can fall. Not financial advice.');
}

async function finish(row: ResearchSessionRow, states: StepState[], reason: FinishReason, extraNote?: string): Promise<Advance> {
  const req = requestOf(row);
  // What Pexa already knows about these accounts (earlier searches, what people said) goes into their scores…
  const memory = await loadVendorMemory(accountKeys(req, states));
  const result = assemble(req, states, reason, new Date(), memory);
  if (extraNote) result.notes.unshift(extraNote);
  if (req.kind === 'stocks') await enrichStocks(result, row.userId).catch((e) => console.error('[stocks] enrich failed:', e instanceof Error ? e.message : e));
  if (req.kind === 'page') await fillPage(row.userId, result, states).catch((e) => console.error('[page] read failed:', e instanceof Error ? e.message : e));
  const reusedCount = stepsOf(row).filter((s) => s.cached).length;
  if (reusedCount > 0) result.notes.unshift(`${reusedCount} lookup${reusedCount === 1 ? '' : 's'} came from searches you paid for recently, so they cost nothing this time (they can be a few hours old).`);
  if (result.items.length) {
    await Promise.race([addDistances(result), new Promise((r) => setTimeout(r, 9000))]).catch(() => undefined);
    // Distances change who is nearest: rate and rank again, then say it.
    const rated = applyRatings(result.items, { what: result.request.what, place: result.request.place, kind: result.request.kind, priority: result.request.priority });
    // A radius is a hard limit once a distance is measured; sellers whose distance couldn't be measured stay, and the card says so.
    const within = applyRadius(rated.items, result.request.radiusKm);
    result.items = rankByRating(within.items);
    if (within.outside > 0) result.notes.unshift(`Left out ${within.outside} seller${within.outside === 1 ? '' : 's'} measured farther than ${result.request.radiusKm} km (straight-line distance, not road distance). Ask me to widen the search if you want them.`);
    if (result.request.radiusKm && within.unverified > 0) result.notes.unshift(`I couldn’t measure how far ${within.unverified === 1 ? 'one seller is' : within.unverified + ' sellers are'} from you, so ${within.unverified === 1 ? 'it isn’t' : 'they aren’t'} confirmed to be within ${result.request.radiusKm} km — ask where they are.`);
    result.market = rated.market;
    const expand = expandOptions(result.request, { shown: result.items.length, outsideRadius: within.outside });
    if (expand.length) result.expand = expand;
    result.summary = buildSummary(result.request, result.items, reason, rated.market, result.skipped.length);
  }
  // A search made for a shopping-list item keeps its best options there (fails soft: the result itself is never lost).
  if (req.itemId && req.kind !== 'page') await recordResearch(row.userId, req.itemId, result).catch((e) => console.error('[shopping] save failed:', e instanceof Error ? e.message : e));
  const failed = reason === 'search_failed' && result.items.length === 0;
  await getDb()
    .update(schema.researchSessions)
    .set({ status: failed ? 'FAILED' : 'DONE', resultJson: JSON.stringify(result), updatedAt: new Date() })
    .where(and(eq(schema.researchSessions.id, row.id), inArray(schema.researchSessions.status, ['PLANNED', 'RUNNING'])));
  // …and what this search found is added to what Pexa knows (fails soft: a database hiccup never loses the answer).
  if (!failed && result.items.length) await recordRun(req, result);
  return failed ? { kind: 'failed', message: result.summary } : { kind: 'done', result };
}

/** What the purchases so far returned, in the shape the pure planner reads. */
async function statesOf(userId: string, steps: StepRef[]): Promise<{ states: StepState[]; open: { id: string; quoted: boolean }[] }> {
  const states: StepState[] = [];
  const open: { id: string; quoted: boolean }[] = [];
  for (const s of steps) {
    const p = await getPurchase(userId, s.purchaseId);
    if (!p) {
      states.push({ role: s.role, ref: s.ref, outcome: 'FAILED', priceAtomic: 0n });
      continue;
    }
    const price = BigInt(p.priceAtomic);
    // A reused answer costs nothing this time, so it is not counted against the budget.
    if (p.status === 'PAID') states.push({ role: s.role, ref: s.ref, outcome: 'PAID', priceAtomic: s.cached ? 0n : price, output: parseMaybeJson(p.responseJson) });
    else if (p.status === 'UNCERTAIN') states.push({ role: s.role, ref: s.ref, outcome: 'UNCERTAIN', priceAtomic: price });
    else if (p.status === 'QUOTED' && p.expiresAt > new Date()) {
      states.push({ role: s.role, ref: s.ref, outcome: 'OPEN', priceAtomic: price });
      open.push({ id: p.id, quoted: true });
    } else if (p.status === 'SUBMITTING') {
      states.push({ role: s.role, ref: s.ref, outcome: 'OPEN', priceAtomic: price });
      open.push({ id: p.id, quoted: false });
    } else states.push({ role: s.role, ref: s.ref, outcome: 'FAILED', priceAtomic: 0n });
  }
  return { states, open };
}

async function payload(userId: string, purchaseId: string, label: string, step: number, spent: bigint, cap: bigint): Promise<Advance> {
  const a = await getApprovalPayload(userId, purchaseId);
  if (!a) return { kind: 'failed', message: 'That price expired before it could be paid. Nothing was charged — ask again.' };
  return { kind: 'pay', purchaseId, from: a.from, typedData: a.typedData, price: a.purchase.price, token: a.purchase.token, label, step, spent: dollars(spent), cap: dollars(cap) };
}

/**
 * The next thing to do: pay for the next purchase (the browser signs it), wait for one in progress, or here is the answer.
 * Safe to call repeatedly — a quote that is still waiting is handed back, never duplicated.
 */
export async function advanceResearch(userId: string, id: string, attempt = 0): Promise<Advance> {
  const row = await load(userId, id);
  if (!row) return { kind: 'failed', message: 'I can’t find that search any more.' };
  if (row.status === 'DONE' && row.resultJson) return { kind: 'done', result: JSON.parse(row.resultJson) as ResearchResult };
  if (row.status === 'CANCELLED') return { kind: 'failed', message: 'This search was cancelled. Nothing more was charged.' };
  if (row.status === 'FAILED') return { kind: 'failed', message: 'This search didn’t work out. Nothing was charged for what failed.' };
  if (!buyAvailable()) return { kind: 'failed', message: 'Research uses Buy, which runs on Celo mainnet only.' };

  if (row.status === 'PLANNED') {
    await getDb().update(schema.researchSessions).set({ status: 'RUNNING', updatedAt: new Date() }).where(and(eq(schema.researchSessions.id, row.id), eq(schema.researchSessions.status, 'PLANNED')));
  }

  const request = requestOf(row);
  const cap = BigInt(row.capAtomic) > RESEARCH_HARD_CAP_ATOMIC ? RESEARCH_HARD_CAP_ATOMIC : BigInt(row.capAtomic);
  const steps = stepsOf(row);
  const { states, open } = await statesOf(userId, steps);
  const committed = states.filter((s) => s.outcome === 'PAID' || s.outcome === 'UNCERTAIN' || s.outcome === 'OPEN').reduce((a, s) => a + s.priceAtomic, 0n);

  // A quote already waiting for its signature, or a payment in flight: don't start another.
  const waiting = open.find((o) => o.quoted);
  if (waiting) {
    const idx = steps.findIndex((s) => s.purchaseId === waiting.id);
    return payload(userId, waiting.id, labelFor(request, steps[idx]), idx + 1, committed, cap);
  }
  if (open.length) return { kind: 'wait', message: 'Still working on the last lookup…' };

  const next = decideNext(request, states);
  if (next.action === 'finish') return finish(row, states, next.reason);
  if (!ALLOWED_SERVICES.has(next.capabilityId)) return finish(row, states, 'done', 'I stopped because the next lookup wasn’t one I’m allowed to buy.');

  // The same lookup, already bought by this person recently: reuse it. No quote, no signature, no charge.
  const reuse = await freshPurchase(userId, next.capabilityId, next.input).catch(() => null);
  if (reuse && !steps.some((s) => s.purchaseId === reuse)) {
    const reused: StepRef = { purchaseId: reuse, role: next.role, ref: next.ref, cached: true };
    const stored = await getDb()
      .update(schema.researchSessions)
      .set({ stepsJson: JSON.stringify([...steps, reused]), updatedAt: new Date() })
      .where(and(eq(schema.researchSessions.id, row.id), eq(schema.researchSessions.stepsJson, row.stepsJson)))
      .returning({ id: schema.researchSessions.id });
    if (stored.length) return attempt < 20 ? advanceResearch(userId, id, attempt + 1) : { kind: 'wait', message: 'Still working…' };
  }

  const prepared = await preparePurchase(userId, { capabilityId: next.capabilityId, input: next.input });
  if (!prepared.ok) {
    const anyPaid = states.some((s) => s.outcome === 'PAID');
    if (!anyPaid) {
      await getDb().update(schema.researchSessions).set({ status: 'FAILED', updatedAt: new Date() }).where(eq(schema.researchSessions.id, row.id));
      return { kind: 'failed', message: prepared.message };
    }
    return finish(row, states, 'done', `I stopped early: ${prepared.message}`);
  }

  const price = BigInt(prepared.purchase.priceAtomic);
  if (committed + price > cap) {
    await cancelPurchase(userId, prepared.purchase.id).catch(() => false);
    if (!states.some((s) => s.outcome === 'PAID')) {
      await getDb().update(schema.researchSessions).set({ status: 'FAILED', updatedAt: new Date() }).where(eq(schema.researchSessions.id, row.id));
      return { kind: 'failed', message: `That lookup costs ${dollars(price)}, which is over the ${dollars(cap)} you approved, so I didn’t buy it.` };
    }
    return finish(row, states, 'done', `I stopped at the ${dollars(cap)} you approved.`);
  }

  // Record the step only if nobody else advanced this research meanwhile (two taps, two tabs).
  const mine: StepRef = { purchaseId: prepared.purchase.id, role: next.role, ref: next.ref };
  const updated = await getDb()
    .update(schema.researchSessions)
    .set({ stepsJson: JSON.stringify([...steps, mine]), updatedAt: new Date() })
    .where(and(eq(schema.researchSessions.id, row.id), eq(schema.researchSessions.stepsJson, row.stepsJson)))
    .returning({ id: schema.researchSessions.id });
  if (updated.length === 0) {
    await cancelPurchase(userId, prepared.purchase.id).catch(() => false);
    return attempt < 2 ? advanceResearch(userId, id, attempt + 1) : { kind: 'wait', message: 'Still working…' };
  }
  return payload(userId, prepared.purchase.id, next.label, steps.length + 1, committed + price, cap);
}

function labelFor(req: ResearchRequest, step: StepRef | undefined): string {
  const where = req.place ? ` in ${req.place}` : '';
  if (!step) return 'Working…';
  if (req.kind === 'stocks') return { sx1: 'Searching X for the stocks people are talking about', sx2: 'Searching X for the newest stock talk', sr1: 'Searching Reddit for what’s hot in stocks', sr2: 'Searching Reddit for the best-argued write-ups' }[step.role as 'sx1' | 'sx2' | 'sr1' | 'sr2'] ?? 'Searching…';
  if (step.role === 'browse') return 'Renting a private browser for a couple of minutes, then reading the page';
  if (step.role === 'vet') return `Checking @${step.ref}`;
  if (step.role === 'tvet') return `Checking TikTok @${step.ref}`;
  if (step.role === 'xvet') return `Reading @${step.ref}’s recent posts on X`;
  const name = step.role === 'tsearch' || step.role === 'tsearch2' ? 'TikTok' : step.role === 'xsearch' ? 'X' : step.role === 'lsearch' ? 'LinkedIn' : 'Instagram';
  return `Searching ${name} for ${req.what}${where}`;
}
