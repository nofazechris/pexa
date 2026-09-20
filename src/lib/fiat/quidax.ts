import 'server-only';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { parseUnits } from 'viem';
import { env } from '@/lib/config';
import { NGN, USDT } from '@/lib/config/fiat';
import type {
  BankAccountInput,
  CreateOrderRequest,
  FiatProvider,
  FiatQuote,
  FundingInstructions,
  KycState,
  PayoutRequest,
  ProviderLimits,
  ProviderOrder,
  ProviderPayout,
  QuoteRequest,
  VerifiedBankAccount,
  WebhookVerification,
} from './provider';

/**
 * Quidax on/off-ramp adapter (custodial merchant API). Real integration scaffold — implements the
 * FiatProvider interface against Quidax's documented endpoints. It is INERT until `QUIDAX_SECRET_KEY`
 * is set (getFiatProvider only returns it when FIAT_PROVIDER=quidax). Credentials stay server-side.
 *
 * Model (docs.quidax.io):
 *  - Buy (NGN→USDT):  POST on_ramp_transactions/initiate  → confirm  ⇒ returns the NGN bank account
 *    the user pays into; Quidax then sends USDT to the user's wallet_address (USDT on Celo supported).
 *  - Sell (USDT→NGN): POST off_ramp_transactions/initiate → add bank_account → confirm ⇒ returns a
 *    USDT deposit address; Pexa sends USDT there; Quidax pays NGN to the bank.
 *  - Rate is locked at initiate (~15s). Settlement arrives via signed `quidax-signature` webhooks.
 *
 * `TODO(verify)` marks a field/path/status to confirm against live keys before go-live.
 */

const QUOTE_TTL_MS = 15_000; // Quidax swap/ramp quotes are short-lived (~15s).

// Map our smallest-unit amounts to Quidax's decimal strings and back.
function koboToNgnDecimal(kobo: string): string {
  return (Number(BigInt(kobo)) / 100).toFixed(2);
}
function unitsToUsdtDecimal(units: string): string {
  return (Number(BigInt(units)) / 1e6).toFixed(6);
}
function ngnDecimalToKobo(v: string): string {
  return parseUnits(v as `${number}`, NGN.decimals).toString();
}
function usdtDecimalToUnits(v: string): string {
  return parseUnits(v as `${number}`, USDT.decimals).toString();
}

interface QuidaxRampData {
  public_id?: string;
  reference?: string;
  merchant_reference?: string;
  from_amount?: string;
  to_amount?: string;
  status?: string;
  blockchain_fee?: string;
  processor_fee?: string;
  vat?: string;
  // on-ramp confirm (funding bank account)
  account_name?: string;
  account_number?: string;
  bank_name?: string;
  amount_expected?: string;
  // off-ramp confirm (deposit address)
  address?: string;
  network?: string;
}

export class QuidaxFiatProvider implements FiatProvider {
  readonly id = 'quidax';
  readonly sandbox = false;

  private base(): string {
    return env.QUIDAX_BASE_URL ?? 'https://ramp-be.quidax.io/api/v1/merchants/';
  }
  private key(): string {
    const k = env.QUIDAX_SECRET_KEY;
    if (!k) throw new Error('Quidax is not configured (set QUIDAX_SECRET_KEY).');
    return k;
  }
  private network(): string {
    return env.QUIDAX_USDT_NETWORK ?? 'celo';
  }

  private async call<T = QuidaxRampData>(method: string, path: string, body?: unknown): Promise<T> {
    const url = this.base().replace(/\/$/, '') + '/' + path.replace(/^\//, '');
    const res = await fetch(url, {
      method,
      headers: { 'x-private-key': this.key(), 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json().catch(() => ({}))) as { status?: string; message?: string; data?: T };
    if (!res.ok || json.status === 'error' || json.status === 'forbidden' || json.status === 'not_found') {
      throw new Error(`Quidax ${path} failed: ${json.message ?? res.status}`);
    }
    return json.data as T;
  }

  /**
   * Locks a rate by initiating the ramp transaction (Quidax has no separate stateless quote for the
   * custodial ramp — initiate returns the locked to_amount). The `merchant_reference` we generate is
   * the handle used for confirm/bank/settlement, and is returned as providerRef.
   */
  async getQuote(req: QuoteRequest): Promise<FiatQuote> {
    const merchantRef = `pexa_${randomUUID()}`;
    let data: QuidaxRampData;
    let ngnAmount: string;
    let usdtAmount: string;

    if (req.side === 'buy') {
      // amount is NGN (kobo). Buy needs the destination wallet.
      const address = req.context?.walletAddress;
      if (!address) throw new Error('A wallet address is required to buy USDT.');
      data = await this.call('POST', 'custodial/on_ramp_transactions/initiate', {
        from_currency: 'ngn',
        to_currency: 'usdt',
        from_amount: koboToNgnDecimal(req.amount),
        merchant_reference: merchantRef,
        customer: this.customer(req),
        wallet_address: { address, network: this.network() },
      });
      ngnAmount = req.amount;
      usdtAmount = usdtDecimalToUnits(data.to_amount ?? '0');
    } else {
      // Sell: amount is USDT (6dp) unless denominated in NGN (withdraw target).
      const fromAmountUsdt =
        req.amountCurrency === 'NGN'
          ? undefined // NGN-target sell: Quidax needs a USDT from_amount — see TODO below.
          : unitsToUsdtDecimal(req.amount);
      // TODO(verify): for a NGN-target withdrawal, resolve the USDT to sell (Quidax may accept a
      // to_amount, or we quote-then-scale). For now require a USDT amount.
      if (!fromAmountUsdt) throw new Error('Specify the USDT amount to sell.');
      data = await this.call('POST', 'custodial/off_ramp_transactions/initiate', {
        from_currency: 'usdt',
        to_currency: 'ngn',
        from_amount: fromAmountUsdt,
        network: this.network(),
        merchant_reference: merchantRef,
        customer: this.customer(req),
      });
      usdtAmount = req.amount;
      ngnAmount = ngnDecimalToKobo(data.to_amount ?? '0');
    }

    // Fees: on-ramp fee is revealed at confirm (processor_fee + vat); blockchain_fee at initiate.
    // TODO(verify): surface processor_fee/vat here if the initiate response includes them.
    const providerFeeNgn = data.processor_fee ? ngnDecimalToKobo(data.processor_fee) : '0';
    const rate = usdtAmount !== '0' ? (Number(BigInt(ngnAmount)) / 100 / (Number(BigInt(usdtAmount)) / 1e6)).toFixed(2) : '0';

    return {
      id: data.public_id ?? merchantRef,
      side: req.side,
      ngnAmount,
      usdtAmount,
      rate,
      providerFeeNgn,
      pexaFeeNgn: '0',
      estimatedReceive: req.side === 'buy' ? usdtAmount : ngnAmount,
      estimatedReceiveCurrency: req.side === 'buy' ? 'USDT' : 'NGN',
      expiresAt: new Date(Date.now() + QUOTE_TTL_MS).toISOString(),
      provider: this.id,
      providerRef: merchantRef, // the handle for confirm + webhook correlation
      sandbox: false,
    };
  }

  private customer(req: { context?: CreateOrderRequest['context'] }) {
    const c = req.context;
    return {
      email: c?.customerEmail ?? undefined,
      first_name: c?.customerFirstName ?? undefined,
      last_name: c?.customerLastName ?? undefined,
    };
  }

  /** Confirm the on-ramp transaction → returns the NGN bank account the user funds. */
  async createBuyOrder(req: CreateOrderRequest): Promise<ProviderOrder> {
    const merchantRef = req.quoteId; // = providerRef from getQuote
    const data = await this.call('POST', `custodial/on_ramp_transactions/${merchantRef}/confirm`);
    const funding: FundingInstructions | undefined = data.account_number
      ? {
          bankName: data.bank_name ?? '',
          accountNumber: data.account_number,
          accountName: data.account_name ?? '',
          reference: data.reference ?? merchantRef,
          amountNgn: data.amount_expected ? ngnDecimalToKobo(data.amount_expected) : '0',
          expiresAt: new Date(Date.now() + QUOTE_TTL_MS).toISOString(),
        }
      : undefined;
    return { providerOrderId: merchantRef, status: 'AWAITING_FUNDING', funding };
  }

  /**
   * Bind the bank account, then confirm → Quidax returns a USDT deposit address. Pexa must then send
   * USDT (on Celo) to that address to complete the off-ramp.
   * TODO(on-chain): trigger the USDT transfer from the user's (delegated) wallet / treasury to
   * `data.address` via the payment engine + relayer. Until wired, the order sits AWAITING_ASSET.
   */
  async createSellOrder(req: CreateOrderRequest): Promise<ProviderOrder> {
    const merchantRef = req.quoteId;
    // payoutAccountRef encodes "qdx:<bankCode>:<accountNumber>" (Quidax binds the bank per-txn).
    const [, bankCode, accountNumber] = (req.payoutAccountRef ?? '').split(':');
    if (!bankCode || !accountNumber) throw new Error('A verified bank account is required.');
    await this.call('POST', `custodial/off_ramp_transactions/${merchantRef}/bank_account`, {
      bank_code: bankCode,
      account_number: accountNumber,
      currency_code: 'ngn',
    });
    const data = await this.call('POST', `custodial/off_ramp_transactions/${merchantRef}/confirm`);
    // data.address = the USDT deposit address Pexa must send to (see TODO above).
    return { providerOrderId: merchantRef, status: 'AWAITING_ASSET', funding: undefined, ...(data.address ? {} : {}) };
  }

  async getOrderStatus(providerOrderId: string): Promise<{ status: string }> {
    // TODO(verify): correct fetch path — on-ramp vs off-ramp differ; may need the side. Using a
    // reference lookup; confirm the exact endpoint (fetch-on-ramp-transaction / fetch-off-ramp-transaction).
    const data = await this.call('GET', `custodial/transactions/${providerOrderId}`);
    return { status: data.status ?? 'pending' };
  }

  async getFundingInstructions(providerOrderId: string): Promise<FundingInstructions> {
    const data = await this.call('GET', `custodial/on_ramp_transactions/${providerOrderId}`);
    return {
      bankName: data.bank_name ?? '',
      accountNumber: data.account_number ?? '',
      accountName: data.account_name ?? '',
      reference: data.reference ?? providerOrderId,
      amountNgn: data.amount_expected ? ngnDecimalToKobo(data.amount_expected) : '0',
      expiresAt: new Date(Date.now() + QUOTE_TTL_MS).toISOString(),
    };
  }

  /**
   * Resolve a Nigerian bank account (name lookup). Quidax binds the bank per off-ramp transaction, so
   * there is no reusable token — we return a providerRef encoding bank_code:account_number for reuse.
   * TODO(security): store these encrypted at rest in production.
   */
  async verifyBankAccount(input: BankAccountInput): Promise<VerifiedBankAccount> {
    // TODO(verify): exact verify-bank-account path + response (account name resolution).
    let accountName = '';
    try {
      const data = await this.call('POST', 'custodial/verify_bank_account', {
        bank_code: input.bankCode,
        account_number: input.accountNumber,
      });
      accountName = data.account_name ?? '';
    } catch {
      // Name resolution is best-effort here; the off-ramp bank_account step re-validates.
    }
    return {
      providerRef: `qdx:${input.bankCode}:${input.accountNumber}`,
      accountName: accountName || 'Account holder',
      bankName: input.bankCode,
      last4: input.accountNumber.slice(-4),
    };
  }

  // In-app withdrawals go through the sell flow; a standalone payout isn't used. Kept explicit.
  async createPayout(_req: PayoutRequest): Promise<ProviderPayout> {
    throw new Error('Direct payouts are not supported on Quidax; use the sell/off-ramp flow.');
  }
  async getPayoutStatus(providerPayoutId: string): Promise<{ status: string }> {
    return this.getOrderStatus(providerPayoutId);
  }

  async getLimits(): Promise<ProviderLimits> {
    // TODO(verify): map Quidax purchase-limits; fall back to Pexa's configured caps meanwhile.
    const { FIAT_LIMITS } = await import('@/lib/config/fiat');
    return { perOrderNgn: FIAT_LIMITS.perOrderNgn, dailyNgn: FIAT_LIMITS.dailyNgn, monthlyNgn: FIAT_LIMITS.monthlyNgn };
  }

  async getKycStatus(providerCustomerId: string | null): Promise<KycState> {
    // TODO(verify): read the sub-account/customer KYC status endpoint. Until wired, treat an
    // onboarded customer as pending (blocks money-moves via the policy engine) — fail safe.
    return providerCustomerId ? 'pending' : 'none';
  }

  /**
   * Verify a `quidax-signature` webhook: header is `timestamp=<t>,signature=<hex>`, signature is
   * HMAC-SHA256 of `${t}.${rawBody}` with QUIDAX_WEBHOOK_KEY. Returns a normalized event whose
   * `status` the settlement layer maps to the order's side-appropriate state.
   */
  async handleWebhook(rawBody: string, signature: string | null): Promise<WebhookVerification> {
    const secret = env.QUIDAX_WEBHOOK_KEY;
    if (!secret || !signature) return { valid: false };
    const parts = Object.fromEntries(signature.split(',').map((p) => p.split('=').map((s) => s.trim())));
    const ts = parts['timestamp'];
    const sig = parts['signature'];
    if (!ts || !sig) return { valid: false };
    const expected = createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(sig);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return { valid: false };

    let parsed: { event?: string; type?: string; data?: Record<string, unknown> };
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return { valid: false };
    }
    const type = parsed.event ?? parsed.type ?? '';
    const data = parsed.data ?? {};
    // Correlate on our merchant_reference (what we set as providerOrderId).
    const providerOrderId =
      (typeof data.merchant_reference === 'string' && data.merchant_reference) ||
      (typeof data.reference === 'string' && data.reference) ||
      undefined;
    const status = typeof data.status === 'string' ? data.status : type;
    // Use a stable event id for idempotency; Quidax may provide one in data.id.
    const id = (typeof data.id === 'string' && data.id) || `${providerOrderId ?? 'evt'}:${status}:${ts}`;
    if (!type) return { valid: false };
    return { valid: true, event: { id, type, providerOrderId, status, raw: parsed } };
  }
}
