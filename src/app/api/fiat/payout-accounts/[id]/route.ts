import { NextResponse } from 'next/server';
import { withUser, errorResponse, jsonError } from '@/lib/http';
import { getOrCreateUser } from '@/lib/users/service';
import { features } from '@/lib/config';
import { deletePayoutAccount } from '@/lib/fiat/payouts';

/** Remove a linked payout account (§7). Ownership-checked. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await withUser(req);
  if ('response' in auth) return auth.response;
  if (!features.fiat) return jsonError(404, 'fiat_not_enabled');
  const { id } = await ctx.params;

  try {
    const user = await getOrCreateUser(auth.user.userId);
    await deletePayoutAccount(user.id, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
