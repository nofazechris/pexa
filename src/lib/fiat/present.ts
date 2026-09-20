import { formatKoboToNgn, formatUnitsToUsdt } from './units';
import type { FiatOrderRow, FiatQuoteRow, PayoutAccountRow } from '@/lib/db/schema';

/**
 * Display presenters for fiat quotes and orders — one shape used by the API, the MCP tools and
 * the chat cards, so numbers are formatted consistently in one place. Pure (no server-only), so
 * it's safe on either side. Amounts arrive as smallest-unit strings and leave human-formatted.
 */

export interface QuoteView {
  quoteId: string;
  side: 'buy' | 'sell';
  ngn: string; // "100,000.00"
  usdt: string; // "61.724565"
  rate: string; // naira per USDT
  feeNgn: string;
  estimatedReceive: string; // "61.49" or "160,700.00"
  estimatedReceiveCurrency: 'NGN' | 'USDT';
  expiresAt: string;
  sandbox: boolean;
}

export function presentQuote(row: FiatQuoteRow): QuoteView {
  const side = row.side as 'buy' | 'sell';
  return {
    quoteId: row.id,
    side,
    ngn: formatKoboToNgn(row.ngnAmount),
    usdt: formatUnitsToUsdt(row.usdtAmount),
    rate: row.rate,
    feeNgn: formatKoboToNgn(row.providerFeeNgn),
    estimatedReceive:
      row.estimatedReceiveCurrency === 'USDT'
        ? formatUnitsToUsdt(row.estimatedReceive)
        : formatKoboToNgn(row.estimatedReceive),
    estimatedReceiveCurrency: row.estimatedReceiveCurrency as 'NGN' | 'USDT',
    expiresAt: row.expiresAt.toISOString(),
    sandbox: row.sandbox,
  };
}

export interface OrderView {
  orderId: string;
  side: 'buy' | 'sell';
  status: string;
  ngn: string;
  usdt: string;
  asset: string;
  provider: string;
  createdAt: string;
}

export function presentOrder(row: FiatOrderRow): OrderView {
  return {
    orderId: row.id,
    side: row.side as 'buy' | 'sell',
    status: row.status,
    ngn: formatKoboToNgn(row.ngnAmount),
    usdt: formatUnitsToUsdt(row.usdtAmount),
    asset: row.asset,
    provider: row.provider,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface PayoutAccountView {
  id: string;
  bankName: string;
  accountName: string;
  last4: string;
  status: string;
}

export function presentPayoutAccount(row: PayoutAccountRow): PayoutAccountView {
  return {
    id: row.id,
    bankName: row.bankName,
    accountName: row.accountName,
    last4: row.last4,
    status: row.status,
  };
}
