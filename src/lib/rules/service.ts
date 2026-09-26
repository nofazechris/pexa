import 'server-only';
import { and, desc, eq } from 'drizzle-orm';
import { parseUnits, formatUnits } from 'viem';
import { getDb, schema } from '@/lib/db';
import { activeNetwork, getToken } from '@/lib/config';
import { resolveUsername } from '@/lib/users/service';
import { normalizeUsername } from '@/lib/users/username';
import { findVault } from '@/lib/vaults/service';
import type { MoneyRuleRow } from '@/lib/db/schema';

/**
 * Programmable money rules (§ automations). Users describe an automation in chat; the agent calls
 * these to create/manage it. Creating a rule is reversible config (pause/cancel) and moves no money;
 * the money move happens later in the worker, through the payment engine + policy + delegated signing.
 */

export type RuleView = {
  id: string;
  type: string;
  status: string;
  description: string;
};

function decimals(token = 'USDC'): number {
  return getToken(token, activeNetwork.network)?.decimals ?? 6;
}

function view(r: MoneyRuleRow): RuleView {
  return { id: r.id, type: r.type, status: r.status, description: r.description };
}

/** "Save X% of every incoming payment to @destination." */
export async function createAutosaveRule(
  userId: string,
  input: { percent: number; destinationUsername: string },
): Promise<{ ok: true; rule: RuleView } | { ok: false; error: string }> {
  const percent = Math.round(input.percent);
  if (!Number.isFinite(percent) || percent < 1 || percent > 100) return { ok: false, error: 'Percent must be between 1 and 100.' };
  const dest = normalizeUsername(input.destinationUsername);
  const resolved = await resolveUsername(dest);
  if (!resolved) return { ok: false, error: `No Pexa user @${dest} to save to.` };
  if (resolved.user.id === userId) return { ok: false, error: 'Choose a different account to save into.' };

  const db = getDb();
  const [row] = await db
    .insert(schema.moneyRules)
    .values({
      userId,
      type: 'autosave_on_income',
      description: `Save ${percent}% of incoming payments to @${resolved.profile.username}`,
      percentBps: percent * 100,
      destinationUserId: resolved.user.id,
      destinationUsername: resolved.profile.username,
      token: 'USDC',
      lastRunAt: new Date(), // only save on payments received from now on
    })
    .returning();
  return { ok: true, rule: view(row) };
}

/** "Save X% of every incoming payment into my <vault> vault." An earmark — no on-chain move. */
export async function createAutosaveToVaultRule(
  userId: string,
  input: { percent: number; vault: string },
): Promise<{ ok: true; rule: RuleView } | { ok: false; error: string }> {
  const percent = Math.round(input.percent);
  if (!Number.isFinite(percent) || percent < 1 || percent > 100) return { ok: false, error: 'Percent must be between 1 and 100.' };
  const vault = await findVault(userId, input.vault);
  if (!vault) return { ok: false, error: `No vault called "${input.vault}". Create it first.` };

  const db = getDb();
  const [row] = await db
    .insert(schema.moneyRules)
    .values({
      userId,
      type: 'autosave_on_income',
      description: `Save ${percent}% of incoming payments into your "${vault.name}" vault`,
      percentBps: percent * 100,
      destinationVaultId: vault.id,
      token: 'USDC',
      lastRunAt: new Date(), // only save on payments received from now on
    })
    .returning();
  return { ok: true, rule: view(row) };
}

/** "Tell me when my balance drops below $X." */
export async function createBalanceAlertRule(
  userId: string,
  input: { threshold: string },
): Promise<{ ok: true; rule: RuleView } | { ok: false; error: string }> {
  let thresholdRaw: bigint;
  try {
    thresholdRaw = parseUnits(input.threshold as `${number}`, decimals());
  } catch {
    return { ok: false, error: 'Invalid threshold amount.' };
  }
  if (thresholdRaw <= 0n) return { ok: false, error: 'Threshold must be greater than zero.' };

  const db = getDb();
  const [row] = await db
    .insert(schema.moneyRules)
    .values({
      userId,
      type: 'balance_alert',
      description: `Alert when balance drops below $${formatUnits(thresholdRaw, decimals())}`,
      token: 'USDC',
      thresholdRaw: thresholdRaw.toString(),
    })
    .returning();
  return { ok: true, rule: view(row) };
}

export async function listRules(userId: string): Promise<RuleView[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.moneyRules)
    .where(eq(schema.moneyRules.userId, userId))
    .orderBy(desc(schema.moneyRules.createdAt));
  return rows.filter((r) => r.status !== 'cancelled').map(view);
}

export async function setRuleStatus(
  userId: string,
  id: string,
  status: 'active' | 'paused' | 'cancelled',
): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = getDb();
  const res = await db
    .update(schema.moneyRules)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(schema.moneyRules.id, id), eq(schema.moneyRules.userId, userId)))
    .returning();
  if (res.length === 0) return { ok: false, error: 'Rule not found.' };
  return { ok: true };
}
