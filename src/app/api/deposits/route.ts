import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/security/ratelimit';
import { withUser, errorResponse, jsonError } from '@/lib/http';
import { getOrCreateUser } from '@/lib/users/service';
import { depositsSince, scanDeposits } from '@/lib/deposits/service';

/**
 * Deposits that arrived after `?since=<ISO time>` — the "Add money" card asks this while it waits, so it can say
 * "You deposited $2.00" the moment the money lands. Checks the blockchain for new arrivals first.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await withUser(req);
  if ('response' in auth) return auth.response;
  const tooMany = rateLimit('deposits', auth.user.userId, { max: 30, windowMs: 60000 });
  if (tooMany) return tooMany;

  const raw = new URL(req.url).searchParams.get('since');
  const since = raw ? new Date(raw) : null;
  if (!since || Number.isNaN(since.getTime())) return jsonError(400, 'invalid_since');

  try {
    const user = await getOrCreateUser(auth.user.userId);
    await scanDeposits(user.id);
    return NextResponse.json({ deposits: await depositsSince(user.id, since) });
  } catch (e) {
    return errorResponse(e);
  }
}
