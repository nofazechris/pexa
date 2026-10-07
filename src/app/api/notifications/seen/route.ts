import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/security/ratelimit';
import { withUser, errorResponse } from '@/lib/http';
import { getOrCreateUser } from '@/lib/users/service';
import { markNotificationsSeen } from '@/lib/notifications/service';

/** The user opened their notifications: everything up to now counts as read. */
export async function POST(req: Request) {
  const auth = await withUser(req);
  if ('response' in auth) return auth.response;
  const tooMany = rateLimit('notifications-seen', auth.user.userId, { max: 30, windowMs: 60000 });
  if (tooMany) return tooMany;
  try {
    const user = await getOrCreateUser(auth.user.userId);
    await markNotificationsSeen(user.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
