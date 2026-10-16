import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/security/ratelimit';
import { withUser, errorResponse } from '@/lib/http';
import { getOrCreateUser } from '@/lib/users/service';
import { advanceResearch } from '@/lib/research/service';

/**
 * The next step of an approved research: either "sign and pay this purchase" (the browser does, with the user's own
 * wallet), "still working", or the finished shortlist. Calling it again is always safe — a quote still waiting for its
 * signature is handed back, never duplicated. The budget, the allow-list and the purchase limit are enforced here.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await withUser(req);
  if ('response' in auth) return auth.response;
  const tooMany = rateLimit('research-step', auth.user.userId, { max: 40, windowMs: 60_000 });
  if (tooMany) return tooMany;
  const { id } = await ctx.params;
  try {
    const user = await getOrCreateUser(auth.user.userId);
    return NextResponse.json(await advanceResearch(user.id, id));
  } catch (e) {
    return errorResponse(e);
  }
}
