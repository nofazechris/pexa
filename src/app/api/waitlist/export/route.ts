import { NextResponse } from 'next/server';
import { requestHasSecret } from '@/lib/security/secret';
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
  return requestHasSecret(req, env.CRON_SECRET, { headers: ['x-admin-key'], queryParams: ['key'] });
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
