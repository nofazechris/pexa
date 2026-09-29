import { NextResponse } from 'next/server';
import { withUser, errorResponse, jsonError } from '@/lib/http';
import { getOrCreateUser } from '@/lib/users/service';
import { cancelRequest } from '@/lib/requests/service';

/**
 * Cancel a request the caller created (they're the requester), while it's still pending. The payer
 * then no longer sees it as payable. Only the requester can cancel their own request.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await withUser(req);
  if ('response' in auth) return auth.response;
  const { id } = await ctx.params;
  try {
    const user = await getOrCreateUser(auth.user.userId);
    const res = await cancelRequest(id, user.id);
    if (!res.ok) return jsonError(res.error === 'not_found' ? 404 : 409, res.error);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
