import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/security/ratelimit';
import { withUser, errorResponse, jsonError } from '@/lib/http';
import { getOrCreateUser } from '@/lib/users/service';
import { submitFeedback } from '@/lib/research/memory';

/**
 * "Good lead / bad lead / scam": a person tells Pexa how a vendor turned out. It goes into the memory box — counts about a public
 * business account, one vote per person per vendor — and shapes how that account is scored for the next person. No identity is shown.
 */
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const auth = await withUser(req);
  if ('response' in auth) return auth.response;
  const tooMany = rateLimit('research-feedback', auth.user.userId, { max: 40, windowMs: 60_000 });
  if (tooMany) return tooMany;
  let body: { platform?: unknown; handle?: unknown; kind?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'invalid_body');
  }
  try {
    const user = await getOrCreateUser(auth.user.userId);
    const res = await submitFeedback(user.id, { platform: String(body.platform ?? ''), handle: String(body.handle ?? ''), kind: String(body.kind ?? '') });
    return res.ok ? NextResponse.json({ ok: true, message: res.message }) : jsonError(400, res.code, { message: res.message });
  } catch (e) {
    return errorResponse(e);
  }
}
