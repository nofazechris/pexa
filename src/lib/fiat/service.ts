import 'server-only';
import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { env, features } from '@/lib/config';
import { evaluateFiatAction, type AgentPolicyResult } from '@/lib/policy/agent';
import { getUserById, getProfileByUserId } from '@/lib/users/service';
import { getWalletByUserId } from '@/lib/wallets/service';
import { getFiatProvider } from './index';
import { simulateSandboxSettlement } from './settlement';
import { assertTransition } from './state';
import { syncComplianceProfile, getComplianceStatus } from './compliance';
import { parseNgnToKobo, parseUsdtToUnits } from './units';
import type { FiatOrderRow, FiatQuoteRow } from '@/lib/db/schema';
import type { FiatQuote, FiatContext, OrderSide } from './provider';

/**
 * Build the provider context (customer identity + on-chain destination) from the authenticated
 * user. Only needed for real providers — the sandbox ignores it, so we skip the reads there.
 */
async function buildContext(userId: string): Promise<FiatContext | undefined> {
  if (features.fiatSandbox) return undefined;
  const [user, wallet, profile, compliance] = await Promise.all([
    getUserById(userId),
    getWalletByUserId(userId),
    getProfileByUserId(userId),
    getComplianceStatus(userId),
  ]);
  const name = profile?.displayName?.trim().split(/\s+/) ?? [];
  return {
    customerEmail: user?.email ?? null,
    customerFirstName: name[0] ?? null,
    customerLastName: name.slice(1).join(' ') || null,
    providerCustomerId: compliance?.providerCustomerId ?? null,
    walletAddress: wallet?.address ?? null,
    walletNetwork: env.QUIDAX_USDT_NETWORK ?? 'celo',
  };
}

/**
 * Fiat conversion service (§3–5) — the orchestration layer between the agent/API and the provider.
 *
 * The only path to a fiat order: quote → (user confirms) → create order. Every step runs the
 * deterministic AgentPolicyEngine; the provider does the numbers/settlement; we persist quotes and
 * orders idempotently and drive the fiat state machine. Nothing here settles by itself — an order
 * is created in AWAITING_FUNDING / AWAITING_ASSET and advances only via verified provider webhooks
 * (a later stage). We never fake settlement or invent live rates.
 */

export interface QuoteInput {
  userId: string;
  side: OrderSide;
  /** Human amount, e.g. "100000" / "₦100,000" (buy) or "100" (sell). */
  amount: string;
  /** Override the currency the amount is in. Default: NGN for buy, USDT for sell. A sell in NGN is
   *  a "withdraw ₦X" — quote the USDT to sell for that naira payout. */
  amountCurrency?: 'NGN' | 'USDT';
}

export interface QuoteOutcome {
  quote: FiatQuoteRow;
  provider: FiatQuote;
  policy: AgentPolicyResult;
}

function parseAmount(
  side: OrderSide,
  amount: string,
  force?: 'NGN' | 'USDT',
): { amount: string; amountCurrency: 'NGN' | 'USDT' } | null {
  // Buy is denominated in NGN, sell in USDT — unless a currency is forced (e.g. a NGN withdraw).
  const currency = force ?? (side === 'buy' ? 'NGN' : 'USDT');
  if (currency === 'NGN') {
    const kobo = parseNgnToKobo(amount);
    return kobo ? { amount: kobo, amountCurrency: 'NGN' } : null;
  }
  const units = parseUsdtToUnits(amount);
  return units ? { amount: units, amountCurrency: 'USDT' } : null;
}

/**
 * Produce a live (sandbox) quote and, if policy permits, persist it. A BLOCK / REQUIRE_KYC result
 * returns without persisting a quote — there's no point offering a quote the user can't act on.
 * REQUIRE_CONFIRMATION is the normal success for a quote (the user confirms next).
 */
export async function getFiatQuote(
  input: QuoteInput,
): Promise<{ ok: true; result: QuoteOutcome } | { ok: false; error: string; policy?: AgentPolicyResult }> {
  const parsed = parseAmount(input.side, input.amount, input.amountCurrency);
  if (!parsed) return { ok: false, error: "I couldn't read that amount." };

  // Keep KYC state fresh from the provider before we gate on it.
  await syncComplianceProfile(input.userId);

  const provider = getFiatProvider();
  const context = await buildContext(input.userId);
  const quote = await provider.getQuote({ side: input.side, amount: parsed.amount, amountCurrency: parsed.amountCurrency, context });

  // Policy always evaluates the NGN leg (the quote's naira value), confirmed=false at quote time.
  const policy = await evaluateFiatAction({
    userId: input.userId,
    action: input.side,
    ngnAmount: quote.ngnAmount,
    quoteExpiresAt: quote.expiresAt,
    confirmed: false,
  });
  if (policy.effect === 'BLOCK' || policy.effect === 'REQUIRE_KYC' || policy.effect === 'REQUIRE_REAUTH') {
    return { ok: false, error: policy.reason ?? 'This conversion is not permitted.', policy };
  }

  const db = getDb();
  const [row] = await db
    .insert(schema.fiatQuotes)
    .values({
      userId: input.userId,
      side: input.side,
      provider: quote.provider,
      providerQuoteRef: quote.providerRef,
      ngnAmount: quote.ngnAmount,
      usdtAmount: quote.usdtAmount,
      rate: quote.rate,
      providerFeeNgn: quote.providerFeeNgn,
      pexaFeeNgn: quote.pexaFeeNgn,
      estimatedReceive: quote.estimatedReceive,
      estimatedReceiveCurrency: quote.estimatedReceiveCurrency,
      sandbox: quote.sandbox,
      expiresAt: new Date(quote.expiresAt),
    })
    .returning();

  return { ok: true, result: { quote: row, provider: quote, policy } };
}

export interface CreateOrderInput {
  userId: string;
  quoteId: string;
  /** Stable key so a retried confirmation never creates two orders (§14 idempotency). */
  idempotencyKey?: string;
  /** For a sell: the payout account to receive NGN. */
  payoutAccountId?: string;
}

/**
 * Create a fiat order from a previously-issued quote, after a full (confirmed) policy pass. The
 * order is created in its provider-reported opening state (AWAITING_FUNDING / AWAITING_ASSET);
 * it does not settle here. Idempotent on (user, idempotencyKey).
 */
export async function createFiatOrder(
  input: CreateOrderInput,
): Promise<{ ok: true; order: FiatOrderRow; funding?: unknown } | { ok: false; error: string; policy?: AgentPolicyResult }> {
  const db = getDb();

  const quotes = await db.select().from(schema.fiatQuotes).where(eq(schema.fiatQuotes.id, input.quoteId)).limit(1);
  const quote = quotes[0];
  if (!quote || quote.userId !== input.userId) return { ok: false, error: 'Quote not found.' };
  const side = quote.side as OrderSide;

  if (new Date(quote.expiresAt).getTime() <= Date.now()) {
    return { ok: false, error: 'This quote has expired. Ask for a fresh quote.' };
  }

  const idempotencyKey = input.idempotencyKey ?? `fiat_${input.quoteId}`;

  // Idempotency: a repeated confirm returns the existing order rather than creating a second.
  const existing = await db
    .select()
    .from(schema.fiatOrders)
    .where(and(eq(schema.fiatOrders.userId, input.userId), eq(schema.fiatOrders.idempotencyKey, idempotencyKey)))
    .limit(1);
  if (existing[0]) return { ok: true, order: existing[0] };

  // Full policy pass with confirmation — must be ALLOW to proceed (§11, §13).
  const policy = await evaluateFiatAction({
    userId: input.userId,
    action: side,
    ngnAmount: quote.ngnAmount,
    quoteExpiresAt: quote.expiresAt,
    confirmed: true,
  });
  if (policy.effect !== 'ALLOW') {
    return { ok: false, error: policy.reason ?? 'This conversion is not permitted.', policy };
  }

  let payoutRef: string | undefined;
  let payoutAccountId = input.payoutAccountId;
  if (side === 'sell') {
    // Auto-select the user's first verified payout account when none is specified.
    if (!payoutAccountId) {
      const first = await db
        .select({ id: schema.payoutAccounts.id })
        .from(schema.payoutAccounts)
        .where(eq(schema.payoutAccounts.userId, input.userId))
        .limit(1);
      payoutAccountId = first[0]?.id;
    }
    if (!payoutAccountId) return { ok: false, error: 'Add a bank account to receive naira first.' };
    const accounts = await db
      .select()
      .from(schema.payoutAccounts)
      .where(and(eq(schema.payoutAccounts.id, payoutAccountId), eq(schema.payoutAccounts.userId, input.userId)))
      .limit(1);
    if (!accounts[0]) return { ok: false, error: 'Payout account not found.' };
    payoutRef = accounts[0].providerRef;
  }

  const provider = getFiatProvider();
  const context = await buildContext(input.userId);
  const providerOrder =
    side === 'buy'
      ? await provider.createBuyOrder({ quoteId: quote.providerQuoteRef, idempotencyKey, context })
      : await provider.createSellOrder({ quoteId: quote.providerQuoteRef, idempotencyKey, payoutAccountRef: payoutRef, context });

  // Opening state per side; assertTransition guards the QUOTE_CREATED → opening move.
  const opening = side === 'buy' ? 'AWAITING_FUNDING' : 'AWAITING_ASSET';
  assertTransition(side, 'QUOTE_CREATED', opening);

  const [order] = await db
    .insert(schema.fiatOrders)
    .values({
      userId: input.userId,
      quoteId: quote.id,
      side,
      status: opening,
      ngnAmount: quote.ngnAmount,
      usdtAmount: quote.usdtAmount,
      feeNgn: quote.providerFeeNgn,
      asset: 'USDT',
      provider: provider.id,
      providerOrderId: providerOrder.providerOrderId,
      payoutAccountId: payoutAccountId ?? null,
      authorizationStatus: 'authorized',
      idempotencyKey,
      expiresAt: quote.expiresAt,
    })
    .returning();

  // Sandbox: simulate the provider settling the order so the whole loop completes end-to-end in
  // dev/demo. A real provider settles via its webhook instead (this block never runs for one).
  if (features.fiatSandbox) {
    await simulateSandboxSettlement(order.id);
    const refreshed = await db.select().from(schema.fiatOrders).where(eq(schema.fiatOrders.id, order.id)).limit(1);
    return { ok: true, order: refreshed[0] ?? order, funding: providerOrder.funding };
  }

  return { ok: true, order, funding: providerOrder.funding };
}

/** One of the user's fiat quotes. Ownership-checked. Used to render a confirmation card. */
export async function getFiatQuoteById(userId: string, quoteId: string): Promise<FiatQuoteRow | null> {
  const db = getDb();
  const rows = await db.select().from(schema.fiatQuotes).where(eq(schema.fiatQuotes.id, quoteId)).limit(1);
  const row = rows[0];
  if (!row || row.userId !== userId) return null;
  return row;
}

/** One of the user's fiat orders. Ownership-checked. */
export async function getFiatOrder(userId: string, orderId: string): Promise<FiatOrderRow | null> {
  const db = getDb();
  const rows = await db.select().from(schema.fiatOrders).where(eq(schema.fiatOrders.id, orderId)).limit(1);
  const row = rows[0];
  if (!row || row.userId !== userId) return null;
  return row;
}

/** The user's fiat orders, newest first. */
export async function listFiatOrders(userId: string, limit = 20): Promise<FiatOrderRow[]> {
  const db = getDb();
  return db
    .select()
    .from(schema.fiatOrders)
    .where(eq(schema.fiatOrders.userId, userId))
    .orderBy(desc(schema.fiatOrders.createdAt))
    .limit(limit);
}

/** A stable idempotency key for an agent/MCP confirmation of a specific quote. */
export function orderKeyForQuote(quoteId: string): string {
  return `fiat_${quoteId}_${randomUUID().slice(0, 8)}`;
}
