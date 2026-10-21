import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/security/ratelimit';
import { withUser, errorResponse, jsonError } from '@/lib/http';
import { getOrCreateUser } from '@/lib/users/service';
import { addWatch, listWatches, removeWatch } from '@/lib/yield/watchlist';
import { addTickerWatch, removeTickerWatch } from '@/lib/research/stocks/watchlist';

/**
 * The person's yield watchlist. POST {action:'add', poolId | chain+symbol(+project), targetApy?} or {action:'remove', id}.
 * GET lists what they watch with how each pool has changed since. It reads public pool data and writes only this user's own rows;
 * it moves no money.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await withUser(req);
  if ('response' in auth) return auth.response;
  try {
    const user = await getOrCreateUser(auth.user.userId);
    return NextResponse.json({ items: await listWatches(user.id) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request) {
  const auth = await withUser(req);
  if ('response' in auth) return auth.response;
  const tooMany = rateLimit('watch', auth.user.userId, { max: 30, windowMs: 60_000 });
  if (tooMany) return tooMany;

  let body: { action?: unknown; poolId?: unknown; id?: unknown; chain?: unknown; project?: unknown; symbol?: unknown; targetApy?: unknown; authors?: unknown; posts?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'invalid_body');
  }
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);
  try {
    const user = await getOrCreateUser(auth.user.userId);
    if (body.action === 'add') {
      const r = await addWatch(user.id, { poolId: str(body.poolId, 80), chain: str(body.chain, 30), project: str(body.project, 40), symbol: str(body.symbol, 30) }, typeof body.targetApy === 'number' ? body.targetApy : null);
      return r.ok ? NextResponse.json(r) : NextResponse.json(r, { status: 409 });
    }
    if (body.action === 'add_ticker') {
      const r = await addTickerWatch(user.id, str(body.symbol, 8) ?? '', { authors: typeof body.authors === 'number' ? body.authors : undefined, posts: typeof body.posts === 'number' ? body.posts : undefined });
      return r.ok ? NextResponse.json(r) : NextResponse.json(r, { status: 409 });
    }
    if (body.action === 'remove_ticker') {
      const r = await removeTickerWatch(user.id, { id: str(body.id, 40) });
      return r.ok ? NextResponse.json(r) : NextResponse.json(r, { status: 404 });
    }
    if (body.action === 'remove') {
      const r = await removeWatch(user.id, { id: str(body.id, 40) });
      return r.ok ? NextResponse.json(r) : NextResponse.json(r, { status: 404 });
    }
    return jsonError(400, 'unknown_action');
  } catch (e) {
    return errorResponse(e);
  }
}
