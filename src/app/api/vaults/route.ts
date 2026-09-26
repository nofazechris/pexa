import { NextResponse } from 'next/server';
import { withUser, errorResponse } from '@/lib/http';
import { getOrCreateUser } from '@/lib/users/service';
import { listVaults } from '@/lib/vaults/service';

/**
 * The signed-in user's savings vaults (name, balance, goal progress). Vaults are earmarks within
 * the user's own wallet — this is a read for the wallet UI; all mutations go through the agent
 * (create/deposit/withdraw) so they share one policy and one confirmation vocabulary.
 */
export async function GET(req: Request) {
  const auth = await withUser(req);
  if ('response' in auth) return auth.response;
  try {
    const user = await getOrCreateUser(auth.user.userId);
    return NextResponse.json({ vaults: await listVaults(user.id) });
  } catch (e) {
    return errorResponse(e);
  }
}
