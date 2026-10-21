import 'server-only';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { EMPTY_PROFILE, type Horizon, type InvestorProfile, type Risk } from './investor';

/** What the person has told Pexa about how they invest. One row each, theirs alone, editable or erasable any time. */

export async function getInvestorProfile(userId: string): Promise<InvestorProfile | null> {
  try {
    const [row] = await getDb().select().from(schema.investorProfiles).where(eq(schema.investorProfiles.userId, userId)).limit(1);
    if (!row) return null;
    return { risk: (row.risk as Risk | null) ?? null, horizon: (row.horizon as Horizon | null) ?? null, amountUsd: row.amountUsd ?? null, skipped: row.skipped };
  } catch (e) {
    console.error('[profile] read failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

export async function saveInvestorProfile(userId: string, p: InvestorProfile): Promise<void> {
  const values = { userId, risk: p.risk, horizon: p.horizon, amountUsd: p.amountUsd, skipped: p.skipped, updatedAt: new Date() };
  await getDb()
    .insert(schema.investorProfiles)
    .values(values)
    .onConflictDoUpdate({ target: schema.investorProfiles.userId, set: { risk: p.risk, horizon: p.horizon, amountUsd: p.amountUsd, skipped: p.skipped, updatedAt: values.updatedAt } });
}

/** Forget it, so the questions are asked afresh next time. */
export async function resetInvestorProfile(userId: string): Promise<void> {
  await saveInvestorProfile(userId, EMPTY_PROFILE).catch(() => undefined);
  await getDb().delete(schema.investorProfiles).where(eq(schema.investorProfiles.userId, userId));
}
