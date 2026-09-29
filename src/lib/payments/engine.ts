import 'server-only';
import { and, eq } from 'drizzle-orm';
import { formatUnits, parseUnits } from 'viem';
import { getDb, schema } from '@/lib/db';
import { activeNetwork, env, features, getToken, txExplorerUrl } from '@/lib/config';
import { normalizeUsername } from '@/lib/users/username';
import { resolveUsername, getUserById } from '@/lib/users/service';
import { getPrivyEmbeddedWallet, sendDelegatedTransaction, signDelegatedTypedData } from '@/lib/auth/server';
import { getWalletByUserId } from '@/lib/wallets/service';
import { buildUsdcTransfer, type PreparedUsdcTransfer } from '@/lib/celo/transaction';
import { buildTransferAuthorization, relayTransfer } from '@/lib/relayer/service';
import { celoClient } from '@/lib/celo/client';
import { assertTransition, type PaymentStatus } from './state';
import { evaluatePaymentPolicy } from './policy';
import { issueAuthorization, consumeAuthorization } from './authorization';
import type { PaymentRow } from '@/lib/db/schema';

/**
 * Payment engine (§16). Orchestrates the state machine: preview → authorize → broadcast →
 * confirm. Signing is done by the user's Privy embedded wallet on the client; the engine owns
 * validation, policy, single-use authorization, idempotency, persistence and confirmation
 * monitoring. No payment is ever reported successful before an on-chain receipt (§86).
 */

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

async function setStatus(paymentId: string, from: PaymentStatus, to: PaymentStatus, extra: Partial<PaymentRow> = {}) {
  assertTransition(from, to); // throws on an illegal transition
  const db = getDb();
  await db.update(schema.payments).set({ status: to, ...extra }).where(eq(schema.payments.id, paymentId));
}

export interface PreviewInput {
  senderUserId: string;
  senderWalletAddress: string;
  recipient: string; // @username or 0x address
  amount: string; // human, e.g. "20"
  token?: string;
  memo?: string;
  idempotencyKey: string;
}

export interface PreviewResult {
  payment: PaymentRow;
  prepared: PreparedUsdcTransfer;
  recipientDisplay: string;
}

export async function previewPayment(input: PreviewInput): Promise<{ ok: true; result: PreviewResult } | { ok: false; error: string }> {
  const token = input.token ?? 'USDC';
  const tokenInfo = getToken(token, activeNetwork.network);
  if (!tokenInfo || !tokenInfo.enabled || !tokenInfo.address) return { ok: false, error: 'Unsupported token.' };

  const db = getDb();

  // Idempotency (§20): a repeated key returns the same payment rather than creating a second.
  const existing = await db
    .select()
    .from(schema.payments)
    .where(and(eq(schema.payments.senderUserId, input.senderUserId), eq(schema.payments.idempotencyKey, input.idempotencyKey)))
    .limit(1);
  if (existing[0]) {
    const p = existing[0];
    return {
      ok: true,
      result: {
        payment: p,
        prepared: buildUsdcTransfer(p.recipientAddress, formatUnits(BigInt(p.amount), tokenInfo.decimals)),
        recipientDisplay: p.recipientAddress,
      },
    };
  }

  // Recipient resolution (§23): @username → address, else a raw address.
  let recipientAddress: string;
  let recipientUserId: string | null = null;
  let recipientDisplay: string;
  const raw = input.recipient.trim();
  if (raw.startsWith('@') || !ADDRESS_RE.test(raw)) {
    const resolved = await resolveUsername(normalizeUsername(raw));
    if (!resolved) return { ok: false, error: `No PrivyPay user @${normalizeUsername(raw)}.` };
    recipientAddress = await addressForUser(resolved.user.id);
    recipientUserId = resolved.user.id;
    recipientDisplay = '@' + resolved.profile.username;
    if (!recipientAddress) return { ok: false, error: 'That user has no wallet yet.' };
  } else {
    recipientAddress = raw;
    recipientDisplay = raw;
  }

  let amountRaw: bigint;
  try {
    amountRaw = parseUnits(input.amount, tokenInfo.decimals);
  } catch {
    return { ok: false, error: 'Invalid amount.' };
  }
  if (amountRaw <= BigInt(0)) return { ok: false, error: 'Amount must be greater than zero.' };

  const prepared = buildUsdcTransfer(recipientAddress, input.amount);

  const [payment] = await db
    .insert(schema.payments)
    .values({
      senderUserId: input.senderUserId,
      recipientUserId,
      recipientAddress,
      amount: amountRaw.toString(),
      token,
      chainId: activeNetwork.chainId,
      status: 'PREVIEW',
      memo: input.memo ?? null,
      idempotencyKey: input.idempotencyKey,
    })
    .returning();

  return { ok: true, result: { payment, prepared, recipientDisplay } };
}

async function addressForUser(userId: string): Promise<string> {
  const db = getDb();
  const rows = await db
    .select({ address: schema.wallets.address })
    .from(schema.wallets)
    .where(and(eq(schema.wallets.userId, userId), eq(schema.wallets.chainId, activeNetwork.chainId)))
    .limit(1);
  return rows[0]?.address ?? '';
}

async function loadOwned(paymentId: string, userId: string): Promise<PaymentRow | null> {
  const db = getDb();
  const rows = await db.select().from(schema.payments).where(eq(schema.payments.id, paymentId)).limit(1);
  const p = rows[0];
  if (!p || p.senderUserId !== userId) return null; // ownership (§80)
  return p;
}

export async function authorizePayment(input: { paymentId: string; userId: string; senderWalletAddress: string }): Promise<
  | { ok: true; authorizationId: string; prepared: PreparedUsdcTransfer; from: string; recipient: string; amountRaw: string }
  | { ok: false; error: string }
> {
  const payment = await loadOwned(input.paymentId, input.userId);
  if (!payment) return { ok: false, error: 'Payment not found.' };
  if (payment.status !== 'PREVIEW') return { ok: false, error: 'Payment is not awaiting authorization.' };

  const policy = await evaluatePaymentPolicy({
    senderUserId: payment.senderUserId,
    senderWalletAddress: input.senderWalletAddress,
    recipientAddress: payment.recipientAddress,
    token: payment.token,
    amountRaw: payment.amount,
  });
  if (policy.effect === 'DENY') return { ok: false, error: policy.reason ?? 'Payment not allowed.' };

  await setStatus(payment.id, 'PREVIEW', 'AWAITING_AUTHORIZATION');
  await setStatus(payment.id, 'AWAITING_AUTHORIZATION', 'AUTHORIZED', { authorizedAt: new Date() });

  const auth = await issueAuthorization({
    paymentId: payment.id,
    userId: input.userId,
    amount: payment.amount,
    recipientAddress: payment.recipientAddress,
    token: payment.token,
    chainId: payment.chainId,
  });

  const decimals = getToken(payment.token, activeNetwork.network)?.decimals ?? 6;
  const prepared = buildUsdcTransfer(payment.recipientAddress, formatUnits(BigInt(payment.amount), decimals));
  // The client must sign with exactly this wallet — the one policy validated and authorized —
  // never "whatever wallet is first" (§80). A user can hold more than one embedded wallet.
  return { ok: true, authorizationId: auth.id, prepared, from: input.senderWalletAddress, recipient: payment.recipientAddress, amountRaw: payment.amount };
}

/**
 * Broadcast a settlement from a delegated wallet and return the tx hash. Prefers the GASLESS path:
 * when the relayer is configured and the token supports EIP-3009 (USDC), the server signs a
 * `transferWithAuthorization` on the user's behalf (delegated) and the relayer submits it, paying
 * the CELO gas — so the user needs no CELO. Falls back to a direct delegated transfer (the user's
 * wallet pays gas) when the relayer isn't configured or the token isn't EIP-3009. Either way Privy
 * signs in its TEE; we never hold a key.
 */
async function settleDelegated(input: {
  walletId: string;
  from: string;
  to: string;
  amountRaw: string;
  token: string;
  chainId: number;
}): Promise<string> {
  // EIP-3009 gasless: only USDC on Celo, and only when a relayer is funded/configured.
  if (features.gaslessRelayer && input.token === 'USDC') {
    const typedData = await buildTransferAuthorization({ from: input.from, to: input.to, valueRaw: input.amountRaw });
    const { signature } = await signDelegatedTypedData({
      walletId: input.walletId,
      typedData: {
        domain: typedData.domain as unknown as Record<string, unknown>,
        types: typedData.types as unknown as Record<string, unknown>,
        message: typedData.message as unknown as Record<string, unknown>,
        primaryType: typedData.primaryType,
      },
    });
    const relayed = await relayTransfer({ message: typedData.message, signature });
    return relayed.hash;
  }
  // Direct delegated transfer — the user's wallet pays native CELO gas.
  const decimals = getToken(input.token, activeNetwork.network)?.decimals ?? 6;
  const prepared = buildUsdcTransfer(input.to, formatUnits(BigInt(input.amountRaw), decimals));
  const sent = await sendDelegatedTransaction({ walletId: input.walletId, chainId: input.chainId, to: prepared.to, data: prepared.data });
  return sent.hash;
}

/**
 * Settle an AUTHORIZED payment server-side via the user's delegated Privy wallet (§ MCP "confirm
 * in agent"). Reuses the same authorization + broadcast + confirmation path as the client flow —
 * Privy signs in its TEE, we never see a key. Prefers the gasless relayer (user needs no CELO),
 * falling back to a direct delegated send. Returns a typed reason when the wallet isn't delegated
 * or signing isn't configured, so callers can fall back to in-app approval rather than failing the
 * request. Never reports success without an on-chain receipt.
 */
export async function executeAuthorizedPayment(input: {
  paymentId: string;
  userId: string;
  authorizationId: string;
}): Promise<
  | { ok: true; status: string; txHash: string }
  | { ok: false; code: 'not_delegated' | 'not_configured' | 'error'; error: string }
> {
  const payment = await loadOwned(input.paymentId, input.userId);
  if (!payment) return { ok: false, code: 'error', error: 'Payment not found.' };
  if (payment.status !== 'AUTHORIZED') return { ok: false, code: 'error', error: 'Payment is not authorized.' };
  if (!env.PRIVY_AUTHORIZATION_KEY) return { ok: false, code: 'not_configured', error: 'Server signing is not configured.' };

  const appUser = await getUserById(input.userId);
  if (!appUser) return { ok: false, code: 'error', error: 'User not found.' };
  // Sign with EXACTLY the wallet our database has pinned for this user — the one policy checked the
  // balance and limits against — never "whichever wallet Privy lists first". A user can hold extra
  // (duplicate) embedded wallets; if the pinned one can't be found among them we refuse to sign
  // rather than fall back to a different wallet.
  const pinned = await getWalletByUserId(input.userId);
  if (!pinned) return { ok: false, code: 'error', error: 'No wallet is recorded for this account yet.' };
  const wallet = await getPrivyEmbeddedWallet(appUser.privyDid, { address: pinned.address });
  if (!wallet || !wallet.walletId) return { ok: false, code: 'error', error: 'Your account wallet could not be verified for signing.' };
  if (!wallet.delegated) return { ok: false, code: 'not_delegated', error: 'Wallet is not delegated for server signing.' };

  let hash: string;
  try {
    hash = await settleDelegated({
      walletId: wallet.walletId,
      from: wallet.address,
      to: payment.recipientAddress,
      amountRaw: payment.amount,
      token: payment.token,
      chainId: payment.chainId,
    });
  } catch (e) {
    return { ok: false, code: 'error', error: e instanceof Error ? e.message : 'Server signing failed.' };
  }

  const rec = await recordBroadcast({ paymentId: payment.id, userId: input.userId, authorizationId: input.authorizationId, txHash: hash });
  if (!rec.ok) return { ok: false, code: 'error', error: rec.error };

  // Poll briefly for a fast confirmation; otherwise leave PENDING and let the agent poll status.
  let status = 'PENDING';
  for (let i = 0; i < 5; i++) {
    const c = await confirmPayment({ paymentId: payment.id, userId: input.userId });
    if (c.ok) {
      status = c.payment.status;
      if (status === 'CONFIRMED' || status === 'FAILED') break;
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  return { ok: true, status, txHash: hash };
}

export async function recordBroadcast(input: {
  paymentId: string;
  userId: string;
  authorizationId: string;
  txHash: string;
}): Promise<{ ok: true; payment: PaymentRow } | { ok: false; error: string }> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.txHash)) return { ok: false, error: 'Invalid transaction hash.' };
  const payment = await loadOwned(input.paymentId, input.userId);
  if (!payment) return { ok: false, error: 'Payment not found.' };
  if (payment.status !== 'AUTHORIZED') return { ok: false, error: 'Payment is not authorized.' };

  const consumed = await consumeAuthorization(input.authorizationId, {
    paymentId: payment.id,
    userId: input.userId,
    amount: payment.amount,
    recipientAddress: payment.recipientAddress,
    token: payment.token,
    chainId: payment.chainId,
  });
  if (!consumed.ok) return { ok: false, error: `Authorization ${consumed.reason}.` };

  // AUTHORIZED → … → PENDING (the intermediate states are transient client-side moments).
  await setStatus(payment.id, 'AUTHORIZED', 'PREPARING');
  await setStatus(payment.id, 'PREPARING', 'SIGNING');
  await setStatus(payment.id, 'SIGNING', 'BROADCASTING');
  await setStatus(payment.id, 'BROADCASTING', 'PENDING', { txHash: input.txHash, broadcastAt: new Date() });

  const db = getDb();
  const [updated] = await db.select().from(schema.payments).where(eq(schema.payments.id, payment.id)).limit(1);
  return { ok: true, payment: updated };
}

/**
 * Check the on-chain receipt once and settle the payment. Never reports success without a real
 * confirmation (§86); stays PENDING until the transaction is mined.
 */
export async function confirmPayment(input: { paymentId: string; userId: string }): Promise<
  { ok: true; payment: PaymentRow } | { ok: false; error: string }
> {
  const payment = await loadOwned(input.paymentId, input.userId);
  if (!payment) return { ok: false, error: 'Payment not found.' };
  if (payment.status !== 'PENDING' || !payment.txHash) {
    return { ok: true, payment }; // terminal or not yet broadcast — nothing to poll
  }

  const client = celoClient();
  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: payment.txHash as `0x${string}` });
  } catch {
    return { ok: true, payment }; // not mined yet
  }

  if (receipt.status === 'success') {
    const fee = (receipt.gasUsed * receipt.effectiveGasPrice).toString();
    await setStatus(payment.id, 'PENDING', 'CONFIRMED', { confirmedAt: new Date(), feeAmount: fee });
  } else {
    await setStatus(payment.id, 'PENDING', 'FAILED', { failedAt: new Date() });
  }
  const db = getDb();
  const [updated] = await db.select().from(schema.payments).where(eq(schema.payments.id, payment.id)).limit(1);
  return { ok: true, payment: updated };
}

export async function getPayment(paymentId: string, userId: string): Promise<PaymentRow | null> {
  return loadOwned(paymentId, userId);
}

export interface PaymentSummary {
  id: string;
  direction: 'out' | 'in';
  counterparty: string; // @username or short address
  amount: string; // human, e.g. "20.00"
  token: string;
  status: PaymentStatus;
  txHash: string | null;
  explorerUrl: string | null;
  createdAt: Date;
  confirmedAt: Date | null;
}

/** The user's payments, newest first, mapped for the activity view (§75). */
export async function listPayments(userId: string, limit = 50): Promise<PaymentSummary[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.payments.id,
      recipientUserId: schema.payments.recipientUserId,
      recipientAddress: schema.payments.recipientAddress,
      amount: schema.payments.amount,
      token: schema.payments.token,
      status: schema.payments.status,
      txHash: schema.payments.txHash,
      createdAt: schema.payments.createdAt,
      confirmedAt: schema.payments.confirmedAt,
      username: schema.profiles.username,
    })
    .from(schema.payments)
    .leftJoin(schema.profiles, eq(schema.profiles.userId, schema.payments.recipientUserId))
    .where(eq(schema.payments.senderUserId, userId))
    .orderBy(schema.payments.createdAt)
    .limit(limit);

  const decimals = getToken('USDC', activeNetwork.network)?.decimals ?? 6;
  return rows
    .map((r) => ({
      id: r.id,
      direction: 'out' as const,
      counterparty: r.username ? '@' + r.username : `${r.recipientAddress.slice(0, 6)}…${r.recipientAddress.slice(-4)}`,
      amount: formatUnits(BigInt(r.amount), decimals),
      token: r.token,
      status: r.status as PaymentStatus,
      txHash: r.txHash,
      explorerUrl: r.txHash ? txExplorerUrl(r.txHash) : null,
      createdAt: r.createdAt,
      confirmedAt: r.confirmedAt,
    }))
    .reverse(); // newest first (orderBy is ascending by default)
}
