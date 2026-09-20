/**
 * Fiat provider abstraction (§16).
 *
 * Pexa never hard-codes a fiat/payment provider. Every fiat capability — quotes, buy/sell
 * orders, funding, bank verification, payouts, limits, KYC and webhooks — goes through this
 * interface, so a real, compliant provider can be dropped in behind an adapter later without
 * touching the agent, policy engine, services or UI. Provider credentials live only in the
 * adapter (server-side); they are never exposed to the client or the LLM.
 *
 * All monetary amounts are integer smallest-unit decimal strings: NGN in kobo (2 dp), USDT in
 * 6 dp. Never floats. See `@/lib/config/fiat`.
 */

export type OrderSide = 'buy' | 'sell';

/**
 * Who the acting user is and where crypto is delivered/collected. The sandbox ignores this; a real
 * provider (e.g. Quidax) needs the customer identity + on-chain address to create ramp transactions.
 * Populated by the service from the authenticated user — never from the LLM or tool arguments.
 */
export interface FiatContext {
  customerEmail?: string | null;
  customerFirstName?: string | null;
  customerLastName?: string | null;
  /** The provider's customer/sub-account id, when one exists. */
  providerCustomerId?: string | null;
  /** The user's on-chain wallet address (buy destination / sell source). */
  walletAddress?: string | null;
  /** Chain for the USDT leg, e.g. "celo". */
  walletNetwork?: string | null;
}

export interface QuoteRequest {
  side: OrderSide;
  /** The amount the user specified, in smallest units of `amountCurrency`. */
  amount: string;
  /** Which side of the pair the `amount` is denominated in. */
  amountCurrency: 'NGN' | 'USDT';
  context?: FiatContext;
}

export interface FiatQuote {
  /** Provider quote id. */
  id: string;
  side: OrderSide;
  /** NGN leg, in kobo. */
  ngnAmount: string;
  /** USDT leg, in 6dp smallest units. */
  usdtAmount: string;
  /** Naira per 1 USDT, as a human decimal string (display only). */
  rate: string;
  /** Provider's fee, NGN kobo. */
  providerFeeNgn: string;
  /** Pexa's fee, NGN kobo (0 for now). */
  pexaFeeNgn: string;
  /** What the user nets: USDT (6dp) for a buy, NGN (kobo) for a sell. */
  estimatedReceive: string;
  estimatedReceiveCurrency: 'NGN' | 'USDT';
  /** ISO timestamp after which the quote is invalid. */
  expiresAt: string;
  provider: string;
  /** Provider's own reference for this quote. */
  providerRef: string;
  /** True when the numbers come from a mock adapter — surfaced so nothing is shown as live. */
  sandbox: boolean;
}

export interface CreateOrderRequest {
  quoteId: string;
  /** Idempotency key so a retried create never produces two provider orders. */
  idempotencyKey: string;
  /** For a sell: the verified payout account to receive NGN. */
  payoutAccountRef?: string;
  context?: FiatContext;
}

export interface ProviderOrder {
  providerOrderId: string;
  status: string;
  /** For a buy: bank/transfer details the user pays into. */
  funding?: FundingInstructions;
}

export interface FundingInstructions {
  bankName: string;
  accountNumber: string;
  accountName: string;
  reference: string;
  amountNgn: string;
  expiresAt: string;
}

export interface BankAccountInput {
  accountNumber: string;
  bankCode: string;
}

export interface VerifiedBankAccount {
  /** Tokenized provider reference — store this, not raw bank details (§7). */
  providerRef: string;
  accountName: string;
  bankName: string;
  /** Last 4 digits only, for display. */
  last4: string;
}

export interface PayoutRequest {
  payoutAccountRef: string;
  amountNgn: string;
  idempotencyKey: string;
}

export interface ProviderPayout {
  providerPayoutId: string;
  status: string;
}

export interface ProviderLimits {
  perOrderNgn: string;
  dailyNgn: string;
  monthlyNgn: string;
}

export type KycState = 'none' | 'pending' | 'verified' | 'rejected';

export interface WebhookVerification {
  valid: boolean;
  /** Normalized event, present only when `valid`. */
  event?: {
    id: string;
    type: string;
    providerOrderId?: string;
    providerPayoutId?: string;
    status: string;
    raw: unknown;
  };
}

export interface FiatProvider {
  readonly id: string;
  readonly sandbox: boolean;

  getQuote(req: QuoteRequest): Promise<FiatQuote>;
  createBuyOrder(req: CreateOrderRequest): Promise<ProviderOrder>;
  createSellOrder(req: CreateOrderRequest): Promise<ProviderOrder>;
  getOrderStatus(providerOrderId: string): Promise<{ status: string }>;
  getFundingInstructions(providerOrderId: string): Promise<FundingInstructions>;

  verifyBankAccount(input: BankAccountInput): Promise<VerifiedBankAccount>;
  createPayout(req: PayoutRequest): Promise<ProviderPayout>;
  getPayoutStatus(providerPayoutId: string): Promise<{ status: string }>;

  getLimits(): Promise<ProviderLimits>;
  getKycStatus(providerCustomerId: string | null): Promise<KycState>;

  /** Verify a webhook's signature and normalize its event. Never trusts the body without this. */
  handleWebhook(rawBody: string, signature: string | null): Promise<WebhookVerification>;
}
