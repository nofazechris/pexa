import 'server-only';
import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { activeNetwork } from '@/lib/config';
import { getPrivyEmbeddedWallet } from '@/lib/auth/server';

/**
 * Wallet persistence (§5, §36).
 *
 * Privy provisions and custodies the embedded Celo wallet — its keys never reach us (§11).
 * This module records the wallet's public address against our user so the app and payment
 * engine can reference it without calling Privy on every request. Sync is idempotent on
 * (user, chain): calling it repeatedly keeps the stored address current and never duplicates.
 */

export interface StoredWallet {
  address: string;
  chainId: number;
  providerWalletId: string | null;
}

export async function getWalletByUserId(userId: string): Promise<StoredWallet | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.wallets)
    .where(and(eq(schema.wallets.userId, userId), eq(schema.wallets.chainId, activeNetwork.chainId)))
    .limit(1);
  if (rows.length === 0) return null;
  const w = rows[0];
  return { address: w.address, chainId: w.chainId, providerWalletId: w.providerWalletId };
}

/**
 * Ensure the user has exactly one recorded wallet for the active network, returning it.
 *
 * **A stored wallet is permanent.** Once a (user, chain) row exists it is returned as-is and never
 * overwritten by whatever Privy happens to list — a stray duplicate wallet must not be able to
 * silently re-point someone's account at a different (empty) address. Only when NOTHING is stored
 * do we record Privy's canonical wallet (the oldest — see wallets/select.ts). Returns null if
 * Privy hasn't provisioned one yet (there can be a brief lag after login).
 */
export async function syncWallet(userId: string, privyDid: string): Promise<StoredWallet | null> {
  const existing = await getWalletByUserId(userId);
  if (existing) return existing;

  const fromPrivy = await getPrivyEmbeddedWallet(privyDid);
  if (!fromPrivy) return null; // nothing to record yet

  const db = getDb();
  const chainId = activeNetwork.chainId;
  // DoNothing on conflict: if a concurrent request already recorded a wallet, that one stands.
  await db
    .insert(schema.wallets)
    .values({ userId, chainId, address: fromPrivy.address, providerWalletId: fromPrivy.walletId, provider: 'privy' })
    .onConflictDoNothing({ target: [schema.wallets.userId, schema.wallets.chainId] });

  // Re-read so a concurrent winner is what we report (never our losing candidate).
  return getWalletByUserId(userId);
}

/**
 * Persist the caller's wallet for the active network. Same permanence rule as {@link syncWallet}:
 * an already-stored wallet is returned untouched. If nothing is stored and Privy hasn't caught up
 * yet (the client just got its wallet), falls back to the client-supplied address — the
 * authenticated user's own public address. Never overwrites.
 */
export async function persistWallet(userId: string, privyDid: string, clientAddress?: string): Promise<StoredWallet | null> {
  const synced = await syncWallet(userId, privyDid);
  if (synced) return synced;
  if (!clientAddress) return null;

  const db = getDb();
  const chainId = activeNetwork.chainId;
  await db
    .insert(schema.wallets)
    .values({ userId, chainId, address: clientAddress, provider: 'privy' })
    .onConflictDoNothing({ target: [schema.wallets.userId, schema.wallets.chainId] });
  return getWalletByUserId(userId);
}
