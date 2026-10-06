import { NextResponse } from 'next/server';
import { withUser, errorResponse, jsonError } from '@/lib/http';
import { getOrCreateUser } from '@/lib/users/service';
import { agentOutput, getPurchase, toPurchaseView } from '@/lib/buy/service';

/**
 * One purchase: its state, receipt and (once paid) the service's result. The app polls this after the
 * user approves, until the purchase reaches a final state (PAID / FAILED / UNCERTAIN).
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await withUser(req);
  if ('response' in auth) return auth.response;
  const { id } = await ctx.params;
  try {
    const user = await getOrCreateUser(auth.user.userId);
    const row = await getPurchase(user.id, id);
    if (!row) return jsonError(404, 'not_found');
    const { output, truncated } = agentOutput(row);
    return NextResponse.json({ purchase: toPurchaseView(row), output, outputTruncated: truncated });
  } catch (e) {
    return errorResponse(e);
  }
}
