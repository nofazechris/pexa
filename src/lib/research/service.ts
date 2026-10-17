import 'server-only';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import type { ResearchSessionRow } from '@/lib/db/schema';
import { buyAvailable, cancelPurchase, getApprovalPayload, getPurchase, preparePurchase } from '@/lib/buy/service';
import { parseMaybeJson } from '@/lib/buy/slim';
import { geocode } from '@/lib/geo/service';
import { haversineKm, placeParts } from '@/lib/geo/place';
import { ALLOWED_SERVICES, RESEARCH_HARD_CAP_ATOMIC, assemble, buildSummary, capFor, decideNext, describePlan, dollars, type FinishReason, type StepRole, type StepState } from './engine';
import { rankItems } from './score';
import type { ResearchKind, ResearchPlanView, ResearchRequest, ResearchResult, ResearchSource } from './types';

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
}

export type Advance =
  | { kind: 'pay'; purchaseId: string; from: string; typedData: unknown; price: string; token: string; label: string; step: number; spent: string; cap: string }
  | { kind: 'wait'; message: string }
  | { kind: 'done'; result: ResearchResult }
  | { kind: 'failed'; message: string };

export { normalizeRequest } from './request';

const requestOf = (r: ResearchSessionRow): ResearchRequest => ({ kind: r.kind as ResearchKind, source: r.source as ResearchSource, what: r.what, place: r.place });

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
    .values({ userId, kind: request.kind, source: request.source, what: request.what, place: request.place, capAtomic: cap.toString() })
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

async function finish(row: ResearchSessionRow, states: StepState[], reason: FinishReason, extraNote?: string): Promise<Advance> {
  const result = assemble(requestOf(row), states, reason, new Date());
  if (extraNote) result.notes.unshift(extraNote);
  if (result.items.length) {
    await Promise.race([addDistances(result), new Promise((r) => setTimeout(r, 9000))]).catch(() => undefined);
    result.items = rankItems(result.items);
    result.summary = buildSummary(result.request, result.items, reason);
  }
  const failed = reason === 'search_failed' && result.items.length === 0;
  await getDb()
    .update(schema.researchSessions)
    .set({ status: failed ? 'FAILED' : 'DONE', resultJson: JSON.stringify(result), updatedAt: new Date() })
    .where(and(eq(schema.researchSessions.id, row.id), inArray(schema.researchSessions.status, ['PLANNED', 'RUNNING'])));
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
    if (p.status === 'PAID') states.push({ role: s.role, ref: s.ref, outcome: 'PAID', priceAtomic: price, output: parseMaybeJson(p.responseJson) });
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
  if (step.role === 'vet') return `Checking @${step.ref}`;
  return req.source === 'linkedin' ? `Searching LinkedIn for ${req.what}${where}` : `Searching Instagram for ${req.what}${where}`;
}
