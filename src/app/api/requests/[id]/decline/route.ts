import { NextResponse } from 'next/server';
import { withUser, errorResponse, jsonError } from '@/lib/http';
import { getOrCreateUser } from '@/lib/users/service';
import { declineRequest } from '@/lib/requests/service';

/**
 * Decline an incoming request the caller was asked to pay, while it's still pending. The requester
 * then sees it marked DECLINED. Only the payer can decline their own request.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await withUser(req);
  if ('response' in auth) return auth.response;
  const { id } = await ctx.params;
  try {
    const user = await getOrCreateUser(auth.user.userId);
    const res = await declineRequest(id, user.id);
    if (!res.ok) return jsonError(res.error === 'not_found' ? 404 : 409, res.error);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
