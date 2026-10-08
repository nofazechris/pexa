import { CELO_CHAIN_ID, CELO_USDC, type BridgeChain } from './chains';

/**
 * Relay (relay.link) gives us a deposit address per network: anything USDC sent there arrives in the user's Pexa
 * wallet as USDC on Celo. Ethereum-style networks need no API key; Solana does (RELAY_API_KEY). We only ever ASK for the address here — Pexa never signs or
 * moves anything on the other network; the user sends from their own wallet or exchange.
 */

const RELAY_API = 'https://api.relay.link';
/** One try may take this long; there are two tries, so a stuck Relay costs at most ~16s, never a hang. */
const ATTEMPT_TIMEOUT_MS = 8_000;
/** Used only to estimate the fee shown to people; the address itself accepts any amount. */
const ESTIMATE_AMOUNT_ATOMIC = 10_000_000n; // 10 USDC
/** "Refund to whoever sent it" — Relay's marker for automatic refunds on the origin network. */
const REFUND_TO_DEPOSITOR = { evm: '0x0000000000000000000000000000000000000000', svm: '11111111111111111111111111111111' } as const;

export interface RelayDepositAddress {
  depositAddress: string;
  requestId: string;
  /** What 10 USDC sent from that network turns into on Celo, so the fee can be shown honestly. */
  estimateOutAtomic: string;
  /** Rough fee in USD for a 10 USDC transfer. */
  estimateFeeUsd: string;
}

const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const isDepositAddress = (v: unknown, kind: BridgeChain['kind']): v is string => typeof v === 'string' && (kind === 'evm' ? EVM_ADDRESS : SOLANA_ADDRESS).test(v);

/** Read Relay's answer, refusing anything that isn't exactly what we asked for. */
export function parseRelayQuote(json: unknown, recipient: string, kind: BridgeChain['kind'] = 'evm'): RelayDepositAddress {
  const q = json as {
    requestId?: unknown;
    steps?: Array<{ depositAddress?: unknown; requestId?: unknown }>;
    details?: { recipient?: unknown; currencyOut?: { amount?: unknown; currency?: { chainId?: unknown; address?: unknown } } };
  };
  const step = q?.steps?.[0];
  const depositAddress = step?.depositAddress;
  const requestId = typeof q?.requestId === 'string' ? q.requestId : typeof step?.requestId === 'string' ? step.requestId : '';
  if (!isDepositAddress(depositAddress, kind) || !requestId) throw new Error('relay_no_deposit_address');
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

export async function requestDepositAddress(chain: BridgeChain, recipient: string, apiKey?: string): Promise<RelayDepositAddress> {
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
    refundTo: REFUND_TO_DEPOSITOR[chain.kind],
  };
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
    try {
      const res = await fetch(`${RELAY_API}/quote/v2`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(apiKey ? { 'x-api-key': apiKey } : {}) },
        body: JSON.stringify(body),
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`relay_http_${res.status}`);
      return parseRelayQuote(await res.json(), recipient, chain.kind);
    } catch (e) {
      lastError = controller.signal.aborted ? new Error('relay_timeout') : e;
      // A refusal we understand won't change on a second try.
      if (e instanceof Error && /^relay_(wrong|no_)/.test(e.message)) break;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('relay_failed');
}
