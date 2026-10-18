import 'server-only';
import { and, eq, or, sql } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { cityOf, themeFor } from './commerce';
import { advise, statDelta, type PlatformAdvice, type PlatformStat } from './learn';
import { PLATFORM_CHOICES } from '@/lib/agent/buy-intent';
import type { ResearchRequest, ResearchResult, VendorMemoryView } from './types';

/**
 * The memory box (server half). Pexa learns two things from every search and from what people tell it afterwards, and reads them back
 * the next time:
 *   • per account — how often it came up, how it rated, and whether Pexa users called it a good lead, a bad lead or a scam;
 *   • per platform, per kind of thing, per city — how well Instagram, TikTok and X have actually turned up good sellers.
 * Counts about public business accounts and about platforms only — no identity is stored with them. Every function here fails soft:
 * if the database hiccups, a search still finishes; it just doesn't learn from that run.
 */

export type FeedbackKind = 'good' | 'bad' | 'scam';
const PLATFORMS = new Set(['instagram', 'tiktok', 'x']);
const HANDLE = /^[a-z0-9._]{1,40}$/;

const key = (platform: string, handle: string) => `${platform}:${handle.toLowerCase()}`;
const clean = (handle: string) => handle.trim().replace(/^@/, '').toLowerCase();

/** What is already known about these accounts, keyed "platform:handle". */
export async function loadVendorMemory(accounts: readonly { platform: string; handle: string }[]): Promise<Map<string, VendorMemoryView>> {
  const out = new Map<string, VendorMemoryView>();
  const wanted = accounts.filter((a) => PLATFORMS.has(a.platform) && HANDLE.test(clean(a.handle))).slice(0, 60);
  if (!wanted.length) return out;
  try {
    const t = schema.vendorMemory;
    const rows = await getDb()
      .select()
      .from(t)
      .where(or(...wanted.map((a) => and(eq(t.platform, a.platform), eq(t.handle, clean(a.handle))))));
    for (const r of rows) out.set(key(r.platform, r.handle), { seen: r.timesSeen, good: r.good, bad: r.bad, scam: r.scam });
  } catch (e) {
    console.error('[memory] load failed:', e);
  }
  return out;
}

/** Learn from a finished search: each account shown, and how each platform did. */
export async function recordRun(req: ResearchRequest, result: ResearchResult): Promise<void> {
  try {
    const db = getDb();
    const now = new Date();
    for (const item of result.items) {
      if (!item.handle || !item.checked || item.relevance !== 'match' || !PLATFORMS.has(item.platform)) continue;
      const handle = clean(item.handle);
      if (!HANDLE.test(handle)) continue;
      const rating = item.rating?.overall ?? null;
      await db
        .insert(schema.vendorMemory)
        .values({ platform: item.platform, handle, timesSeen: 1, lastVerdict: item.verdict, lastRating: rating, ratingSum: rating ?? 0, ratedCount: rating === null ? 0 : 1, lastSeenAt: now })
        .onConflictDoUpdate({
          target: [schema.vendorMemory.platform, schema.vendorMemory.handle],
          set: {
            timesSeen: sql`${schema.vendorMemory.timesSeen} + 1`,
            lastVerdict: item.verdict,
            lastRating: rating,
            ratingSum: sql`${schema.vendorMemory.ratingSum} + ${rating ?? 0}`,
            ratedCount: sql`${schema.vendorMemory.ratedCount} + ${rating === null ? 0 : 1}`,
            lastSeenAt: now,
          },
        });
    }
    // Platform yield: only for the social platforms that were searched, and only for sellers (people to hire are a different question).
    if (req.kind === 'vendors') {
      const category = themeFor(req.what).category;
      const city = cityOf(req.place).toLowerCase();
      if (city) {
        for (const platform of req.platforms) {
          if (!PLATFORMS.has(platform)) continue;
          const d = statDelta(platform, result.items);
          await db
            .insert(schema.platformStats)
            .values({ category, city, platform, runs: 1, shown: d.shown, established: d.established, risky: d.risky, ratingSum: d.ratingSum, updatedAt: now })
            .onConflictDoUpdate({
              target: [schema.platformStats.category, schema.platformStats.city, schema.platformStats.platform],
              set: {
                runs: sql`${schema.platformStats.runs} + 1`,
                shown: sql`${schema.platformStats.shown} + ${d.shown}`,
                established: sql`${schema.platformStats.established} + ${d.established}`,
                risky: sql`${schema.platformStats.risky} + ${d.risky}`,
                ratingSum: sql`${schema.platformStats.ratingSum} + ${d.ratingSum}`,
                updatedAt: now,
              },
            });
        }
      }
    }
  } catch (e) {
    console.error('[memory] record failed:', e);
  }
}

/** Which platform has worked best for this kind of thing in this city, so far. Empty advice when nothing is known. */
export async function platformAdviceFor(what: string, place: string): Promise<PlatformAdvice[]> {
  try {
    const rows = await getDb()
      .select()
      .from(schema.platformStats)
      .where(and(eq(schema.platformStats.category, themeFor(what).category), eq(schema.platformStats.city, cityOf(place).toLowerCase())));
    const stats: PlatformStat[] = rows.map((r) => ({ platform: r.platform, runs: r.runs, shown: r.shown, established: r.established, risky: r.risky, ratingSum: r.ratingSum }));
    return advise(stats);
  } catch (e) {
    console.error('[memory] advice failed:', e);
    return [];
  }
}

export interface ChoiceOption {
  label: string;
  text: string;
  hint?: string;
  recommended?: boolean;
}

/** The platform buttons, with what Pexa has learned about this kind of thing in this city: how each has done, and the clear winner (if any) marked. */
export async function platformChoiceOptions(ask: { what: string; place: string } | null): Promise<ChoiceOption[]> {
  const base: ChoiceOption[] = PLATFORM_CHOICES.map((c) => ({ ...c }));
  if (!ask) return base;
  const advice = await platformAdviceFor(ask.what, ask.place);
  const names: Record<string, string> = { instagram: 'Instagram', tiktok: 'TikTok', x: 'X' };
  return base.map((o) => {
    const a = advice.find((x) => names[x.platform] === o.label);
    return a ? { ...o, ...(a.hint ? { hint: a.hint } : {}), ...(a.recommended ? { recommended: true } : {}) } : o;
  });
}

/** A person's verdict on a vendor. One per person per vendor (changing it moves the count); returns what to tell them. */
export async function submitFeedback(userId: string, input: { platform: string; handle: string; kind: string }): Promise<{ ok: true; message: string } | { ok: false; code: string; message: string }> {
  const handle = clean(input.handle);
  if (!PLATFORMS.has(input.platform) || !HANDLE.test(handle)) return { ok: false, code: 'bad_account', message: 'I couldn’t tell which account that is.' };
  if (input.kind !== 'good' && input.kind !== 'bad' && input.kind !== 'scam') return { ok: false, code: 'bad_kind', message: 'Choose good lead, bad lead or scam.' };
  const kind = input.kind as FeedbackKind;
  const db = getDb();
  const [existing] = await db
    .select()
    .from(schema.vendorFeedback)
    .where(and(eq(schema.vendorFeedback.userId, userId), eq(schema.vendorFeedback.platform, input.platform), eq(schema.vendorFeedback.handle, handle)))
    .limit(1);
  if (existing?.kind === kind) return { ok: true, message: 'Already noted — thanks.' };

  await db.insert(schema.vendorMemory).values({ platform: input.platform, handle }).onConflictDoNothing();
  const m = schema.vendorMemory;
  const bump = (k: FeedbackKind, by: 1 | -1) => ({ [k]: sql`GREATEST(${m[k]} + ${by}, 0)` });
  if (existing) {
    await db.update(m).set(bump(existing.kind as FeedbackKind, -1)).where(and(eq(m.platform, input.platform), eq(m.handle, handle)));
    await db.update(schema.vendorFeedback).set({ kind }).where(eq(schema.vendorFeedback.id, existing.id));
  } else {
    await db.insert(schema.vendorFeedback).values({ userId, platform: input.platform, handle, kind });
  }
  await db.update(m).set(bump(kind, 1)).where(and(eq(m.platform, input.platform), eq(m.handle, handle)));
  return { ok: true, message: kind === 'scam' ? 'Thanks — Pexa will warn others about this account.' : 'Thanks — Pexa will remember that.' };
}

