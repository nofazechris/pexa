/**
 * Which embedded wallet is "the" wallet — one rule, shared by the server and the browser.
 *
 * A user should have exactly one Privy embedded wallet, but a user can end up with several (a
 * historical race between Privy's auto-create and ours created duplicates). Anywhere that has to
 * pick one — showing an address, delegating, signing — must pick the SAME one, deterministically,
 * or an agent could act on a different wallet than the one policy checked. The rule: the OLDEST
 * embedded Ethereum wallet wins; ties/unknown ages fall back to Privy's own list order. Pure (no
 * imports) so it is unit-tested and safe on both sides.
 */

/** The subset of a Privy linked account this needs (works for both the server and react SDKs). */
export interface LinkedAccountLike {
  type: string;
  address?: string;
  walletClientType?: string;
  chainType?: string;
  /** Date, epoch seconds, or epoch ms depending on SDK — normalized below. */
  firstVerifiedAt?: Date | number | null;
  verifiedAt?: Date | number | null;
}

function toMs(v: Date | number | null | undefined): number | null {
  if (v == null) return null;
  if (v instanceof Date) return v.getTime();
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return v < 1e12 ? v * 1000 : v; // seconds → ms
}

/** All of a user's Privy embedded Ethereum wallets, oldest first (stable for ties/unknowns). */
export function listEmbeddedWallets<T extends LinkedAccountLike>(accounts: readonly T[] | null | undefined): T[] {
  const embedded = (accounts ?? []).filter(
    (a) => a.type === 'wallet' && a.walletClientType === 'privy' && a.chainType === 'ethereum' && typeof a.address === 'string',
  );
  return embedded
    .map((a, index) => ({ a, index, t: toMs(a.firstVerifiedAt) ?? toMs(a.verifiedAt) }))
    .sort((x, y) => {
      if (x.t != null && y.t != null && x.t !== y.t) return x.t - y.t;
      return x.index - y.index; // unknown/equal → Privy's own order
    })
    .map((x) => x.a);
}

/** The user's canonical embedded wallet: the oldest one, or null if they have none. */
export function pickCanonicalWallet<T extends LinkedAccountLike>(accounts: readonly T[] | null | undefined): T | null {
  return listEmbeddedWallets(accounts)[0] ?? null;
}

/** Find one specific wallet by address (case-insensitive) among the user's embedded wallets. */
export function findWalletByAddress<T extends LinkedAccountLike>(accounts: readonly T[] | null | undefined, address: string): T | null {
  const want = address.toLowerCase();
  return listEmbeddedWallets(accounts).find((a) => a.address?.toLowerCase() === want) ?? null;
}
