import { NextResponse } from 'next/server';
import { withUser, errorResponse, jsonError } from '@/lib/http';
import { getOrCreateUser } from '@/lib/users/service';
import { cancelPurchase } from '@/lib/buy/service';

/** Decline a quoted Buy purchase. Only a still-QUOTED purchase can be cancelled; nothing was charged. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await withUser(req);
  if ('response' in auth) return auth.response;
  const { id } = await ctx.params;
  try {
    const user = await getOrCreateUser(auth.user.userId);
    const ok = await cancelPurchase(user.id, id);
    return ok ? NextResponse.json({ ok: true }) : jsonError(409, 'not_cancellable', { message: 'This purchase can no longer be cancelled.' });
  } catch (e) {
    return errorResponse(e);
  }
}
