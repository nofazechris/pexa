import 'server-only';
import { env } from '@/lib/config';
import { getPrivyEmbeddedWallet } from '@/lib/auth/server';
import { getUserById } from '@/lib/users/service';
import { getWalletByUserId } from '@/lib/wallets/service';
import { autonomousCapUsdc } from '@/lib/payments/policy';

/**
 * Will a recurring payment actually run BY ITSELF for this user?
 *
 * The daily worker pays a due schedule only when Pexa is allowed to sign for the user's wallet (server signing is
 * configured AND the user has turned on "Agent payments"). Otherwise the schedule is skipped and just waits. The
 * Confirm card must say which of the two the user is getting — promising automatic payments that will silently
 * not happen would be worse than not offering them.
 */
export async function recurringRunsAutomatically(userId: string): Promise<boolean> {
  if (!env.PRIVY_AUTHORIZATION_KEY) return false;
  try {
    const [user, wallet] = await Promise.all([getUserById(userId), getWalletByUserId(userId)]);
    if (!user || !wallet) return false;
    const w = await getPrivyEmbeddedWallet(user.privyDid, { address: wallet.address });
    return Boolean(w && w.walletId && w.delegated);
  } catch {
    return false;
  }
}

/** Payments above this are never made automatically; they wait for the user to approve in the app each time. */
export function recurringAutoLimit(): string {
  return autonomousCapUsdc();
}
