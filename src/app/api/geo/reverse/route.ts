import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/security/ratelimit';
import { withUser, errorResponse, jsonError } from '@/lib/http';
import { reverseGeocode } from '@/lib/geo/service';
import { roundedPoint } from '@/lib/geo/place';

/**
 * "Use my location": turns the position a phone shared into an area name like "Yaba, Lagos". The position travels in the
 * request body (never a URL), is rounded to about a kilometre, is not stored or logged, and only the area name is sent back.
 */
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const auth = await withUser(req);
  if ('response' in auth) return auth.response;
  const tooMany = rateLimit('geo-reverse', auth.user.userId, { max: 10, windowMs: 60_000 });
  if (tooMany) return tooMany;
  let body: { lat?: unknown; lon?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'invalid_body');
  }
  try {
    if (!roundedPoint(body.lat, body.lon)) return jsonError(400, 'bad_position', { message: 'That doesn’t look like a real position.' });
    const label = await reverseGeocode(body.lat, body.lon);
    if (!label) return jsonError(404, 'no_area', { message: 'I couldn’t work out your area from that. Type your city or neighbourhood instead.' });
    return NextResponse.json({ label });
  } catch (e) {
    return errorResponse(e);
  }
}
