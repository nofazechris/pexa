import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/security/ratelimit';
import { withUser, errorResponse, jsonError } from '@/lib/http';
import { getOrCreateUser } from '@/lib/users/service';
import { depositsSince, scanDeposits } from '@/lib/deposits/service';
import { getBridgeStatuses } from '@/lib/bridge/service';
import { mapRelayStatus } from '@/lib/deposits/check-reply';

/**
 * What the deposit card polls while it waits: has the money landed on Celo yet (read from the chain), and what does Relay say
 * about the transfer on that network (still waiting / converting / problem). One call, so the card needs one request per tick.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await withUser(req);
  if ('response' in auth) return auth.response;
  const tooMany = rateLimit('bridge-status', auth.user.userId, { max: 30, windowMs: 60_000 });
  if (tooMany) return tooMany;

  const url = new URL(req.url);
  const since = new Date(url.searchParams.get('since') ?? '');
  const chainId = Number(url.searchParams.get('chainId'));
  if (Number.isNaN(since.getTime()) || !Number.isInteger(chainId)) return jsonError(400, 'invalid_query');

  try {
    const user = await getOrCreateUser(auth.user.userId);
    await scanDeposits(user.id);
    const [deposits, statuses] = await Promise.all([depositsSince(user.id, since), getBridgeStatuses(user.id).catch(() => [])]);
    const mine = statuses.find((s) => s.chainId === chainId);
    return NextResponse.json({ deposits, state: mapRelayStatus(mine?.status), relay: mine?.status ?? null }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return errorResponse(e);
  }
}
