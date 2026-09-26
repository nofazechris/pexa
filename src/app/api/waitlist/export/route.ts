import { NextResponse } from 'next/server';
import { env } from '@/lib/config';
import { errorResponse } from '@/lib/http';
import { exportWaitlistCsv } from '@/lib/waitlist/service';

/**
 * Admin CSV export of the waitlist, for a spreadsheet of signups. Protected by a shared secret —
 * never a user session. Send it as `Authorization: Bearer <CRON_SECRET>` (preferred), or `?key=`
 * for a quick browser download. Disabled (404) unless CRON_SECRET is configured, so the endpoint
 * doesn't exist when there's no secret to check against.
 */
export const dynamic = 'force-dynamic';

function authorized(req: Request): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization') ?? req.headers.get('Authorization');
  const bearer = header?.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : null;
  const key = new URL(req.url).searchParams.get('key');
  return bearer === secret || key === secret || req.headers.get('x-admin-key') === secret;
}

export async function GET(req: Request) {
  if (!env.CRON_SECRET) return NextResponse.json({ error: 'export_disabled' }, { status: 404 });
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const csv = await exportWaitlistCsv();
    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="pexa-waitlist-${stamp}.csv"`,
        'cache-control': 'no-store',
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
