import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/security/ratelimit';
import { withUser, errorResponse, jsonError } from '@/lib/http';
import { getOrCreateUser } from '@/lib/users/service';
import { cancelEarn, confirmApproval, earnAvailable, finalizeEarn, prepareEarn } from '@/lib/earn/service';

/**
 * The steps of one Aave deposit or withdrawal, after the person tapped Confirm in chat:
 *   prepare  → re-check the market and balance, cover gas, return exactly what their wallet should sign
 *   approved → their approval transaction was sent; wait for it and check it
 *   finalize → their transaction was sent; prove it's the one we prepared and report what the chain says moved
 *   cancel   → they changed their mind
 * Each step only ever acts on the signed-in user's own action.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await withUser(req);
  if ('response' in auth) return auth.response;
  const tooMany = rateLimit('earn-step', auth.user.userId, { max: 40, windowMs: 60_000 });
  if (tooMany) return tooMany;
  if (!earnAvailable()) return jsonError(404, 'earn_disabled');
  const { id } = await ctx.params;

  let body: { action?: unknown; txHash?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'invalid_body');
  }
  const action = typeof body.action === 'string' ? body.action : '';
  const txHash = typeof body.txHash === 'string' ? body.txHash : '';

  try {
    const user = await getOrCreateUser(auth.user.userId);
    if (action === 'prepare') {
      const r = await prepareEarn(user.id, id);
      return r.ok ? NextResponse.json(r) : NextResponse.json(r, { status: r.code === 'not_found' ? 404 : 409 });
    }
    if (action === 'approved') {
      const r = await confirmApproval(user.id, id, txHash);
      return r.ok ? NextResponse.json(r) : NextResponse.json(r, { status: 409 });
    }
    if (action === 'finalize') {
      const r = await finalizeEarn(user.id, id, txHash);
      return r.ok ? NextResponse.json(r) : NextResponse.json(r, { status: 409 });
    }
    if (action === 'cancel') {
      await cancelEarn(user.id, id);
      return NextResponse.json({ ok: true });
    }
    return jsonError(400, 'unknown_action');
  } catch (e) {
    return errorResponse(e);
  }
}
