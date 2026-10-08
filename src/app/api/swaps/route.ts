import { NextResponse } from 'next/server';
import { withUser, errorResponse } from '@/lib/http';
import { getOrCreateUser } from '@/lib/users/service';
import { listSwaps } from '@/lib/swap/service';

/** The signed-in user's finished conversions, newest first (for Activity). */
export async function GET(req: Request) {
  const auth = await withUser(req);
  if ('response' in auth) return auth.response;
  try {
    const user = await getOrCreateUser(auth.user.userId);
    return NextResponse.json({ swaps: await listSwaps(user.id, 30) }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return errorResponse(e);
  }
}
