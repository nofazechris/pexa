import 'server-only';
import { and, eq, gte, inArray } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { FIAT_LIMITS, isFiatEnabled } from '@/lib/config/fiat';
import type { KycState } from '@/lib/fiat/provider';

/**
 * Agent policy engine (§13) for fiat actions — the deterministic authority the AI can never
 * bypass. It evaluates every NGN↔USDT action and returns one of a fixed set of effects. The LLM
 * proposes; this decides. Intent is not authorization (§11): a proposed action reaches ALLOW only
 * after amount, limits, KYC, quote validity and explicit confirmation all pass.
 *
 * The core evaluator is pure over a resolved snapshot (unit-testable with no DB); the async
 * resolver gathers that snapshot (fiat totals + KYC state) and calls it.
 *
 * Amounts are NGN in kobo (integer strings) — never floats.
 */

export type AgentPolicyEffect = 'ALLOW' | 'REQUIRE_CONFIRMATION' | 'BLOCK' | 'REQUIRE_KYC' | 'REQUIRE_REAUTH';

export const AGENT_POLICY_CHECKS = [
  'fiat_enabled',
  'valid_amount',
  'min_order',
  'per_order_limit',
  'quote_valid',
  'kyc',
  'risk',
  'daily_limit',
  'monthly_limit',
  'confirmation',
] as const;

export type AgentPolicyCheck = (typeof AGENT_POLICY_CHECKS)[number];

export type FiatActionKind = 'buy' | 'sell' | 'payout' | 'fund';

export interface AgentPolicyResult {
  effect: AgentPolicyEffect;
  check?: AgentPolicyCheck;
  reason?: string;
}

export interface AgentPolicySnapshot {
  fiatEnabled: boolean;
  action: FiatActionKind;
  /** The NGN leg magnitude for limit checks, in kobo. */
  ngnAmount: string;
  minOrderNgn: string;
  perOrderNgn: string;
  dailyNgn: string;
  monthlyNgn: string;
  spentTodayNgn: string;
  spentMonthNgn: string;
  kycStatus: KycState;
  blocked: boolean;
  /** Quote expiry for buy/sell; omit for actions without a quote. */
  quoteExpiresAt?: string | Date;
  /** Whether the user has explicitly confirmed this exact action. */
  confirmed?: boolean;
  now?: number;
}

function result(effect: AgentPolicyEffect, check?: AgentPolicyCheck, reason?: string): AgentPolicyResult {
  return { effect, check, reason };
}

/** Pure policy evaluation over a resolved snapshot. No I/O — the security decisions live here. */
export function evaluateAgentPolicy(s: AgentPolicySnapshot): AgentPolicyResult {
  if (!s.fiatEnabled) return result('BLOCK', 'fiat_enabled', 'Fiat conversion is not enabled yet.');

  let amount: bigint;
  try {
    amount = BigInt(s.ngnAmount);
  } catch {
    return result('BLOCK', 'valid_amount', 'Invalid amount.');
  }
  if (amount <= 0n) return result('BLOCK', 'valid_amount', 'Amount must be greater than zero.');
  if (amount < BigInt(s.minOrderNgn)) return result('BLOCK', 'min_order', 'Amount is below the minimum order size.');
  if (amount > BigInt(s.perOrderNgn)) return result('BLOCK', 'per_order_limit', 'Amount exceeds the per-order limit.');

  // Quote must still be valid at decision time (§14). Expiry alone doesn't need re-auth — the
  // agent simply re-quotes — so BLOCK with a clear reason.
  if (s.quoteExpiresAt) {
    const exp = new Date(s.quoteExpiresAt).getTime();
    if (!Number.isFinite(exp) || exp <= (s.now ?? Date.now())) {
      return result('BLOCK', 'quote_valid', 'This quote has expired. Ask for a fresh quote.');
    }
  }

  // Compliance gates cannot be bypassed (§14, §23).
  if (s.kycStatus !== 'verified') return result('REQUIRE_KYC', 'kyc', 'Additional verification is required to continue.');
  if (s.blocked) return result('BLOCK', 'risk', 'This account is restricted from fiat conversion.');

  // Rolling limits — committed total in the window plus this action must stay within the cap.
  if (amount + BigInt(s.spentTodayNgn) > BigInt(s.dailyNgn)) {
    return result('BLOCK', 'daily_limit', 'This would exceed your daily conversion limit.');
  }
  if (amount + BigInt(s.spentMonthNgn) > BigInt(s.monthlyNgn)) {
    return result('BLOCK', 'monthly_limit', 'This would exceed your monthly conversion limit.');
  }

  // Everything checks out — but an irreversible action still needs explicit confirmation (§10–11).
  if (!s.confirmed) return result('REQUIRE_CONFIRMATION', 'confirmation', 'Confirmation required to execute.');

  return result('ALLOW');
}

// Fiat-order statuses that represent a committed NGN amount counting toward rolling limits.
const COMMITTED_FIAT_STATUSES = [
  'AWAITING_FUNDING',
  'FUNDING_RECEIVED',
  'AWAITING_ASSET',
  'ASSET_RECEIVED',
  'PROCESSING',
  'PAYOUT_PROCESSING',
  'SETTLED',
  'PAID',
];

async function committedNgnSince(userId: string, since: Date): Promise<bigint> {
  const db = getDb();
  const rows = await db
    .select({ ngn: schema.fiatOrders.ngnAmount })
    .from(schema.fiatOrders)
    .where(
      and(
        eq(schema.fiatOrders.userId, userId),
        gte(schema.fiatOrders.createdAt, since),
        inArray(schema.fiatOrders.status, COMMITTED_FIAT_STATUSES),
      ),
    );
  return rows.reduce((sum, r) => sum + BigInt(r.ngn), 0n);
}

async function kycStatusFor(userId: string): Promise<{ kycStatus: KycState; blocked: boolean }> {
  const db = getDb();
  const rows = await db
    .select({ kycStatus: schema.complianceProfiles.kycStatus, riskFlags: schema.complianceProfiles.riskFlags })
    .from(schema.complianceProfiles)
    .where(eq(schema.complianceProfiles.userId, userId))
    .limit(1);
  const row = rows[0];
  if (!row) return { kycStatus: 'none', blocked: false };
  return { kycStatus: row.kycStatus as KycState, blocked: Boolean(row.riskFlags) };
}

/** Gather the snapshot from the database and evaluate. This is what services call. */
export async function evaluateFiatAction(input: {
  userId: string;
  action: FiatActionKind;
  ngnAmount: string;
  quoteExpiresAt?: string | Date;
  confirmed?: boolean;
}): Promise<AgentPolicyResult> {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  const [spentTodayNgn, spentMonthNgn, kyc] = await Promise.all([
    committedNgnSince(input.userId, startOfDay),
    committedNgnSince(input.userId, startOfMonth),
    kycStatusFor(input.userId),
  ]);

  return evaluateAgentPolicy({
    fiatEnabled: isFiatEnabled(),
    action: input.action,
    ngnAmount: input.ngnAmount,
    minOrderNgn: FIAT_LIMITS.minOrderNgn,
    perOrderNgn: FIAT_LIMITS.perOrderNgn,
    dailyNgn: FIAT_LIMITS.dailyNgn,
    monthlyNgn: FIAT_LIMITS.monthlyNgn,
    spentTodayNgn: spentTodayNgn.toString(),
    spentMonthNgn: spentMonthNgn.toString(),
    kycStatus: kyc.kycStatus,
    blocked: kyc.blocked,
    quoteExpiresAt: input.quoteExpiresAt,
    confirmed: input.confirmed,
  });
}
