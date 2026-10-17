import { NextResponse } from 'next/server';
import { withUser, errorResponse, jsonError } from '@/lib/http';
import { cityFromHeader } from '@/lib/geo/approx';

/**
 * A guess at the person's city from how they are connected (the hosting platform's request header) — needs no permission and
 * no coordinates, and nothing is stored. The app only offers it as a suggestion to confirm.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await withUser(req);
  if ('response' in auth) return auth.response;
  try {
    const city = cityFromHeader(req.headers.get('x-vercel-ip-city'));
    if (!city) return jsonError(404, 'no_guess', { message: 'No city could be guessed from this connection.' });
    return NextResponse.json({ label: city });
  } catch (e) {
    return errorResponse(e);
  }
}
