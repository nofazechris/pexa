import { NextResponse } from 'next/server';
import { withUser, errorResponse, jsonError } from '@/lib/http';
import { getOrCreateUser } from '@/lib/users/service';
import { cancelResearch } from '@/lib/research/service';

/** Decline (or stop) a research. Purchases already paid stay paid; nothing further is bought. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await withUser(req);
  if ('response' in auth) return auth.response;
  const { id } = await ctx.params;
  try {
    const user = await getOrCreateUser(auth.user.userId);
    const ok = await cancelResearch(user.id, id);
    return ok ? NextResponse.json({ ok: true }) : jsonError(409, 'not_cancellable', { message: 'This search has already finished.' });
  } catch (e) {
    return errorResponse(e);
  }
}
