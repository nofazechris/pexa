import { NextResponse } from 'next/server';
import { withUser, errorResponse } from '@/lib/http';
import { getOrCreateUser, getProfileByUserId } from '@/lib/users/service';
import { getWalletByUserId, syncWallet } from '@/lib/wallets/service';

/**
 * The authenticated user's profile + wallet. Ensures the internal user row exists (first sight
 * after Privy sign-in), returns the profile (or null → onboarding), and the provisioned Celo
 * wallet address. To avoid a Privy API call on every load, the wallet is synced from Privy only
 * when we don't already have it stored.
 */
export async function GET(req: Request) {
  const auth = await withUser(req);
  if ('response' in auth) return auth.response;
  try {
    const user = await getOrCreateUser(auth.user.userId);
    const [profile, stored] = await Promise.all([getProfileByUserId(user.id), getWalletByUserId(user.id)]);
    // A brand-new user has no stored wallet yet, so this reaches out to Privy. That call is a
    // nice-to-have here — the client provisions and persists the wallet itself (POST /api/wallet) —
    // so a Privy hiccup must NEVER fail the whole request: it would lock a new user out of even
    // choosing a username. Degrade to "no wallet yet" and log it so the cause stays visible.
    let wallet = stored;
    if (!wallet) {
      try {
        wallet = await syncWallet(user.id, auth.user.userId);
      } catch (e) {
        console.error('[profile/me] wallet sync failed (continuing without it):', e);
        wallet = null;
      }
    }
    return NextResponse.json({
      userId: user.id,
      profile: profile ? { username: profile.username, displayName: profile.displayName, uid: profile.uid } : null,
      wallet: wallet ? { address: wallet.address, chainId: wallet.chainId } : null,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
