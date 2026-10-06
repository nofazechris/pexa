/**
 * x402 buyer core — the protocol half of Pexa's integration with Celo's "Buy" marketplace.
 *
 * x402 turns HTTP 402 into a payment step: ask for a paid resource, the server answers 402 with what
 * it wants, the buyer signs a USDC `transferWithAuthorization` (EIP-3009) off-chain, and retries with
 * that signature in a header; the gateway's facilitator submits it on Celo and pays the gas. Every
 * function here is pure (no network, no database, no keys) so the safety-critical parts — what we
 * agree to pay, to whom, and how a response is interpreted — are fully unit-tested.
 *
 * The rules this file enforces, because x402 payments are irreversible:
 *   - only ever talk to Buy's own hosts;
 *   - only ever pay the address and asset the catalog vouches for, for the exact resource we asked for;
 *   - never agree to more than the amount the caller approved;
 *   - never treat an ambiguous outcome as "safe to retry".
 */
import { z } from 'zod';
import { recoverTypedDataAddress, type Hex } from 'viem';
import { payTokenByAddress, type PayToken, type PayTokenSymbol } from './tokens';

/** Buy's gateway hosts. Anything else is refused before a single byte is sent. */
export const BUY_ALLOWED_HOSTS: ReadonlySet<string> = new Set(['gateway.usebuy.ai', 'usebuy.ai']);

/** Celo mainnet. Buy settles on mainnet only (there is no testnet deployment). */
export const CELO_MAINNET_CHAIN_ID = 42220;


export function isAllowedBuyUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && BUY_ALLOWED_HOSTS.has(u.hostname) && !u.username && !u.password && (u.port === '' || u.port === '443');
  } catch {
    return false;
  }
}

// --- the 402 challenge ------------------------------------------------------------------------

const requirementSchema = z
  .object({
    scheme: z.string(),
    network: z.string(),
    maxAmountRequired: z.string().regex(/^\d+$/),
    resource: z.string().optional(),
    description: z.string().optional(),
    payTo: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    maxTimeoutSeconds: z.number().int().positive().max(3600),
    asset: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    extra: z.object({ name: z.string().optional(), version: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

const challengeSchema = z
  .object({ x402Version: z.number().int().min(1), accepts: z.array(requirementSchema).min(1), error: z.string().optional() })
  .passthrough();

export type PaymentRequirement = z.infer<typeof requirementSchema>;
export type PaymentChallenge = z.infer<typeof challengeSchema>;

/** Parse a 402 body. Returns null for anything that isn't a well-formed x402 challenge. */
export function parsePaymentChallenge(body: unknown): PaymentChallenge | null {
  const parsed = challengeSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function isCeloExact(r: PaymentRequirement): boolean {
  return r.scheme === 'exact' && (r.network === 'celo' || r.network === `eip155:${CELO_MAINNET_CHAIN_ID}`);
}

/** The `exact`-scheme Celo option for `token` from a challenge, if it offers one. */
export function selectRequirement(challenge: PaymentChallenge, token: PayToken): PaymentRequirement | null {
  return challenge.accepts.find((r) => isCeloExact(r) && sameAddress(r.asset, token.address)) ?? null;
}

/** Which of our pay tokens a challenge offers on Celo (anything else it lists is ignored). */
export function offeredTokens(challenge: PaymentChallenge): PayTokenSymbol[] {
  const out = new Set<PayTokenSymbol>();
  for (const r of challenge.accepts) {
    if (!isCeloExact(r)) continue;
    const t = payTokenByAddress(r.asset);
    if (t) out.add(t.symbol);
  }
  return [...out];
}

/**
 * Decide whether we are willing to pay this requirement. Returns a human-readable reason to REFUSE, or
 * null when it's acceptable. The expectations come from OUR side (the vouched-for catalog and the exact
 * request we made), never from the challenge itself — a hostile or compromised response can't talk us
 * into paying a different address, for a different resource, or more than was approved.
 */
export function checkRequirement(
  req: PaymentRequirement,
  expected: { payTo: string; resource: string; token: PayToken; maxAtomic: bigint },
): string | null {
  if (!sameAddress(req.payTo, expected.payTo)) return 'The payment address does not match the one Buy publishes.';
  if (!sameAddress(req.asset, expected.token.address)) return `The payment token is not ${expected.token.symbol} on Celo.`;
  if (req.resource && req.resource !== expected.resource) return 'The payment is for a different resource than the one requested.';
  if (req.extra?.name !== expected.token.eip712.name || req.extra?.version !== expected.token.eip712.version) return 'Unexpected token signing parameters.';
  const amount = BigInt(req.maxAmountRequired);
  if (amount <= 0n) return 'The quoted price is not a positive amount.';
  if (amount > expected.maxAtomic) return 'The price is higher than the approved amount.';
  return null;
}

// --- the payment authorization ----------------------------------------------------------------

const EIP712_DOMAIN_TYPE = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
] as const;

const TRANSFER_WITH_AUTHORIZATION_TYPE = [
  { name: 'from', type: 'address' },
  { name: 'to', type: 'address' },
  { name: 'value', type: 'uint256' },
  { name: 'validAfter', type: 'uint256' },
  { name: 'validBefore', type: 'uint256' },
  { name: 'nonce', type: 'bytes32' },
] as const;

export interface AuthorizationMessage {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

export interface AuthorizationTypedData {
  domain: { name: string; version: string; chainId: number; verifyingContract: string };
  types: { EIP712Domain: readonly { name: string; type: string }[]; TransferWithAuthorization: readonly { name: string; type: string }[] };
  primaryType: 'TransferWithAuthorization';
  message: AuthorizationMessage;
}

function randomNonce(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return '0x' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The EIP-3009 authorization for paying `requirement` from `from`. The window opens slightly in the
 * past (clock skew) and closes within the requirement's own timeout, so a signature that is never
 * used goes stale quickly instead of lingering as a valid payment instrument.
 */
export function buildAuthorization(input: { from: string; requirement: PaymentRequirement; token: PayToken; nowSec: number; nonce?: string }): AuthorizationTypedData {
  const { requirement: r, token } = input;
  return {
    domain: { name: token.eip712.name, version: token.eip712.version, chainId: CELO_MAINNET_CHAIN_ID, verifyingContract: token.address },
    types: { EIP712Domain: EIP712_DOMAIN_TYPE, TransferWithAuthorization: TRANSFER_WITH_AUTHORIZATION_TYPE },
    primaryType: 'TransferWithAuthorization',
    message: {
      from: input.from,
      to: r.payTo,
      value: r.maxAmountRequired,
      validAfter: String(input.nowSec - 600),
      validBefore: String(input.nowSec + Math.min(r.maxTimeoutSeconds, 600)),
      nonce: input.nonce ?? randomNonce(),
    },
  };
}

/** True when `signature` really is `typedData.message.from`'s signature over that exact authorization. */
export async function verifyAuthorizationSignature(typedData: AuthorizationTypedData, signature: string): Promise<boolean> {
  try {
    const m = typedData.message;
    const recovered = await recoverTypedDataAddress({
      domain: { name: typedData.domain.name, version: typedData.domain.version, chainId: typedData.domain.chainId, verifyingContract: typedData.domain.verifyingContract as Hex },
      types: { TransferWithAuthorization: typedData.types.TransferWithAuthorization },
      primaryType: 'TransferWithAuthorization',
      message: {
        from: m.from as Hex,
        to: m.to as Hex,
        value: BigInt(m.value),
        validAfter: BigInt(m.validAfter),
        validBefore: BigInt(m.validBefore),
        nonce: m.nonce as Hex,
      },
      signature: signature as Hex,
    });
    return recovered.toLowerCase() === m.from.toLowerCase();
  } catch {
    return false;
  }
}

/** The retry header carrying the signed payment. x402 v1 → `X-PAYMENT`; v2 → `PAYMENT-SIGNATURE`. */
export function buildPaymentHeader(input: {
  x402Version: number;
  requirement: PaymentRequirement;
  message: AuthorizationMessage;
  signature: string;
}): { name: string; value: string } {
  const authorization = {
    from: input.message.from,
    to: input.message.to,
    value: input.message.value,
    validAfter: input.message.validAfter,
    validBefore: input.message.validBefore,
    nonce: input.message.nonce,
  };
  const payload = { signature: input.signature, authorization };
  const body =
    input.x402Version >= 2
      ? { x402Version: input.x402Version, accepted: input.requirement, payload }
      : { x402Version: input.x402Version, scheme: input.requirement.scheme, network: input.requirement.network, payload };
  return {
    name: input.x402Version >= 2 ? 'PAYMENT-SIGNATURE' : 'X-PAYMENT',
    value: Buffer.from(JSON.stringify(body)).toString('base64'),
  };
}

// --- reading the paid response ----------------------------------------------------------------

export type PaidOutcome =
  | { kind: 'paid'; transaction: string | null; correlationId: string | null; output: unknown }
  /** The gateway refused BEFORE settling — nothing was charged, so a fresh, corrected attempt is safe. */
  | { kind: 'not_charged'; code: string; message: string }
  /** We can't prove the payment didn't settle. NEVER retry; surface the transaction/correlation id instead. */
  | { kind: 'uncertain'; code: string; message: string; transaction: string | null; correlationId: string | null; output: unknown };

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
}

/** An error code from either `{error: "code"}` or `{error: {code, message}}`. */
function errorCode(body: Record<string, unknown>): string {
  if (typeof body.error === 'string' && body.error) return body.error;
  const nested = asRecord(body.error);
  return str(nested.code) ?? str(body.code) ?? 'unknown_error';
}

function errorMessage(body: Record<string, unknown>, fallback: string): string {
  const nested = asRecord(body.error);
  return str(nested.message) ?? str(body.message) ?? str(body.detail) ?? fallback;
}

/**
 * Interpret the gateway's reply to a PAID request. The asymmetry is deliberate: only an explicit
 * pre-settlement refusal (4xx) counts as "not charged"; every 5xx — and anything we can't classify —
 * is "uncertain", because the payment settles before the work runs and a 5xx can arrive after it.
 */
export function classifyPaidResponse(status: number, rawBody: unknown, symbol = 'USDC'): PaidOutcome {
  const body = asRecord(rawBody);
  const transaction = str(body.transaction) ?? str(asRecord(body.payment).transaction);
  const correlationId = str(body.correlationId);

  if (status >= 200 && status < 300) {
    if (body.paymentSettled === false) {
      return { kind: 'uncertain', code: 'not_confirmed_settled', message: 'The service answered but did not confirm settlement.', transaction, correlationId, output: body.output ?? rawBody };
    }
    return { kind: 'paid', transaction, correlationId, output: 'output' in body ? body.output : rawBody };
  }

  // A 402 here means the payment was not accepted, so nothing was charged. The gateway re-sends its
  // challenge and puts the reason in `error`, e.g. "verify_payment_failed: bad_signature (Onchain balance
  // is not enough to cover the payment amount)" — read it so the user gets the real reason.
  if (status === 402) {
    const challenge = parsePaymentChallenge(rawBody);
    const err = typeof body.error === 'string' ? body.error.trim() : '';
    if (challenge && !err) {
      return { kind: 'not_charged', code: 'payment_not_accepted', message: 'The gateway did not accept the payment, so nothing was charged.' };
    }
    if (err && /balance/i.test(err)) {
      return { kind: 'not_charged', code: 'insufficient_balance', message: `Your wallet doesn’t have enough ${symbol} to cover this payment, so nothing was charged.` };
    }
    if (err) {
      return { kind: 'not_charged', code: err.split(':')[0].trim() || 'verify_payment_failed', message: `The payment could not be verified, so nothing was charged (${err}).` };
    }
    return { kind: 'not_charged', code: errorCode(body), message: errorMessage(body, 'The payment was not accepted, so nothing was charged.') };
  }

  if (status >= 400 && status < 500) {
    return { kind: 'not_charged', code: errorCode(body), message: errorMessage(body, `The request was rejected (HTTP ${status}).`) };
  }

  return {
    kind: 'uncertain',
    code: errorCode(body),
    message: errorMessage(body, `The service returned HTTP ${status} after payment was submitted. The payment may have gone through.`),
    transaction,
    correlationId,
    output: 'output' in body ? body.output : rawBody,
  };
}

// --- amounts ----------------------------------------------------------------------------------

/** "3606" → "0.003606"; trims trailing zeros but keeps at least two decimals (so 1_000_000 → "1.00"). */
export function formatUsdc(atomic: string | bigint): string {
  const v = typeof atomic === 'bigint' ? atomic : BigInt(atomic);
  const whole = v / 1_000_000n;
  let frac = (v % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  if (frac.length < 2) frac = frac.padEnd(2, '0');
  return `${whole}.${frac}`;
}

/** "$0.0036" style label. */
export function usdLabel(atomic: string | bigint): string {
  return `$${formatUsdc(atomic)}`;
}

/** Parse a decimal USDC string ("0.25") to atomic units, or null if it isn't a clean amount. */
export function parseUsdcToAtomic(decimal: string): bigint | null {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(decimal.trim());
  if (!m) return null;
  return BigInt(m[1]) * 1_000_000n + BigInt((m[2] ?? '').padEnd(6, '0'));
}

/**
 * Last line of defence before a payment is claimed: the typed data that was (or will be) signed must be
 * exactly the stored quote — one of OUR tokens under that token's own signing domain, the quoted payee,
 * the quoted amount, and the purchasing wallet as payer. Anything else is refused, never signed or sent.
 */
export function authorizationMatchesQuote(input: {
  typedData: AuthorizationTypedData;
  requirement: PaymentRequirement;
  priceAtomic: string;
  walletAddress: string;
}): boolean {
  const { typedData: td, requirement: r } = input;
  const token = payTokenByAddress(td.domain.verifyingContract);
  return (
    token !== null &&
    sameAddress(r.asset, token.address) &&
    td.domain.name === token.eip712.name &&
    td.domain.version === token.eip712.version &&
    td.domain.chainId === CELO_MAINNET_CHAIN_ID &&
    sameAddress(td.message.to, r.payTo) &&
    td.message.value === r.maxAmountRequired &&
    td.message.value === input.priceAtomic &&
    sameAddress(td.message.from, input.walletAddress)
  );
}
