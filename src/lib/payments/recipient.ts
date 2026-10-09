import { getAddress, isAddress } from 'viem';
import { PAY_TOKENS } from '@/lib/buy/tokens';
import { UNISWAP } from '@/lib/swap/route';

/**
 * Safety checks for sending to a wallet outside Pexa (MetaMask, an exchange, a friend's wallet). A mistaken send to an
 * address can't be undone, so before anything is previewed we refuse the addresses that are certainly wrong: one with a
 * typo (the capitalisation is a built-in checksum), the zero/burn addresses, a token's own contract (tokens sent there are
 * lost for good) and the person's own wallet.
 */

const BURN = new Set(['0x0000000000000000000000000000000000000000', '0x000000000000000000000000000000000000dead']);

/** Contracts that are never a sensible place to send dollars. */
function knownContracts(): Set<string> {
  const set = new Set<string>();
  for (const t of Object.values(PAY_TOKENS)) set.add(t.address.toLowerCase());
  for (const a of Object.values(UNISWAP)) set.add(a.toLowerCase());
  return set;
}

export type RecipientCheck = { ok: true; address: string } | { ok: false; error: string };

export function checkExternalRecipient(raw: string, opts: { ownAddress?: string } = {}): RecipientCheck {
  const text = raw.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(text)) return { ok: false, error: 'That doesn’t look like a wallet address — it should start with 0x and be 42 characters long.' };
  // All-lowercase / all-uppercase carries no checksum; mixed case must match the checksum exactly or there's a typo.
  const hex = text.slice(2);
  const mixed = hex !== hex.toLowerCase() && hex !== hex.toUpperCase();
  if (!isAddress(text, { strict: false })) return { ok: false, error: 'That doesn’t look like a valid wallet address.' };
  if (mixed && !isAddress(text, { strict: true })) return { ok: false, error: 'That address has a typo — its capital letters don’t match its built-in checksum. Copy it again from the wallet.' };
  const address = getAddress(text.toLowerCase());
  const lower = address.toLowerCase();
  if (BURN.has(lower)) return { ok: false, error: 'That’s a burn address — anything sent there is gone forever, so I won’t send to it.' };
  if (knownContracts().has(lower)) return { ok: false, error: 'That’s a token or exchange contract, not a wallet — money sent to it would be lost. Double-check the address.' };
  if (opts.ownAddress && opts.ownAddress.toLowerCase() === lower) return { ok: false, error: 'That’s your own Pexa wallet address.' };
  return { ok: true, address };
}
