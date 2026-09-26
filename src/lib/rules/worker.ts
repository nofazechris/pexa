import 'server-only';
import { and, asc, eq, gt } from 'drizzle-orm';
import { formatUnits } from 'viem';
import { getDb, schema } from '@/lib/db';
import { activeNetwork, getToken } from '@/lib/config';
import { getWalletByUserId } from '@/lib/wallets/service';
import { getUsdcBalance } from '@/lib/celo/balance';
import { previewPayment, authorizePayment, executeAuthorizedPayment } from '@/lib/payments/engine';
import { exceedsAutonomousCap } from '@/lib/payments/policy';
import { depositToVault } from '@/lib/vaults/service';
import type { MoneyRuleRow } from '@/lib/db/schema';

/**
 * Money-rules worker (§ automations). A scheduled trigger hits /api/cron/rules → here. Each rule
 * executes through the SAME path as any payment (preview → policy + single-use authorization →
 * delegated server signing → on-chain confirmation) and is idempotent, so a re-run can never
 * double-act. Owners who haven't delegated are skipped, not failed.
 *
 * - autosave_on_income: for each newly-confirmed INCOMING payment, move `percentBps` of it to the
 *   destination. Idempotency key `rule_<ruleId>_<sourcePaymentId>` guards against double-saving.
 * - balance_alert: flag when balance drops below the threshold (delivered proactively in chat);
 *   clears once the balance recovers, so it fires once per dip.
 */

function decimals(): number {
  return getToken('USDC', activeNetwork.network)?.decimals ?? 6;
}

/**
 * How much to save from one incoming payment: a fixed amount (capped at what actually arrived, so
 * we never save more than the payment) or a percentage. Returns smallest-unit bigint.
 */
function computeSaveRaw(incomingRaw: string, rule: MoneyRuleRow): bigint {
  const incoming = BigInt(incomingRaw);
  if (rule.fixedRaw) {
    const fixed = BigInt(rule.fixedRaw);
    return fixed < incoming ? fixed : incoming;
  }
  if (rule.percentBps) return (incoming * BigInt(rule.percentBps)) / 10000n;
  return 0n;
}

export interface RulesRunResult {
  rules: number;
  saved: number;
  skipped: number;
  failed: number;
  alertsFired: number;
  details: Array<{ id: string; result: string; reason?: string }>;
}

export async function runDueRules(limit = 100): Promise<RulesRunResult> {
  const db = getDb();
  const rules = await db.select().from(schema.moneyRules).where(eq(schema.moneyRules.status, 'active')).limit(limit);
  const out: RulesRunResult = { rules: rules.length, saved: 0, skipped: 0, failed: 0, alertsFired: 0, details: [] };

  for (const rule of rules) {
    try {
      if (rule.type === 'autosave_on_income') await runAutosave(rule, out);
      else if (rule.type === 'balance_alert') await runBalanceAlert(rule, out);
    } catch (e) {
      out.failed++;
      out.details.push({ id: rule.id, result: 'failed', reason: e instanceof Error ? e.message : 'error' });
    }
  }
  return out;
}

async function runAutosave(rule: MoneyRuleRow, out: RulesRunResult): Promise<void> {
  if (!rule.percentBps && !rule.fixedRaw) return;
  // Two flavours: earmark into a vault (no on-chain move) or send on-chain to a @username.
  if (rule.destinationVaultId) return runAutosaveToVault(rule, out);
  if (!rule.destinationUsername) return;
  const db = getDb();
  const wallet = await getWalletByUserId(rule.userId);
  if (!wallet) {
    out.skipped++;
    out.details.push({ id: rule.id, result: 'skipped', reason: 'no_wallet' });
    return;
  }
  const since = rule.lastRunAt ?? rule.createdAt;

  // Newly-confirmed incoming payments to this user, oldest first.
  const incoming = await db
    .select()
    .from(schema.payments)
    .where(and(eq(schema.payments.recipientUserId, rule.userId), eq(schema.payments.status, 'CONFIRMED'), gt(schema.payments.confirmedAt, since)))
    .orderBy(asc(schema.payments.confirmedAt))
    .limit(20);

  let cursor: Date | null = null;
  for (const p of incoming) {
    const saveRaw = computeSaveRaw(p.amount, rule);
    if (saveRaw <= 0n) {
      cursor = p.confirmedAt ?? cursor;
      continue;
    }
    // An on-chain auto-save above the autonomous ceiling waits for the user (unlike a vault
    // earmark, this moves real funds out). Leave it for approval; don't advance past it.
    if (exceedsAutonomousCap(saveRaw.toString())) {
      out.skipped++;
      out.details.push({ id: rule.id, result: 'skipped', reason: 'needs_confirmation' });
      break;
    }
    const amount = formatUnits(saveRaw, decimals());
    const idempotencyKey = `rule_${rule.id}_${p.id}`;

    const preview = await previewPayment({
      senderUserId: rule.userId,
      senderWalletAddress: wallet.address,
      recipient: '@' + rule.destinationUsername,
      amount,
      memo: 'Auto-save',
      idempotencyKey,
    });
    if (!preview.ok) {
      out.failed++;
      out.details.push({ id: rule.id, result: 'failed', reason: preview.error });
      break; // stop; retry this payment next run
    }
    const sp = preview.result.payment;
    if (['CONFIRMED', 'PENDING', 'BROADCASTING'].includes(sp.status)) {
      out.saved++;
      cursor = p.confirmedAt ?? cursor; // already handled (idempotent replay)
      continue;
    }
    if (sp.status !== 'PREVIEW') {
      out.skipped++;
      break; // stuck in an odd state — leave for attention
    }
    const auth = await authorizePayment({ paymentId: sp.id, userId: rule.userId, senderWalletAddress: wallet.address });
    if (!auth.ok) {
      out.failed++;
      out.details.push({ id: rule.id, result: 'failed', reason: auth.error });
      break;
    }
    const exec = await executeAuthorizedPayment({ paymentId: sp.id, userId: rule.userId, authorizationId: auth.authorizationId });
    if (exec.ok) {
      out.saved++;
      cursor = p.confirmedAt ?? cursor;
    } else if (exec.code === 'not_delegated' || exec.code === 'not_configured') {
      out.skipped++;
      out.details.push({ id: rule.id, result: 'skipped', reason: exec.code });
      break; // owner hasn't enabled agent payments — wait, don't advance past this payment
    } else {
      out.failed++;
      out.details.push({ id: rule.id, result: 'failed', reason: exec.error });
      break;
    }
  }

  if (cursor) {
    await db.update(schema.moneyRules).set({ lastRunAt: cursor, updatedAt: new Date() }).where(eq(schema.moneyRules.id, rule.id));
  }
}

/**
 * Auto-save into a vault: for each newly-confirmed incoming payment, earmark `percentBps` of it.
 * This is a ledger move within the user's own wallet — no on-chain transfer, no gas, no delegation
 * — so it works regardless of whether the user has delegated their wallet. Idempotency key
 * `autosave_<paymentId>` guards against double-earmarking on a re-run.
 */
async function runAutosaveToVault(rule: MoneyRuleRow, out: RulesRunResult): Promise<void> {
  if (!rule.destinationVaultId || (!rule.percentBps && !rule.fixedRaw)) return;
  const db = getDb();
  const since = rule.lastRunAt ?? rule.createdAt;

  const incoming = await db
    .select()
    .from(schema.payments)
    .where(and(eq(schema.payments.recipientUserId, rule.userId), eq(schema.payments.status, 'CONFIRMED'), gt(schema.payments.confirmedAt, since)))
    .orderBy(asc(schema.payments.confirmedAt))
    .limit(20);

  let cursor: Date | null = null;
  for (const p of incoming) {
    const saveRaw = computeSaveRaw(p.amount, rule);
    if (saveRaw > 0n) {
      const res = await depositToVault(rule.userId, {
        vaultId: rule.destinationVaultId,
        amountRaw: saveRaw.toString(),
        source: 'autosave',
        ref: `autosave_${p.id}`,
        note: 'Auto-save',
      });
      if (!res.ok) {
        out.failed++;
        out.details.push({ id: rule.id, result: 'failed', reason: res.error });
        break; // e.g. vault archived — leave for attention, don't advance
      }
      out.saved++;
    }
    cursor = p.confirmedAt ?? cursor;
  }

  if (cursor) {
    await db.update(schema.moneyRules).set({ lastRunAt: cursor, updatedAt: new Date() }).where(eq(schema.moneyRules.id, rule.id));
  }
}

async function runBalanceAlert(rule: MoneyRuleRow, out: RulesRunResult): Promise<void> {
  if (!rule.thresholdRaw) return;
  const db = getDb();
  const wallet = await getWalletByUserId(rule.userId);
  if (!wallet) return;
  const bal = await getUsdcBalance(wallet.address);
  if (!bal) return;

  const below = BigInt(bal.raw) < BigInt(rule.thresholdRaw);
  if (below && !rule.lastTriggeredAt) {
    await db.update(schema.moneyRules).set({ lastTriggeredAt: new Date(), updatedAt: new Date() }).where(eq(schema.moneyRules.id, rule.id));
    out.alertsFired++;
    out.details.push({ id: rule.id, result: 'alert_fired' });
  } else if (!below && rule.lastTriggeredAt) {
    // Balance recovered — reset so it can fire again on the next dip.
    await db.update(schema.moneyRules).set({ lastTriggeredAt: null, updatedAt: new Date() }).where(eq(schema.moneyRules.id, rule.id));
  }
}

/** Active balance-alert rules currently in the triggered state — surfaced proactively in chat. */
export async function activeAlerts(userId: string): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.moneyRules)
    .where(and(eq(schema.moneyRules.userId, userId), eq(schema.moneyRules.type, 'balance_alert'), eq(schema.moneyRules.status, 'active')));
  return rows.filter((r) => r.lastTriggeredAt).map((r) => r.description);
}
