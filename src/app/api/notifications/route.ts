import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/security/ratelimit';
import { withUser, errorResponse } from '@/lib/http';
import { getOrCreateUser } from '@/lib/users/service';
import { getNotifications } from '@/lib/notifications/service';

/** The notification bar's feed: money in and out, subscription payments, deposits, requests, purchases. */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await withUser(req);
  if ('response' in auth) return auth.response;
  const tooMany = rateLimit('notifications', auth.user.userId, { max: 40, windowMs: 60000 });
  if (tooMany) return tooMany;
  try {
    const user = await getOrCreateUser(auth.user.userId);
    return NextResponse.json(await getNotifications(user.id));
  } catch (e) {
    return errorResponse(e);
  }
}
