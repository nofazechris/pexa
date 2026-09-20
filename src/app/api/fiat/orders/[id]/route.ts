import { NextResponse } from 'next/server';
import { withUser, errorResponse, jsonError } from '@/lib/http';
import { getOrCreateUser } from '@/lib/users/service';
import { features } from '@/lib/config';
import { getFiatOrder } from '@/lib/fiat/service';
import { presentOrder } from '@/lib/fiat/present';

/** Fiat order status (§4–5). Ownership-checked; the client polls this to a terminal state. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await withUser(req);
  if ('response' in auth) return auth.response;
  if (!features.fiat) return jsonError(404, 'fiat_not_enabled');
  const { id } = await ctx.params;

  try {
    const user = await getOrCreateUser(auth.user.userId);
    const order = await getFiatOrder(user.id, id);
    if (!order) return jsonError(404, 'not_found');
    return NextResponse.json({ order: presentOrder(order) });
  } catch (e) {
    return errorResponse(e);
  }
}
