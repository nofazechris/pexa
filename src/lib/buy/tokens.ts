/**
 * The dollar stablecoins a Buy purchase can be paid in. All three are 6-decimal, 1:1 dollar tokens that
 * support EIP-3009 `transferWithAuthorization`, which is how x402 payments are made. The EIP-712 name
 * and version are what each token's contract signs under — taken from the live gateway challenge and
 * checked on-chain; a challenge that disagrees is refused, never trusted.
 *
 * Pure (no server imports) so the browser can show the same labels.
 */

export type PayTokenSymbol = 'USDC' | 'USDT' | 'USAT';

export interface PayToken {
  symbol: PayTokenSymbol;
  /** Celo mainnet contract. */
  address: string;
  /** Long name for UI, e.g. "Tether America USD". */
  name: string;
  /** EIP-712 domain the token verifies authorizations under. */
  eip712: { name: string; version: string };
  decimals: 6;
  /** One line of plain context for the picker. */
  blurb: string;
}

export const PAY_TOKENS: Record<PayTokenSymbol, PayToken> = {
  USDC: {
    symbol: 'USDC',
    address: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C',
    name: 'USD Coin',
    eip712: { name: 'USDC', version: '2' },
    decimals: 6,
    blurb: 'Circle’s dollar stablecoin',
  },
  USDT: {
    symbol: 'USDT',
    address: '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e',
    name: 'Tether USD',
    eip712: { name: 'Tether USD', version: '1' },
    decimals: 6,
    blurb: 'Tether’s dollar stablecoin',
  },
  USAT: {
    symbol: 'USAT',
    address: '0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771',
    name: 'Tether America USD',
    eip712: { name: 'Tether America USD', version: '1' },
    decimals: 6,
    blurb: 'US-regulated dollar (Anchorage × Tether)',
  },
};

export const PAY_TOKEN_SYMBOLS = Object.keys(PAY_TOKENS) as PayTokenSymbol[];

export function isPayTokenSymbol(v: unknown): v is PayTokenSymbol {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(PAY_TOKENS, v);
}

/** The token whose contract is `address` (case-insensitive), if it's one we pay with. */
export function payTokenByAddress(address: string): PayToken | null {
  const a = address.toLowerCase();
  return PAY_TOKEN_SYMBOLS.map((s) => PAY_TOKENS[s]).find((t) => t.address.toLowerCase() === a) ?? null;
}

export type TokenChoice =
  | { ok: true; token: PayToken; switched: boolean }
  | { ok: false; reason: 'not_offered' | 'insufficient'; holdings: PayTokenSymbol[] };

/**
 * Which token to pay with. The user's preferred token wins when the service accepts it and the wallet can
 * cover the price; otherwise we fall back to whichever accepted token the wallet can cover (largest balance
 * first), so a purchase doesn't fail just because the preferred token is empty. `switched` tells the UI to say so.
 */
export function chooseToken(input: {
  preferred: PayTokenSymbol;
  /** Symbols the service's challenge offers. */
  offered: readonly PayTokenSymbol[];
  /** Atomic balances by symbol. */
  balances: Partial<Record<PayTokenSymbol, bigint>>;
  priceAtomic: bigint;
}): TokenChoice {
  const offered = PAY_TOKEN_SYMBOLS.filter((s) => input.offered.includes(s));
  if (offered.length === 0) return { ok: false, reason: 'not_offered', holdings: [] };

  const covers = (s: PayTokenSymbol) => (input.balances[s] ?? 0n) >= input.priceAtomic;
  if (offered.includes(input.preferred) && covers(input.preferred)) {
    return { ok: true, token: PAY_TOKENS[input.preferred], switched: false };
  }
  const fallback = offered
    .filter(covers)
    .sort((a, b) => {
      const d = (input.balances[b] ?? 0n) - (input.balances[a] ?? 0n);
      return d > 0n ? 1 : d < 0n ? -1 : 0;
    })[0];
  if (fallback) return { ok: true, token: PAY_TOKENS[fallback], switched: fallback !== input.preferred };

  return { ok: false, reason: 'insufficient', holdings: offered.filter((s) => (input.balances[s] ?? 0n) > 0n) };
}
