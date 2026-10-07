import { NextResponse } from 'next/server';
import { requestHasSecret } from '@/lib/security/secret';
import { env } from '@/lib/config';
import { errorResponse } from '@/lib/http';
import { runDueRecurring } from '@/lib/recurring/worker';

/**
 * Recurring execution endpoint (§ recurring). A scheduled trigger (cron) POSTs here to run all due
 * schedules. Protected by a shared secret — never a user session — sent as `Authorization: Bearer
 * <CRON_SECRET>`. Disabled unless CRON_SECRET is configured. Each run is idempotent per period, so
 * a scheduler retry cannot double-pay.
 */

// This route touches the database and time; never cache it.
export const dynamic = 'force-dynamic';

function authorized(req: Request): boolean {
  return requestHasSecret(req, env.CRON_SECRET, { headers: ['x-cron-secret'] });
}

async function handle(req: Request): Promise<Response> {
  if (!env.CRON_SECRET) return NextResponse.json({ error: 'cron_disabled' }, { status: 404 });
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const result = await runDueRecurring();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return errorResponse(e);
  }
}

// Support POST (preferred) and GET (some schedulers only do GET).
export const POST = handle;
export const GET = handle;
