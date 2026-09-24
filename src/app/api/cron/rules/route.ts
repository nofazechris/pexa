import { NextResponse } from 'next/server';
import { env } from '@/lib/config';
import { errorResponse } from '@/lib/http';
import { runDueRules } from '@/lib/rules/worker';

/**
 * Money-rules cron (§ automations). A scheduled trigger POSTs here to run active rules (auto-save on
 * income, balance alerts). Protected by CRON_SECRET — never a user session. Idempotent per run.
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
  if (!env.CRON_SECRET) return NextResponse.json({ error: 'cron_disabled' }, { status: 404 });
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const result = await runDueRules();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return errorResponse(e);
  }
}

export const POST = handle;
export const GET = handle;
