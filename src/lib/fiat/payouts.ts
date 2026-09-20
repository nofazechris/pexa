import 'server-only';
import { and, desc, eq } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import type { PayoutAccountRow } from '@/lib/db/schema';
import { getFiatProvider } from './index';
import { getFiatQuote, createFiatOrder, orderKeyForQuote } from './service';
import type { AgentPolicyResult } from '@/lib/policy/agent';

/**
 * Payout accounts & withdrawals (§7). Bank details are never stored in plaintext — the provider
 * verifies the account and returns a tokenized reference, which is what we persist and use for
 * payouts. A withdrawal is an off-ramp: we sell enough USDT to net the requested naira and pay it
 * to a linked bank account, going through the same quote → policy → order path as any conversion.
 */

/** Verify a Nigerian bank account with the provider and save its tokenized reference. Idempotent. */
export async function verifyPayoutAccount(
  userId: string,
  input: { accountNumber: string; bankCode: string },
): Promise<{ ok: true; account: PayoutAccountRow } | { ok: false; error: string }> {
  const provider = getFiatProvider();
  let verified;
  try {
    verified = await provider.verifyBankAccount({ accountNumber: input.accountNumber, bankCode: input.bankCode });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not verify that bank account.' };
  }

  const db = getDb();
  const existing = await db
    .select()
    .from(schema.payoutAccounts)
    .where(and(eq(schema.payoutAccounts.userId, userId), eq(schema.payoutAccounts.providerRef, verified.providerRef)))
    .limit(1);
  if (existing[0]) return { ok: true, account: existing[0] };

  const [account] = await db
    .insert(schema.payoutAccounts)
    .values({
      userId,
      provider: provider.id,
      providerRef: verified.providerRef,
      bankName: verified.bankName,
      accountName: verified.accountName,
      last4: verified.last4,
    })
    .returning();
  return { ok: true, account };
}

export async function listPayoutAccounts(userId: string): Promise<PayoutAccountRow[]> {
  const db = getDb();
  return db
    .select()
    .from(schema.payoutAccounts)
    .where(eq(schema.payoutAccounts.userId, userId))
    .orderBy(desc(schema.payoutAccounts.createdAt));
}

export async function deletePayoutAccount(userId: string, id: string): Promise<void> {
  const db = getDb();
  await db
    .delete(schema.payoutAccounts)
    .where(and(eq(schema.payoutAccounts.id, id), eq(schema.payoutAccounts.userId, userId)));
}

/**
 * Withdraw naira to a linked bank account (an off-ramp). Quotes a NGN-denominated sell, runs the
 * policy engine, and creates the order that pays out. Nothing settles here — the order advances via
 * verified provider webhooks.
 */
export async function createPayout(
  userId: string,
  input: { amountNgn: string; payoutAccountId?: string; idempotencyKey?: string },
): Promise<{ ok: true; orderId: string; status: string } | { ok: false; error: string; policy?: AgentPolicyResult }> {
  const quote = await getFiatQuote({ userId, side: 'sell', amount: input.amountNgn, amountCurrency: 'NGN' });
  if (!quote.ok) return { ok: false, error: quote.error, policy: quote.policy };

  const order = await createFiatOrder({
    userId,
    quoteId: quote.result.quote.id,
    payoutAccountId: input.payoutAccountId,
    idempotencyKey: input.idempotencyKey ?? orderKeyForQuote(quote.result.quote.id),
  });
  if (!order.ok) return { ok: false, error: order.error, policy: order.policy };
  return { ok: true, orderId: order.order.id, status: order.order.status };
}
