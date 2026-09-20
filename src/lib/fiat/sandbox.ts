import 'server-only';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/config';
import { FIAT_LIMITS, QUOTE_TTL_SECONDS, SANDBOX_NGN_PER_USDT } from '@/lib/config/fiat';
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
 * SANDBOX fiat provider — a MOCK adapter for development and tests ONLY.
 *
 * It never moves real money, calls no external API, and its numbers are computed from a fixed
 * reference rate (`SANDBOX_NGN_PER_USDT`). Every quote it returns carries `sandbox: true` so the
 * UI can label it and never present it as a live market rate (§16, §32). A real, compliant
 * provider is a separate adapter selected by config; this one is only reachable when
 * `FIAT_PROVIDER=sandbox`.
 *
 * Units: NGN in kobo (2 dp), USDT in 6 dp. All math is integer BigInt — never floats.
 */

const USDT_UNITS = 1_000_000n; // 6 dp
const KOBO_PER_USDT = BigInt(SANDBOX_NGN_PER_USDT) * 100n; // naira→kobo
const FEE_BPS = 50n; // 0.5% mock provider fee
const BPS_DENOM = 10_000n;

function feeKobo(grossKobo: bigint): bigint {
  return (grossKobo * FEE_BPS) / BPS_DENOM;
}

function expiry(): string {
  return new Date(Date.now() + QUOTE_TTL_SECONDS * 1000).toISOString();
}

export class SandboxFiatProvider implements FiatProvider {
  readonly id = 'sandbox';
  readonly sandbox = true;

  async getQuote(req: QuoteRequest): Promise<FiatQuote> {
    let ngnAmount: bigint;
    let usdtAmount: bigint;
    let providerFee: bigint;
    let estimatedReceive: string;
    let estimatedReceiveCurrency: 'NGN' | 'USDT';

    if (req.side === 'buy') {
      // User specifies NGN; nets USDT after the fee.
      ngnAmount = BigInt(req.amount);
      providerFee = feeKobo(ngnAmount);
      const netKobo = ngnAmount - providerFee;
      usdtAmount = (netKobo * USDT_UNITS) / KOBO_PER_USDT;
      estimatedReceive = usdtAmount.toString();
      estimatedReceiveCurrency = 'USDT';
    } else if (req.amountCurrency === 'NGN') {
      // Sell denominated in NGN (a "withdraw ₦X"): work out the USDT to sell for that gross.
      const grossKobo = BigInt(req.amount);
      usdtAmount = (grossKobo * USDT_UNITS + KOBO_PER_USDT - 1n) / KOBO_PER_USDT; // ceil — sell enough
      providerFee = feeKobo(grossKobo);
      ngnAmount = grossKobo;
      estimatedReceive = (grossKobo - providerFee).toString();
      estimatedReceiveCurrency = 'NGN';
    } else {
      // User specifies USDT; nets NGN after the fee.
      usdtAmount = BigInt(req.amount);
      const grossKobo = (usdtAmount * KOBO_PER_USDT) / USDT_UNITS;
      providerFee = feeKobo(grossKobo);
      ngnAmount = grossKobo;
      estimatedReceive = (grossKobo - providerFee).toString();
      estimatedReceiveCurrency = 'NGN';
    }

    return {
      id: `sbxq_${randomUUID()}`,
      side: req.side,
      ngnAmount: ngnAmount.toString(),
      usdtAmount: usdtAmount.toString(),
      rate: SANDBOX_NGN_PER_USDT.toFixed(2),
      providerFeeNgn: providerFee.toString(),
      pexaFeeNgn: '0',
      estimatedReceive,
      estimatedReceiveCurrency,
      expiresAt: expiry(),
      provider: this.id,
      providerRef: `SBX-Q-${randomUUID().slice(0, 8).toUpperCase()}`,
      sandbox: true,
    };
  }

  async createBuyOrder(req: CreateOrderRequest): Promise<ProviderOrder> {
    const providerOrderId = `SBX-O-${req.idempotencyKey.slice(-8)}`;
    return { providerOrderId, status: 'AWAITING_FUNDING', funding: await this.getFundingInstructions(providerOrderId) };
  }

  async createSellOrder(req: CreateOrderRequest): Promise<ProviderOrder> {
    return { providerOrderId: `SBX-O-${req.idempotencyKey.slice(-8)}`, status: 'AWAITING_ASSET' };
  }

  // No external state to query in the sandbox; return a neutral in-flight status. Real order
  // progression is driven by verified webhooks, not by inventing a "completed" here (§32).
  async getOrderStatus(): Promise<{ status: string }> {
    return { status: 'PROCESSING' };
  }

  async getFundingInstructions(providerOrderId: string): Promise<FundingInstructions> {
    return {
      bankName: 'Sandbox Bank (MOCK)',
      accountNumber: '0000000000',
      accountName: 'PEXA SANDBOX / DO NOT PAY',
      reference: providerOrderId,
      amountNgn: '0',
      expiresAt: expiry(),
    };
  }

  async verifyBankAccount(input: BankAccountInput): Promise<VerifiedBankAccount> {
    return {
      providerRef: `SBX-BA-${randomUUID().slice(0, 8).toUpperCase()}`,
      accountName: 'SANDBOX ACCOUNT (MOCK)',
      bankName: `Sandbox Bank ${input.bankCode}`,
      last4: input.accountNumber.slice(-4),
    };
  }

  async createPayout(req: PayoutRequest): Promise<ProviderPayout> {
    return { providerPayoutId: `SBX-P-${req.idempotencyKey.slice(-8)}`, status: 'PAYOUT_PROCESSING' };
  }

  async getPayoutStatus(): Promise<{ status: string }> {
    return { status: 'PAYOUT_PROCESSING' };
  }

  async getLimits(): Promise<ProviderLimits> {
    return { perOrderNgn: FIAT_LIMITS.perOrderNgn, dailyNgn: FIAT_LIMITS.dailyNgn, monthlyNgn: FIAT_LIMITS.monthlyNgn };
  }

  // Sandbox treats accounts as verified so the full flow is exercisable in dev. A real provider
  // returns the true KYC state and the policy engine gates on it.
  async getKycStatus(): Promise<KycState> {
    return 'verified';
  }

  async handleWebhook(rawBody: string, signature: string | null): Promise<WebhookVerification> {
    const secret = env.FIAT_WEBHOOK_SECRET;
    if (!secret || !signature) return { valid: false };
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return { valid: false };

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return { valid: false };
    }
    const type = typeof parsed.type === 'string' ? parsed.type : '';
    const id = typeof parsed.id === 'string' ? parsed.id : '';
    const status = typeof parsed.status === 'string' ? parsed.status : '';
    if (!id || !type) return { valid: false };
    return {
      valid: true,
      event: {
        id,
        type,
        providerOrderId: typeof parsed.providerOrderId === 'string' ? parsed.providerOrderId : undefined,
        providerPayoutId: typeof parsed.providerPayoutId === 'string' ? parsed.providerPayoutId : undefined,
        status,
        raw: parsed,
      },
    };
  }
}
