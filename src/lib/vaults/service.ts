import 'server-only';
import { and, desc, eq } from 'drizzle-orm';
import { formatUnits, parseUnits } from 'viem';
import { getDb, schema } from '@/lib/db';
import { activeNetwork, getToken } from '@/lib/config';
import type { VaultRow } from '@/lib/db/schema';

/**
 * Savings vaults (§ savings). A vault sets money *aside within the user's own wallet* — the
 * neobank "Pots / Spaces" pattern. Nothing moves on-chain: the USDC stays in the user's wallet and
 * `balanceRaw` is only an earmark, so deposits/withdrawals need no gas, no delegation and no
 * confirmation. "Available" balance is the on-chain balance minus everything earmarked, so savings
 * can't be spent by accident. Amounts are integer smallest-unit strings.
 */

function decimals(token = 'USDC'): number {
  return getToken(token, activeNetwork.network)?.decimals ?? 6;
}

/** Freely-spendable amount: on-chain balance minus what's earmarked, never below zero. Pure. */
export function computeAvailableRaw(onchainRaw: string, earmarkedRaw: bigint): bigint {
  const avail = BigInt(onchainRaw) - earmarkedRaw;
  return avail > 0n ? avail : 0n;
}

/** Progress toward a savings goal (0..1), or null when there's no target. Pure. */
export function vaultProgress(balanceRaw: string, targetRaw: string | null): number | null {
  if (!targetRaw) return null;
  const target = BigInt(targetRaw);
  if (target <= 0n) return null;
  return Math.min(1, Number(BigInt(balanceRaw)) / Number(target));
}

export interface VaultView {
  id: string;
  name: string;
  token: string;
  balance: string; // human, e.g. "12.50"
  balanceRaw: string;
  target: string | null;
  targetRaw: string | null;
  progress: number | null; // 0..1 toward target, when a target is set
}

function view(v: VaultRow): VaultView {
  const d = decimals(v.token);
  const balanceRaw = BigInt(v.balanceRaw);
  const targetRaw = v.targetRaw ? BigInt(v.targetRaw) : null;
  return {
    id: v.id,
    name: v.name,
    token: v.token,
    balance: formatUnits(balanceRaw, d),
    balanceRaw: balanceRaw.toString(),
    target: targetRaw != null ? formatUnits(targetRaw, d) : null,
    targetRaw: targetRaw != null ? targetRaw.toString() : null,
    progress: vaultProgress(v.balanceRaw, v.targetRaw),
  };
}

/** Create a named vault. Names are unique per user (case-insensitive-ish via exact match). */
export async function createVault(
  userId: string,
  input: { name: string; target?: string; token?: string },
): Promise<{ ok: true; vault: VaultView } | { ok: false; error: string }> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: 'A vault needs a name.' };
  if (name.length > 40) return { ok: false, error: 'Vault name is too long (max 40 characters).' };
  const token = input.token ?? 'USDC';

  let targetRaw: string | null = null;
  if (input.target != null && input.target !== '') {
    try {
      const t = parseUnits(input.target as `${number}`, decimals(token));
      if (t <= 0n) return { ok: false, error: 'Target must be greater than zero.' };
      targetRaw = t.toString();
    } catch {
      return { ok: false, error: 'Invalid target amount.' };
    }
  }

  const db = getDb();
  const existing = await db
    .select()
    .from(schema.vaults)
    .where(and(eq(schema.vaults.userId, userId), eq(schema.vaults.name, name), eq(schema.vaults.status, 'active')))
    .limit(1);
  if (existing[0]) return { ok: false, error: `You already have a vault called "${name}".` };

  const [row] = await db
    .insert(schema.vaults)
    .values({ userId, name, token, targetRaw })
    .returning();
  return { ok: true, vault: view(row) };
}

export async function listVaults(userId: string): Promise<VaultView[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.vaults)
    .where(and(eq(schema.vaults.userId, userId), eq(schema.vaults.status, 'active')))
    .orderBy(desc(schema.vaults.createdAt));
  return rows.map(view);
}

/** Resolve a vault by id, or by exact name, scoped to the user. */
export async function findVault(userId: string, idOrName: string): Promise<VaultRow | null> {
  const db = getDb();
  const key = idOrName.trim();
  const byId = await db
    .select()
    .from(schema.vaults)
    .where(and(eq(schema.vaults.id, key), eq(schema.vaults.userId, userId)))
    .limit(1)
    .catch(() => []); // an invalid uuid throws on some drivers; fall through to name lookup
  if (byId[0]) return byId[0];
  const byName = await db
    .select()
    .from(schema.vaults)
    .where(and(eq(schema.vaults.userId, userId), eq(schema.vaults.name, key), eq(schema.vaults.status, 'active')))
    .limit(1);
  return byName[0] ?? null;
}

/** Total amount earmarked across all active vaults for a token, smallest unit. */
export async function totalEarmarkedRaw(userId: string, token = 'USDC'): Promise<bigint> {
  const db = getDb();
  const rows = await db
    .select({ balanceRaw: schema.vaults.balanceRaw, token: schema.vaults.token })
    .from(schema.vaults)
    .where(and(eq(schema.vaults.userId, userId), eq(schema.vaults.status, 'active')));
  return rows.filter((r) => r.token === token).reduce((sum, r) => sum + BigInt(r.balanceRaw), 0n);
}

/**
 * Available balance = on-chain balance minus everything earmarked in vaults (floored at 0). This is
 * the amount the user can freely spend; savings are held back.
 */
export async function availableBalanceRaw(userId: string, onchainRaw: string, token = 'USDC'): Promise<bigint> {
  const earmarked = await totalEarmarkedRaw(userId, token);
  return computeAvailableRaw(onchainRaw, earmarked);
}

/**
 * Move `amountRaw` into a vault (earmark). `ref` makes automated deposits idempotent — a repeated
 * ref is a no-op that returns the current balance. Optionally caps the deposit at the freely
 * available balance when `availableRaw` is provided (so you can't earmark money you don't have).
 */
export async function depositToVault(
  userId: string,
  input: { vaultId: string; amountRaw: string; source?: 'manual' | 'autosave'; ref?: string; note?: string; availableRaw?: string },
): Promise<{ ok: true; vault: VaultView; deposited: boolean } | { ok: false; error: string }> {
  const amount = BigInt(input.amountRaw);
  if (amount <= 0n) return { ok: false, error: 'Amount must be greater than zero.' };

  const db = getDb();
  const [vault] = await db
    .select()
    .from(schema.vaults)
    .where(and(eq(schema.vaults.id, input.vaultId), eq(schema.vaults.userId, userId)))
    .limit(1);
  if (!vault || vault.status !== 'active') return { ok: false, error: 'Vault not found.' };

  if (input.availableRaw != null && amount > BigInt(input.availableRaw)) {
    return { ok: false, error: 'Not enough available balance to set aside that much.' };
  }

  // Idempotent ledger write. A duplicate ref hits the unique (vault, ref) index → skip the move.
  if (input.ref) {
    try {
      await db.insert(schema.vaultTransactions).values({
        vaultId: vault.id,
        userId,
        direction: 'deposit',
        amountRaw: amount.toString(),
        source: input.source ?? 'manual',
        ref: input.ref,
        note: input.note ?? null,
      });
    } catch {
      return { ok: true, vault: view(vault), deposited: false }; // already applied
    }
  } else {
    await db.insert(schema.vaultTransactions).values({
      vaultId: vault.id,
      userId,
      direction: 'deposit',
      amountRaw: amount.toString(),
      source: input.source ?? 'manual',
      note: input.note ?? null,
    });
  }

  const newBalance = (BigInt(vault.balanceRaw) + amount).toString();
  const [updated] = await db
    .update(schema.vaults)
    .set({ balanceRaw: newBalance, updatedAt: new Date() })
    .where(eq(schema.vaults.id, vault.id))
    .returning();
  return { ok: true, vault: view(updated), deposited: true };
}

/** Move `amountRaw` back out of a vault into freely-available balance. */
export async function withdrawFromVault(
  userId: string,
  input: { vaultId: string; amountRaw: string; note?: string },
): Promise<{ ok: true; vault: VaultView } | { ok: false; error: string }> {
  const amount = BigInt(input.amountRaw);
  if (amount <= 0n) return { ok: false, error: 'Amount must be greater than zero.' };

  const db = getDb();
  const [vault] = await db
    .select()
    .from(schema.vaults)
    .where(and(eq(schema.vaults.id, input.vaultId), eq(schema.vaults.userId, userId)))
    .limit(1);
  if (!vault || vault.status !== 'active') return { ok: false, error: 'Vault not found.' };
  if (amount > BigInt(vault.balanceRaw)) return { ok: false, error: 'That vault does not hold that much.' };

  await db.insert(schema.vaultTransactions).values({
    vaultId: vault.id,
    userId,
    direction: 'withdraw',
    amountRaw: amount.toString(),
    source: 'manual',
    note: input.note ?? null,
  });
  const newBalance = (BigInt(vault.balanceRaw) - amount).toString();
  const [updated] = await db
    .update(schema.vaults)
    .set({ balanceRaw: newBalance, updatedAt: new Date() })
    .where(eq(schema.vaults.id, vault.id))
    .returning();
  return { ok: true, vault: view(updated) };
}

/** Archive a vault. Refuses while it still holds funds — withdraw first. */
export async function archiveVault(userId: string, vaultId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = getDb();
  const [vault] = await db
    .select()
    .from(schema.vaults)
    .where(and(eq(schema.vaults.id, vaultId), eq(schema.vaults.userId, userId)))
    .limit(1);
  if (!vault) return { ok: false, error: 'Vault not found.' };
  if (BigInt(vault.balanceRaw) > 0n) return { ok: false, error: 'Withdraw the balance before archiving this vault.' };
  await db.update(schema.vaults).set({ status: 'archived', updatedAt: new Date() }).where(eq(schema.vaults.id, vault.id));
  return { ok: true };
}
