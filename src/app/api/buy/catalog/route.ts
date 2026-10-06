import { NextResponse } from 'next/server';
import { withUser, errorResponse, jsonError } from '@/lib/http';
import { BuyError, searchCatalog } from '@/lib/buy/service';

/** Browse Buy's catalog (compact results: id, title, category, starting price). */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await withUser(req);
  if ('response' in auth) return auth.response;
  const sp = new URL(req.url).searchParams;
  try {
    return NextResponse.json(await searchCatalog({ query: sp.get('q') ?? undefined, platform: sp.get('platform') ?? undefined, limit: 12 }));
  } catch (e) {
    if (e instanceof BuyError) return jsonError(503, e.code, { message: e.message });
    return errorResponse(e);
  }
}
