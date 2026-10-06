import 'server-only';
import { after } from 'next/server';
import { and, desc, eq, gt, inArray, gte, lt } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { activeNetwork, env, txExplorerUrl } from '@/lib/config';
import { getWalletByUserId } from '@/lib/wallets/service';
import { getUserById } from '@/lib/users/service';
import { getErc20Balance } from '@/lib/celo/balance';
import { getPrivyEmbeddedWallet, signDelegatedTypedData } from '@/lib/auth/server';
import type { BuyPurchaseRow } from '@/lib/db/schema';
import {
  buildAuthorization,
  authorizationMatchesQuote,
  buildPaymentHeader,
  checkRequirement,
  classifyPaidResponse,
  isAllowedBuyUrl,
  parsePaymentChallenge,
  offeredTokens,
  selectRequirement,
  usdLabel,
  verifyAuthorizationSignature,
  CELO_MAINNET_CHAIN_ID,
  type AuthorizationTypedData,
  type PaidOutcome,
  type PaymentChallenge,
  type PaymentRequirement,
} from './x402';
import { PAY_TOKENS, PAY_TOKEN_SYMBOLS, chooseToken, isPayTokenSymbol, type PayToken, type PayTokenSymbol } from './tokens';
import {
  buildComputeCapability,
  missingRequiredFields,
  normalizeGatewayCatalog,
  searchCapabilities,
  toAgentDetail,
  toAgentSummary,
  type BuyCapability,
} from './catalog';
import { DEFAULT_BUY_SETTINGS, HARD_CAP_ATOMIC, evaluateBuyPurchase, sanitizeBuySettings, type BuyDecision, type BuySettings } from './policy';
import { parseMaybeJson, slimForAgent } from './slim';

/**
 * Buy integration service (§ Buy). Pexa's agent buys paid services from Celo's x402 marketplace on a
 * user's behalf — browser rental, social data, cloud compute — governed by the user's spending policy.
 *
 * The order of operations is the whole safety story:
 *   1. QUOTE   ask the gateway for the exact price (a free 402), and verify we'd pay only the address
 *              Buy publishes, in USDC, for exactly this resource, never above the hard cap.
 *   2. DECIDE  the policy engine says: pay automatically, ask the user first, or refuse.
 *   3. SIGN    the user's wallet signs one EIP-3009 authorization (in the browser, or server-side via
 *              delegated signing for autonomous buys).
 *   4. CLAIM   flip QUOTED → SUBMITTING with an atomic UPDATE — the single gate that makes it impossible
 *              to pay twice for one quote, however many times or from wherever it's triggered.
 *   5. PAY     send the signed payment; classify the reply; record PAID / FAILED / UNCERTAIN.
 * An UNCERTAIN purchase is never retried — the payment settles before the work runs, so a 5xx or a lost
 * connection can arrive after money moved.
 */

const GATEWAY_CATALOG_URL = 'https://gateway.usebuy.ai/v1/catalog';
const COMPUTE_CATALOG_URL = 'https://usebuy.ai/google/catalog';
const CATALOG_TTL_MS = 5 * 60 * 1000;
const QUOTE_TIMEOUT_MS = 20_000;
const PAID_TIMEOUT_MS = 270_000; // a VM purchase blocks ~1 min and occasionally several
const INLINE_WAIT_MS = 55_000; // how long an agent turn waits for a paid result before saying "still working"
const STALE_SUBMITTING_MS = 6 * 60 * 1000;
const MAX_STORED_RESPONSE_CHARS = 40_000;
const MAX_AGENT_OUTPUT_CHARS = 6_000;
const MAX_REQUEST_BODY_CHARS = 8_000;

export class BuyError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BuyError';
  }
}

/** Buy settles on Celo mainnet only — there is no testnet deployment — so the feature is mainnet-only. */
export function buyAvailable(): boolean {
  return activeNetwork.chainId === CELO_MAINNET_CHAIN_ID;
}

// --- catalog ----------------------------------------------------------------------------------

interface CatalogData {
  /** The payee Buy's catalog vouches for — what every payment is checked against. */
  payTo: string;
  capabilities: BuyCapability[];
}
let catalogCache: { at: number; data: CatalogData } | null = null;

/** Fetch with a hard timeout, never following redirects (a redirect could point off Buy's hosts). */
async function gatewayFetch(url: string, init: RequestInit & { timeoutMs: number }): Promise<Response> {
  if (!isAllowedBuyUrl(url)) throw new BuyError('host_not_allowed', 'Refusing to contact a host that isn’t Buy’s gateway.');
  const { timeoutMs, ...rest } = init;
  return fetch(url, { ...rest, redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
}

export async function getCatalog(): Promise<CatalogData> {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) return catalogCache.data;
  try {
    const [gw, compute] = await Promise.allSettled([
      gatewayFetch(GATEWAY_CATALOG_URL, { timeoutMs: 15_000 }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`catalog HTTP ${r.status}`)))),
      gatewayFetch(COMPUTE_CATALOG_URL, { timeoutMs: 15_000 }).then((r) => (r.ok ? r.json() : null)),
    ]);
    if (gw.status !== 'fulfilled') throw gw.reason;
    const { payTo, capabilities } = normalizeGatewayCatalog(gw.value);
    // Without a published payee we can't verify what we'd be paying — fail closed.
    if (!payTo) throw new BuyError('catalog_invalid', 'Buy’s catalog didn’t publish a payment address.');
    const computeCap = compute.status === 'fulfilled' ? buildComputeCapability(compute.value) : null;
    const data: CatalogData = { payTo, capabilities: computeCap ? [...capabilities, computeCap] : capabilities };
    catalogCache = { at: Date.now(), data };
    return data;
  } catch (e) {
    if (catalogCache) return catalogCache.data; // a stale catalog beats none; the 402 quote is authoritative anyway
    if (e instanceof BuyError) throw e;
    throw new BuyError('catalog_unavailable', 'Buy’s marketplace couldn’t be reached just now. Please try again in a moment.');
  }
}

export async function searchCatalog(opts: { query?: string; platform?: string; limit?: number }) {
  const { capabilities } = await getCatalog();
  const found = searchCapabilities(capabilities, opts);
  return {
    total: capabilities.length,
    categories: [...new Set(capabilities.map((c) => c.platform))].sort(),
    results: found.map(toAgentSummary),
  };
}

export async function getServiceDetail(id: string) {
  const { capabilities } = await getCatalog();
  const cap = capabilities.find((c) => c.id === id);
  return cap ? toAgentDetail(cap) : null;
}

// --- settings & spending ----------------------------------------------------------------------

export async function getBuySettings(userId: string): Promise<BuySettings> {
  const [row] = await getDb().select().from(schema.buySettings).where(eq(schema.buySettings.userId, userId)).limit(1);
  if (!row) return DEFAULT_BUY_SETTINGS;
  return {
    payToken: isPayTokenSymbol(row.payToken) ? row.payToken : DEFAULT_BUY_SETTINGS.payToken,
    autonomous: row.autonomous,
    autoLimitAtomic: BigInt(row.autoLimitAtomic),
    dailyBudgetAtomic: BigInt(row.dailyBudgetAtomic),
  };
}

export async function saveBuySettings(userId: string, input: { autonomous?: unknown; autoLimitAtomic?: unknown; dailyBudgetAtomic?: unknown; payToken?: unknown }): Promise<BuySettings> {
  const next = sanitizeBuySettings(input, await getBuySettings(userId));
  await getDb()
    .insert(schema.buySettings)
    .values({ userId, payToken: next.payToken, autonomous: next.autonomous, autoLimitAtomic: next.autoLimitAtomic.toString(), dailyBudgetAtomic: next.dailyBudgetAtomic.toString() })
    .onConflictDoUpdate({
      target: schema.buySettings.userId,
      set: { payToken: next.payToken, autonomous: next.autonomous, autoLimitAtomic: next.autoLimitAtomic.toString(), dailyBudgetAtomic: next.dailyBudgetAtomic.toString(), updatedAt: new Date() },
    });
  return next;
}

function startOfUtcDay(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** USDC spent today (UTC) on purchases that went out or may have — QUOTED/FAILED/CANCELLED never moved money. */
async function spentToday(userId: string): Promise<bigint> {
  const rows = await getDb()
    .select({ p: schema.buyPurchases.priceAtomic })
    .from(schema.buyPurchases)
    .where(
      and(
        eq(schema.buyPurchases.userId, userId),
        gte(schema.buyPurchases.createdAt, startOfUtcDay()),
        inArray(schema.buyPurchases.status, ['SUBMITTING', 'PAID', 'UNCERTAIN']),
      ),
    );
  return rows.reduce((sum, r) => sum + BigInt(r.p), 0n);
}

/** Can Pexa sign for this user without them present? Needs server signing configured AND their wallet delegated. */
async function canSignAutonomously(userId: string, address: string): Promise<boolean> {
  if (!env.PRIVY_AUTHORIZATION_KEY) return false;
  try {
    const user = await getUserById(userId);
    if (!user) return false;
    const w = await getPrivyEmbeddedWallet(user.privyDid, { address });
    return Boolean(w && w.walletId && w.delegated);
  } catch {
    return false;
  }
}

/** The wallet's balance of each pay token; a token whose read fails is simply absent (unknown ≠ zero). */
async function readPayBalances(address: string): Promise<Partial<Record<PayTokenSymbol, bigint>>> {
  const entries = await Promise.all(
    PAY_TOKEN_SYMBOLS.map(async (sym) => {
      try {
        return [sym, await getErc20Balance(PAY_TOKENS[sym].address, address)] as const;
      } catch {
        return null;
      }
    }),
  );
  return Object.fromEntries(entries.filter((e): e is readonly [PayTokenSymbol, bigint] => e !== null));
}

export async function getSpending(userId: string) {
  const [settings, spent, wallet] = await Promise.all([getBuySettings(userId), spentToday(userId), getWalletByUserId(userId)]);
  const balances = wallet ? await readPayBalances(wallet.address) : {};
  const known = Object.values(balances);
  const total = known.reduce((a, b) => a + b, 0n);
  return {
    available: buyAvailable(),
    payToken: settings.payToken,
    balances: Object.fromEntries(PAY_TOKEN_SYMBOLS.map((sym) => [sym, balances[sym] === undefined ? null : usdLabel(balances[sym] as bigint)])),
    autonomous: settings.autonomous,
    autoLimit: usdLabel(settings.autoLimitAtomic),
    autoLimitAtomic: settings.autoLimitAtomic.toString(),
    dailyBudget: usdLabel(settings.dailyBudgetAtomic),
    dailyBudgetAtomic: settings.dailyBudgetAtomic.toString(),
    spentToday: usdLabel(spent),
    spentTodayAtomic: spent.toString(),
    hardCap: usdLabel(HARD_CAP_ATOMIC),
    walletBalance: known.length ? usdLabel(total) : null,
    canSignAutonomously: wallet ? await canSignAutonomously(userId, wallet.address) : false,
  };
}

// --- quoting ----------------------------------------------------------------------------------

type QuoteResult =
  | { ok: true; challenge: PaymentChallenge }
  | { ok: false; code: string; message: string };

/** Ask the gateway for the exact price. A 402 is the quote; anything else means no payment will be made. */
async function requestQuote(cap: BuyCapability, bodyJson: string): Promise<QuoteResult> {
  let res: Response;
  try {
    res = await gatewayFetch(cap.url, {
      method: cap.method,
      headers: { 'content-type': 'application/json' },
      body: cap.method === 'POST' ? bodyJson : undefined,
      timeoutMs: QUOTE_TIMEOUT_MS,
    });
  } catch (e) {
    if (e instanceof BuyError) return { ok: false, code: e.code, message: e.message };
    return { ok: false, code: 'quote_unavailable', message: 'The marketplace didn’t answer the price request. Nothing was charged — please try again.' };
  }

  const text = await res.text().catch(() => '');
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }

  if (res.status !== 402) {
    // The service rejected the request itself (e.g. invalid input) — surface its reason; nothing to pay.
    const o = classifyPaidResponse(res.status, json);
    const message = o.kind === 'paid' ? 'This service didn’t ask for payment.' : o.message;
    return { ok: false, code: o.kind === 'paid' ? 'no_payment_needed' : o.code, message };
  }

  const challenge = parsePaymentChallenge(json);
  if (!challenge) return { ok: false, code: 'bad_quote', message: 'The marketplace returned a price I couldn’t read, so I didn’t pay.' };
  return { ok: true, challenge };
}

/** The requirement for paying with `token`, after holding it to OUR expectations (payee, resource, token, cap). */
function requirementFor(challenge: PaymentChallenge, token: PayToken, cap: BuyCapability, expectedPayTo: string): { ok: true; requirement: PaymentRequirement } | { ok: false; code: string; message: string } {
  const requirement = selectRequirement(challenge, token);
  if (!requirement) return { ok: false, code: 'no_token_option', message: `This service can’t be paid in ${token.symbol} on Celo.` };
  const refusal = checkRequirement(requirement, { payTo: expectedPayTo, resource: cap.url, token, maxAtomic: HARD_CAP_ATOMIC });
  if (refusal) return { ok: false, code: 'quote_refused', message: `I declined to pay: ${refusal}` };
  return { ok: true, requirement };
}

// --- the purchase lifecycle -------------------------------------------------------------------

export interface PurchaseView {
  id: string;
  service: string;
  capabilityId: string;
  status: string;
  mode: string | null;
  price: string;
  priceAtomic: string;
  /** Stablecoin it was (or will be) paid in: USDC | USDT | USAT. */
  token: string;
  txHash: string | null;
  receiptUrl: string | null;
  correlationId: string | null;
  error: { code: string; message: string } | null;
  createdAt: string;
  paidAt: string | null;
  expiresAt: string;
}

export function toPurchaseView(r: BuyPurchaseRow): PurchaseView {
  return {
    id: r.id,
    service: r.title,
    capabilityId: r.capabilityId,
    status: r.status,
    mode: r.mode,
    price: usdLabel(r.priceAtomic),
    priceAtomic: r.priceAtomic,
    token: r.payToken,
    txHash: r.txHash,
    receiptUrl: r.txHash ? txExplorerUrl(r.txHash) : null,
    correlationId: r.correlationId,
    error: r.errorCode ? { code: r.errorCode, message: r.errorMessage ?? '' } : null,
    createdAt: r.createdAt.toISOString(),
    paidAt: r.paidAt ? r.paidAt.toISOString() : null,
    expiresAt: r.expiresAt.toISOString(),
  };
}

export type PrepareResult =
  | { ok: true; purchase: BuyPurchaseRow; decision: Extract<BuyDecision, { effect: 'AUTONOMOUS' | 'CONFIRM' }> }
  | { ok: false; code: string; message: string };

/** Steps 1–2: price it, verify it, apply the policy, and record a QUOTED purchase. No money moves. */
export async function preparePurchase(userId: string, input: { capabilityId: string; input: Record<string, unknown> }): Promise<PrepareResult> {
  if (!buyAvailable()) return { ok: false, code: 'testnet', message: 'Buy runs on Celo mainnet only.' };

  let catalog: CatalogData;
  try {
    catalog = await getCatalog();
  } catch (e) {
    return { ok: false, code: e instanceof BuyError ? e.code : 'catalog_unavailable', message: e instanceof Error ? e.message : 'The marketplace is unavailable.' };
  }
  const cap = catalog.capabilities.find((c) => c.id === input.capabilityId);
  if (!cap) return { ok: false, code: 'unknown_service', message: `There's no service called "${input.capabilityId}". Search the catalog for the right id.` };

  const body = input.input && typeof input.input === 'object' && !Array.isArray(input.input) ? input.input : {};
  const missing = missingRequiredFields(cap.inputSchema, body);
  if (missing.length) return { ok: false, code: 'missing_input', message: `This service needs: ${missing.join(', ')}.` };
  const bodyJson = JSON.stringify(body);
  if (bodyJson.length > MAX_REQUEST_BODY_CHARS) return { ok: false, code: 'input_too_large', message: 'That request is too large to send.' };

  const wallet = await getWalletByUserId(userId);
  if (!wallet) return { ok: false, code: 'no_wallet', message: 'No wallet is set up for this account yet.' };

  const quote = await requestQuote(cap, bodyJson);
  if (!quote.ok) return { ok: false, code: quote.code, message: quote.message };

  const [settings, spent, balances] = await Promise.all([getBuySettings(userId), spentToday(userId), readPayBalances(wallet.address)]);
  if (Object.keys(balances).length === 0) return { ok: false, code: 'balance_unavailable', message: 'I couldn’t read your wallet balance just now, so I didn’t buy anything. Please try again.' };

  // Pick the stablecoin: the user's preference if the service takes it and the wallet covers it, else one it does hold.
  const offered = offeredTokens(quote.challenge);
  const quotedPrices = offered.map((sym) => selectRequirement(quote.challenge, PAY_TOKENS[sym])).flatMap((r) => (r ? [BigInt(r.maxAmountRequired)] : []));
  const worstPrice = quotedPrices.reduce((a, b) => (a > b ? a : b), 0n);
  const choice = chooseToken({ preferred: settings.payToken, offered, balances, priceAtomic: worstPrice });
  if (!choice.ok) {
    if (choice.reason === 'not_offered') return { ok: false, code: 'no_token_option', message: 'This service can’t be paid in a stablecoin Pexa supports (USDC, USDT or USAT on Celo).' };
    const holds = choice.holdings.length ? ` You hold some ${choice.holdings.join(' and ')}, but not enough.` : '';
    return { ok: false, code: 'insufficient_balance', message: `Your wallet doesn’t have enough USDC, USDT or USAT for this purchase (${usdLabel(worstPrice)}).${holds} Add funds and try again.` };
  }
  const token = choice.token;

  const req = requirementFor(quote.challenge, token, cap, catalog.payTo);
  if (!req.ok) return { ok: false, code: req.code, message: req.message };
  const requirement = req.requirement;
  const price = BigInt(requirement.maxAmountRequired);

  // Only ask Privy about delegation when autonomy is on — it's the only case the answer matters.
  const canSign = settings.autonomous ? await canSignAutonomously(userId, wallet.address) : false;

  const decision = evaluateBuyPurchase(settings, { priceAtomic: price, spentTodayAtomic: spent, balanceAtomic: balances[token.symbol] ?? 0n, canSignAutonomously: canSign });
  if (decision.effect === 'BLOCK') return { ok: false, code: decision.reason, message: decision.message };

  const typedData = buildAuthorization({ from: wallet.address, requirement, token, nowSec: Math.floor(Date.now() / 1000) });
  const [row] = await getDb()
    .insert(schema.buyPurchases)
    .values({
      userId,
      walletAddress: wallet.address,
      capabilityId: cap.id,
      title: cap.title,
      method: cap.method,
      url: cap.url,
      requestBody: bodyJson,
      priceAtomic: price.toString(),
      payToken: token.symbol,
      payTo: requirement.payTo,
      status: 'QUOTED',
      requirementJson: JSON.stringify({ x402Version: quote.challenge.x402Version, requirement }),
      authorizationJson: JSON.stringify(typedData),
      expiresAt: new Date(Number(typedData.message.validBefore) * 1000),
    })
    .returning();
  return { ok: true, purchase: row, decision };
}

/** What the client needs to have the user's wallet sign a QUOTED purchase (and nothing else). */
export async function getApprovalPayload(userId: string, purchaseId: string) {
  const row = await loadOwned(userId, purchaseId);
  if (!row || row.status !== 'QUOTED') return null;
  return { purchase: toPurchaseView(row), typedData: JSON.parse(row.authorizationJson) as AuthorizationTypedData, from: row.walletAddress };
}

async function loadOwned(userId: string, purchaseId: string): Promise<BuyPurchaseRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(purchaseId)) return null;
  const [row] = await getDb()
    .select()
    .from(schema.buyPurchases)
    .where(and(eq(schema.buyPurchases.id, purchaseId), eq(schema.buyPurchases.userId, userId)))
    .limit(1);
  return row ?? null;
}

/** A purchase stuck SUBMITTING with no answer is shown as UNCERTAIN — we can't prove it didn't settle. */
async function reconcileStale(userId: string): Promise<void> {
  await getDb()
    .update(schema.buyPurchases)
    .set({ status: 'UNCERTAIN', errorCode: 'no_response', errorMessage: 'No confirmation came back. The payment may have gone through — check the receipt before trying again.', updatedAt: new Date() })
    .where(and(eq(schema.buyPurchases.userId, userId), eq(schema.buyPurchases.status, 'SUBMITTING'), lt(schema.buyPurchases.updatedAt, new Date(Date.now() - STALE_SUBMITTING_MS))));
}

export async function getPurchase(userId: string, purchaseId: string): Promise<BuyPurchaseRow | null> {
  await reconcileStale(userId);
  return loadOwned(userId, purchaseId);
}

export async function listPurchases(userId: string, limit = 25): Promise<PurchaseView[]> {
  await reconcileStale(userId);
  const rows = await getDb().select().from(schema.buyPurchases).where(eq(schema.buyPurchases.userId, userId)).orderBy(desc(schema.buyPurchases.createdAt)).limit(Math.min(limit, 100));
  return rows.filter((r) => r.status !== 'QUOTED' || r.expiresAt > new Date()).map(toPurchaseView);
}

export async function cancelPurchase(userId: string, purchaseId: string): Promise<boolean> {
  const res = await getDb()
    .update(schema.buyPurchases)
    .set({ status: 'CANCELLED', updatedAt: new Date() })
    .where(and(eq(schema.buyPurchases.id, purchaseId), eq(schema.buyPurchases.userId, userId), eq(schema.buyPurchases.status, 'QUOTED')))
    .returning({ id: schema.buyPurchases.id });
  return res.length > 0;
}

/**
 * What we keep of a service's reply. It is unwrapped (gateways often send JSON as a string) and pruned to a
 * budget BEFORE it is stored, so the saved result is always valid, compact data — never a JSON text sliced off
 * mid-way, which is what a plain size cap produced.
 */
function capJson(v: unknown, max: number): string {
  let s: string;
  try {
    const kept = slimForAgent(parseMaybeJson(v), max - 200).output;
    s = JSON.stringify(kept) ?? 'null';
  } catch {
    s = '"[unserializable]"';
  }
  return s.length > max ? s.slice(0, max) : s;
}

async function finalize(id: string, outcome: PaidOutcome): Promise<void> {
  const where = and(eq(schema.buyPurchases.id, id), eq(schema.buyPurchases.status, 'SUBMITTING'));
  const db = getDb();
  if (outcome.kind === 'paid') {
    await db
      .update(schema.buyPurchases)
      .set({ status: 'PAID', txHash: outcome.transaction, correlationId: outcome.correlationId, responseJson: capJson(outcome.output, MAX_STORED_RESPONSE_CHARS), paidAt: new Date(), updatedAt: new Date() })
      .where(where);
  } else if (outcome.kind === 'not_charged') {
    await db.update(schema.buyPurchases).set({ status: 'FAILED', errorCode: outcome.code, errorMessage: outcome.message, updatedAt: new Date() }).where(where);
  } else {
    await db
      .update(schema.buyPurchases)
      .set({ status: 'UNCERTAIN', errorCode: outcome.code, errorMessage: outcome.message, txHash: outcome.transaction, correlationId: outcome.correlationId, responseJson: capJson(outcome.output, MAX_STORED_RESPONSE_CHARS), updatedAt: new Date() })
      .where(where);
  }
}

/** The x402 settlement receipt header, base64 JSON `{ success, transaction, … }`, if the gateway sent one. */
function settlementTx(res: Response): string | null {
  const raw = res.headers.get('x-payment-response');
  if (!raw) return null;
  try {
    const j = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as { transaction?: unknown };
    return typeof j.transaction === 'string' ? j.transaction : null;
  } catch {
    return null;
  }
}

/** Step 5: send the signed payment and record what came back. Resolves once the purchase is final. */
async function runPaid(row: BuyPurchaseRow, signature: string): Promise<void> {
  const { x402Version, requirement } = JSON.parse(row.requirementJson) as { x402Version: number; requirement: PaymentRequirement };
  const typedData = JSON.parse(row.authorizationJson) as AuthorizationTypedData;
  const header = buildPaymentHeader({ x402Version, requirement, message: typedData.message, signature });

  let res: Response;
  try {
    res = await gatewayFetch(row.url, {
      method: row.method,
      headers: { 'content-type': 'application/json', [header.name]: header.value },
      body: row.method === 'POST' ? row.requestBody : undefined,
      timeoutMs: PAID_TIMEOUT_MS,
    });
  } catch {
    // The payment was submitted; a dropped connection or timeout does NOT mean it didn't settle.
    await finalize(row.id, { kind: 'uncertain', code: 'network_error_after_payment', message: 'The connection dropped after the payment was sent. It may have gone through — check the receipt before trying again.', transaction: null, correlationId: null, output: null });
    return;
  }

  const text = await res.text().catch(() => '');
  let json: unknown = text.slice(0, MAX_STORED_RESPONSE_CHARS);
  try {
    json = JSON.parse(text);
  } catch {
    /* keep the raw text */
  }
  const headerTx = settlementTx(res);
  if (headerTx && json && typeof json === 'object' && !Array.isArray(json) && !(json as Record<string, unknown>).transaction) {
    (json as Record<string, unknown>).transaction = headerTx;
  }
  await finalize(row.id, classifyPaidResponse(res.status, json, row.payToken));
}

export type SubmitResult = { ok: true; done: Promise<void>; purchase: BuyPurchaseRow } | { ok: false; code: string; message: string };

/**
 * Steps 4–5. Verifies the signature really is the wallet's over exactly this quote, then claims the
 * purchase atomically and starts the paid request. `done` resolves when the purchase is final.
 */
export async function submitSignedPurchase(userId: string, purchaseId: string, signature: string, mode: 'autonomous' | 'confirmed'): Promise<SubmitResult> {
  const row = await loadOwned(userId, purchaseId);
  if (!row) return { ok: false, code: 'not_found', message: 'Purchase not found.' };
  if (row.status !== 'QUOTED') return { ok: false, code: 'already_handled', message: 'This purchase was already handled — nothing more was charged.' };
  if (row.expiresAt <= new Date()) {
    await getDb().update(schema.buyPurchases).set({ status: 'EXPIRED', updatedAt: new Date() }).where(and(eq(schema.buyPurchases.id, row.id), eq(schema.buyPurchases.status, 'QUOTED')));
    return { ok: false, code: 'expired', message: 'This quote expired before it was approved. Nothing was charged — ask again for a fresh price.' };
  }

  const typedData = JSON.parse(row.authorizationJson) as AuthorizationTypedData;
  const { requirement } = JSON.parse(row.requirementJson) as { requirement: PaymentRequirement };
  if (!authorizationMatchesQuote({ typedData, requirement, priceAtomic: row.priceAtomic, walletAddress: row.walletAddress })) {
    return { ok: false, code: 'quote_mismatch', message: 'This purchase’s payment details didn’t check out, so nothing was sent.' };
  }
  if (typedData.message.from.toLowerCase() !== row.walletAddress.toLowerCase() || !(await verifyAuthorizationSignature(typedData, signature))) {
    return { ok: false, code: 'bad_signature', message: 'That signature doesn’t match your wallet for this purchase, so nothing was sent.' };
  }

  // THE gate: only one caller can ever move QUOTED → SUBMITTING for a given purchase.
  const [claimed] = await getDb()
    .update(schema.buyPurchases)
    .set({ status: 'SUBMITTING', mode, updatedAt: new Date() })
    .where(and(eq(schema.buyPurchases.id, row.id), eq(schema.buyPurchases.userId, userId), eq(schema.buyPurchases.status, 'QUOTED'), gt(schema.buyPurchases.expiresAt, new Date())))
    .returning();
  if (!claimed) return { ok: false, code: 'already_handled', message: 'This purchase was already handled — nothing more was charged.' };

  const done = runPaid(claimed, signature).catch(async (e) => {
    console.error('[buy] paid request crashed:', e);
    await finalize(claimed.id, { kind: 'uncertain', code: 'internal_error', message: 'Something went wrong after the payment was sent. It may have gone through — check the receipt.', transaction: null, correlationId: null, output: null });
  });
  // Keep the serverless function alive until the paid request finishes, even after the HTTP response is sent.
  try {
    after(async () => {
      await done;
    });
  } catch {
    /* not inside a request scope — the promise still runs */
  }
  return { ok: true, done, purchase: claimed };
}

/** Autonomous path: sign server-side with the user's delegated wallet (Privy TEE), then pay. */
async function signAndSubmitAutonomously(userId: string, row: BuyPurchaseRow): Promise<SubmitResult> {
  const user = await getUserById(userId);
  if (!user) return { ok: false, code: 'no_user', message: 'Account not found.' };
  const w = await getPrivyEmbeddedWallet(user.privyDid, { address: row.walletAddress });
  if (!w || !w.walletId || !w.delegated) return { ok: false, code: 'not_delegated', message: 'Pexa isn’t allowed to sign for this wallet yet.' };
  const typedData = JSON.parse(row.authorizationJson) as AuthorizationTypedData;
  try {
    const { signature } = await signDelegatedTypedData({ walletId: w.walletId, typedData: typedData as unknown as Parameters<typeof signDelegatedTypedData>[0]['typedData'] });
    return submitSignedPurchase(userId, row.id, signature, 'autonomous');
  } catch (e) {
    console.error('[buy] delegated signing failed:', e);
    return { ok: false, code: 'signing_failed', message: 'Pexa couldn’t sign this purchase, so nothing was charged.' };
  }
}

// --- the agent-facing entry point -------------------------------------------------------------

export type BuyOutcome =
  | { status: 'purchased'; purchase: PurchaseView; output: unknown; outputTruncated: boolean }
  | { status: 'needs_approval'; purchase: PurchaseView; reason: string; message: string }
  | { status: 'pending'; purchase: PurchaseView; message: string }
  | { status: 'uncertain'; purchase: PurchaseView; message: string }
  | { status: 'not_charged'; code: string; message: string };

export function agentOutput(row: BuyPurchaseRow, maxChars = MAX_AGENT_OUTPUT_CHARS): { output: unknown; truncated: boolean } {
  if (!row.responseJson) return { output: null, truncated: false };
  // Also recovers results stored before pruning existed (JSON text, doubly encoded, cut at the old size cap).
  return slimForAgent(parseMaybeJson(row.responseJson), maxChars);
}

/**
 * Buy a service. Prices it, applies the user's policy, and either completes the purchase (autonomous),
 * or leaves a QUOTED purchase for the user to approve. Never moves money without the policy's say-so.
 */
export async function buyService(userId: string, input: { capabilityId: string; input: Record<string, unknown> }): Promise<BuyOutcome> {
  const prepared = await preparePurchase(userId, input);
  if (!prepared.ok) return { status: 'not_charged', code: prepared.code, message: prepared.message };

  if (prepared.decision.effect === 'CONFIRM') {
    return { status: 'needs_approval', purchase: toPurchaseView(prepared.purchase), reason: prepared.decision.reason, message: prepared.decision.message };
  }

  const submitted = await signAndSubmitAutonomously(userId, prepared.purchase);
  if (!submitted.ok) {
    // Couldn't pay on its own (e.g. signing unavailable): fall back to asking, rather than failing.
    return { status: 'needs_approval', purchase: toPurchaseView(prepared.purchase), reason: submitted.code, message: submitted.message };
  }
  await Promise.race([submitted.done, new Promise((r) => setTimeout(r, INLINE_WAIT_MS))]);
  return outcomeFor(userId, submitted.purchase.id);
}

/** Describe a purchase's current state in the shape the agent reasons over. */
export async function outcomeFor(userId: string, purchaseId: string): Promise<BuyOutcome> {
  const row = await getPurchase(userId, purchaseId);
  if (!row) return { status: 'not_charged', code: 'not_found', message: 'Purchase not found.' };
  const view = toPurchaseView(row);
  switch (row.status) {
    case 'PAID': {
      const { output, truncated } = agentOutput(row);
      return { status: 'purchased', purchase: view, output, outputTruncated: truncated };
    }
    case 'SUBMITTING':
      return { status: 'pending', purchase: view, message: 'The purchase is still being processed. Check the receipt in a moment — do not buy it again.' };
    case 'UNCERTAIN':
      return { status: 'uncertain', purchase: view, message: row.errorMessage ?? 'The payment may have gone through. Do not retry; check the receipt.' };
    case 'QUOTED':
      return { status: 'needs_approval', purchase: view, reason: 'awaiting_approval', message: 'Waiting for your approval.' };
    default:
      return { status: 'not_charged', code: row.errorCode ?? row.status.toLowerCase(), message: row.errorMessage ?? `The purchase was ${row.status.toLowerCase()}. Nothing was charged.` };
  }
}

// --- following up on a paid result (e.g. a compute job) ---------------------------------------

function findPollUrl(output: unknown): string | null {
  if (!output || typeof output !== 'object') return null;
  const o = output as Record<string, unknown>;
  for (const key of ['poll', 'pollUrl', 'poll_url']) {
    if (typeof o[key] === 'string') return o[key] as string;
  }
  for (const v of Object.values(o)) {
    if (v && typeof v === 'object') {
      const nested = findPollUrl(v);
      if (nested) return nested;
    }
  }
  return null;
}

/** Check on a paid job (e.g. a VM script) using the poll URL the service returned. Free, read-only. */
export async function pollResult(userId: string, purchaseId: string): Promise<{ ok: true; result: unknown; truncated: boolean } | { ok: false; code: string; message: string }> {
  const row = await getPurchase(userId, purchaseId);
  if (!row || row.status !== 'PAID' || !row.responseJson) return { ok: false, code: 'nothing_to_poll', message: 'There’s no finished purchase with a result to follow up on.' };
  let output: unknown = null;
  try {
    output = JSON.parse(row.responseJson);
  } catch {
    /* not JSON */
  }
  const url = findPollUrl(output);
  if (!url) return { ok: false, code: 'no_poll_url', message: 'This purchase has nothing to follow up on — its result is already in the receipt.' };
  if (!isAllowedBuyUrl(url)) return { ok: false, code: 'host_not_allowed', message: 'The follow-up address isn’t on Buy’s gateway, so I didn’t open it.' };
  try {
    const res = await gatewayFetch(url, { method: 'GET', timeoutMs: 20_000 });
    const text = await res.text();
    let result: unknown = text;
    try {
      result = JSON.parse(text);
    } catch {
      /* keep text */
    }
    const slim = slimForAgent(result, MAX_AGENT_OUTPUT_CHARS);
    return { ok: true, result: slim.output, truncated: slim.truncated };
  } catch {
    return { ok: false, code: 'poll_unavailable', message: 'I couldn’t reach the job just now. Try again in a few seconds.' };
  }
}
