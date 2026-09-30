import 'server-only';
import { and, count, eq, sql } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { isUniqueViolation } from '@/lib/db/errors';
import { generateReferralCode, normalizeReferralCode } from './code';

/**
 * Referrals (§ growth). Waitlist entrants and app users each own one share code; a person who joins
 * through someone's link is recorded once in the `referrals` ledger. Waitlist position is derived:
 * more referrals ranks you higher, and ties go to whoever joined first.
 */

export type OwnerType = 'waitlist' | 'user';

/** The owner's code, creating it on first use. Idempotent and safe under concurrent calls. */
export async function getOrCreateCode(ownerType: OwnerType, ownerId: string): Promise<string> {
  const db = getDb();
  const find = async () => {
    const rows = await db
      .select({ code: schema.referralCodes.code })
      .from(schema.referralCodes)
      .where(and(eq(schema.referralCodes.ownerType, ownerType), eq(schema.referralCodes.ownerId, ownerId)))
      .limit(1);
    return rows[0]?.code ?? null;
  };

  const existing = await find();
  if (existing) return existing;

  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await db.insert(schema.referralCodes).values({ code: generateReferralCode(), ownerType, ownerId });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      // Either a concurrent request just created this owner's code (use it), or — astronomically
      // unlikely — the random code collided with another owner's (loop and draw a new one).
      const raced = await find();
      if (raced) return raced;
      continue;
    }
    const created = await find();
    if (created) return created;
  }
  throw new Error('Could not allocate a referral code.');
}

/** Look a code up. Returns null for anything that isn't a real, well-formed code. */
export async function resolveCode(raw: unknown): Promise<{ code: string; ownerType: OwnerType; ownerId: string } | null> {
  const code = normalizeReferralCode(raw);
  if (!code) return null;
  const db = getDb();
  const rows = await db.select().from(schema.referralCodes).where(eq(schema.referralCodes.code, code)).limit(1);
  const r = rows[0];
  return r ? { code: r.code, ownerType: r.ownerType as OwnerType, ownerId: r.ownerId } : null;
}

/**
 * Credit `code` for bringing in a new person. Returns true only if this created a NEW attribution:
 * unknown/malformed codes, self-referrals and people who were already attributed are all ignored
 * (a person can be credited to exactly one referrer, once).
 */
export async function recordReferral(input: { code: unknown; refereeType: OwnerType; refereeId: string }): Promise<boolean> {
  const owner = await resolveCode(input.code);
  if (!owner) return false;
  if (owner.ownerType === input.refereeType && owner.ownerId === input.refereeId) return false; // your own link
  const db = getDb();
  const inserted = await db
    .insert(schema.referrals)
    .values({ code: owner.code, refereeType: input.refereeType, refereeId: input.refereeId })
    .onConflictDoNothing({ target: [schema.referrals.refereeType, schema.referrals.refereeId] })
    .returning({ id: schema.referrals.id });
  return inserted.length > 0;
}

/** How many people joined through this code. */
export async function referralCount(code: string): Promise<number> {
  const db = getDb();
  const [row] = await db.select({ n: count() }).from(schema.referrals).where(eq(schema.referrals.code, code));
  return Number(row?.n ?? 0);
}

export interface WaitlistStatus {
  code: string;
  /** 1-based place in line. */
  position: number;
  total: number;
  referrals: number;
}

/**
 * Where a waitlist entrant stands. Ranking: most referrals first; ties broken by who joined earlier.
 * Computed on read from the ledger, so it's always consistent (nothing to keep in sync).
 */
export async function waitlistStatus(waitlistId: string): Promise<WaitlistStatus | null> {
  const db = getDb();
  const code = await getOrCreateCode('waitlist', waitlistId);
  const rows = (await db.execute(sql`
    with ranked as (
      select w.id, w.created_at,
             (select count(*) from referrals r
                join referral_codes rc on rc.code = r.code
               where rc.owner_type = 'waitlist' and rc.owner_id = w.id)::int as n
        from waitlist w
    )
    select
      (select count(*) from ranked)::int as total,
      (select n from ranked where id = ${waitlistId})::int as mine,
      1 + (select count(*) from ranked x, ranked me
            where me.id = ${waitlistId}
              and (x.n > me.n or (x.n = me.n and x.created_at < me.created_at)))::int as position
  `)) as unknown as Array<{ total: number; mine: number | null; position: number }>;
  const r = rows[0];
  if (!r || r.mine == null) return null; // not on the list
  return { code, position: Number(r.position), total: Number(r.total), referrals: Number(r.mine) };
}

/** Waitlist status looked up by a share code (must belong to a waitlist entrant). */
export async function waitlistStatusByCode(rawCode: unknown): Promise<WaitlistStatus | null> {
  const owner = await resolveCode(rawCode);
  if (!owner || owner.ownerType !== 'waitlist') return null;
  return waitlistStatus(owner.ownerId);
}

/** An app user's share code and how many people have joined through it. */
export async function userReferralSummary(userId: string): Promise<{ code: string; referrals: number }> {
  const code = await getOrCreateCode('user', userId);
  return { code, referrals: await referralCount(code) };
}
