import { CELO_CHAIN_ID, CELO_USDC, type BridgeChain } from './chains';

/**
 * Relay (relay.link) gives us a deposit address per network: anything USDC sent there arrives in the user's Pexa
 * wallet as USDC on Celo. No API key is needed for this. We only ever ASK for the address here — Pexa never signs or
 * moves anything on the other network; the user sends from their own wallet or exchange.
 */

const RELAY_API = 'https://api.relay.link';
/** Used only to estimate the fee shown to people; the address itself accepts any amount. */
const ESTIMATE_AMOUNT_ATOMIC = 10_000_000n; // 10 USDC
/** "Refund to whoever sent it" — Relay's marker for automatic refunds on the origin network. */
const REFUND_TO_DEPOSITOR = '0x0000000000000000000000000000000000000000';

export interface RelayDepositAddress {
  depositAddress: string;
  requestId: string;
  /** What 10 USDC sent from that network turns into on Celo, so the fee can be shown honestly. */
  estimateOutAtomic: string;
  /** Rough fee in USD for a 10 USDC transfer. */
  estimateFeeUsd: string;
}

const isAddress = (v: unknown): v is string => typeof v === 'string' && /^0x[a-fA-F0-9]{40}$/.test(v);

/** Read Relay's answer, refusing anything that isn't exactly what we asked for. */
export function parseRelayQuote(json: unknown, recipient: string): RelayDepositAddress {
  const q = json as {
    requestId?: unknown;
    steps?: Array<{ depositAddress?: unknown; requestId?: unknown }>;
    details?: { recipient?: unknown; currencyOut?: { amount?: unknown; currency?: { chainId?: unknown; address?: unknown } } };
  };
  const step = q?.steps?.[0];
  const depositAddress = step?.depositAddress;
  const requestId = typeof q?.requestId === 'string' ? q.requestId : typeof step?.requestId === 'string' ? step.requestId : '';
  if (!isAddress(depositAddress) || !requestId) throw new Error('relay_no_deposit_address');
  // The funds must be headed to THIS user's wallet, as USDC on Celo — never trust an address for anything else.
  const out = q.details?.currencyOut;
  if (typeof q.details?.recipient !== 'string' || q.details.recipient.toLowerCase() !== recipient.toLowerCase()) throw new Error('relay_wrong_recipient');
  if (out?.currency?.chainId !== CELO_CHAIN_ID || String(out?.currency?.address).toLowerCase() !== CELO_USDC.toLowerCase()) throw new Error('relay_wrong_destination');
  const outAtomic = typeof out?.amount === 'string' && /^\d+$/.test(out.amount) ? BigInt(out.amount) : null;
  if (outAtomic === null) throw new Error('relay_no_estimate');
  const fee = ESTIMATE_AMOUNT_ATOMIC - outAtomic;
  return {
    depositAddress,
    requestId,
    estimateOutAtomic: outAtomic.toString(),
    estimateFeeUsd: (Number(fee > 0n ? fee : 0n) / 1e6).toFixed(2),
  };
}

export async function requestDepositAddress(chain: BridgeChain, recipient: string): Promise<RelayDepositAddress> {
  const body = {
    user: recipient,
    recipient,
    originChainId: chain.chainId,
    originCurrency: chain.usdc,
    destinationChainId: CELO_CHAIN_ID,
    destinationCurrency: CELO_USDC,
    amount: ESTIMATE_AMOUNT_ATOMIC.toString(),
    tradeType: 'EXACT_INPUT',
    useDepositAddress: true,
    refundTo: REFUND_TO_DEPOSITOR,
  };
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${RELAY_API}/quote/v2`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`relay_http_${res.status}`);
      return parseRelayQuote(await res.json(), recipient);
    } catch (e) {
      lastError = e;
      // A refusal we understand won't change on a second try.
      if (e instanceof Error && /^relay_(wrong|no_)/.test(e.message)) break;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('relay_failed');
}
