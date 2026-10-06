import { NextResponse } from 'next/server';
import { withUser, errorResponse } from '@/lib/http';
import { getOrCreateUser } from '@/lib/users/service';
import { listPurchases } from '@/lib/buy/service';

/** The signed-in user's Buy purchases, newest first (the receipts list). */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await withUser(req);
  if ('response' in auth) return auth.response;
  try {
    const user = await getOrCreateUser(auth.user.userId);
    return NextResponse.json({ purchases: await listPurchases(user.id, 30) });
  } catch (e) {
    return errorResponse(e);
  }
}
