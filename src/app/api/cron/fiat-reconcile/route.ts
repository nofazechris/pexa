import { NextResponse } from 'next/server';
import { env, features } from '@/lib/config';
import { errorResponse } from '@/lib/http';
import { reconcileFiatOrders } from '@/lib/fiat/settlement';

/**
 * Fiat reconciliation cron (§22). A scheduled trigger POSTs here to expire orders that were never
 * funded before their quote lapsed. Protected by CRON_SECRET (never a user session). Disabled
 * unless fiat and CRON_SECRET are both configured.
 */
export const dynamic = 'force-dynamic';

function authorized(req: Request): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization') ?? req.headers.get('Authorization');
  const bearer = header?.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : null;
  return bearer === secret || req.headers.get('x-cron-secret') === secret;
}

async function handle(req: Request): Promise<Response> {
  if (!features.fiat || !env.CRON_SECRET) return NextResponse.json({ error: 'disabled' }, { status: 404 });
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const result = await reconcileFiatOrders();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return errorResponse(e);
  }
}

export const POST = handle;
export const GET = handle;
