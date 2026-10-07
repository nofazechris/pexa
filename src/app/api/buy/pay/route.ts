import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/security/ratelimit';
import { withUser, errorResponse, jsonError } from '@/lib/http';
import { getOrCreateUser } from '@/lib/users/service';
import { submitSignedPurchase, toPurchaseView } from '@/lib/buy/service';

/**
 * Pay for a QUOTED Buy purchase the user has approved. The browser signs the quote's EIP-3009
 * authorization with the user's wallet and posts the signature here; we verify it is truly their
 * signature over exactly that quote, atomically claim the purchase (so it can never be paid twice),
 * start the paid request, and return right away — the paid call can take a minute or more, so the app
 * polls /api/buy/purchases/[id] for the result.
 */
export const maxDuration = 300;

export async function POST(req: Request) {
  const auth = await withUser(req);
  if ('response' in auth) return auth.response;
  const tooMany = rateLimit('buy-pay', auth.user.userId, { max: 10, windowMs: 60000 });
  if (tooMany) return tooMany;

  let body: { purchaseId?: unknown; signature?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'invalid_body');
  }
  const purchaseId = typeof body.purchaseId === 'string' ? body.purchaseId : '';
  const signature = typeof body.signature === 'string' ? body.signature : '';
  if (!purchaseId || !/^0x[0-9a-fA-F]{130}$/.test(signature)) return jsonError(400, 'missing_fields', { message: 'A purchase id and a signature are required.' });

  try {
    const user = await getOrCreateUser(auth.user.userId);
    const res = await submitSignedPurchase(user.id, purchaseId, signature, 'confirmed');
    if (!res.ok) {
      const status = res.code === 'not_found' ? 404 : res.code === 'already_handled' || res.code === 'expired' ? 409 : 400;
      return jsonError(status, res.code, { message: res.message });
    }
    // Don't wait for the paid call (it can take minutes); the client polls for the final state.
    return NextResponse.json({ purchase: toPurchaseView(res.purchase) }, { status: 202 });
  } catch (e) {
    return errorResponse(e);
  }
}
