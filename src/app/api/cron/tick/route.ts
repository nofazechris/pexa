import { NextResponse } from 'next/server';
import { env, features } from '@/lib/config';
import { errorResponse } from '@/lib/http';
import { runDueRecurring } from '@/lib/recurring/worker';
import { runDueRules } from '@/lib/rules/worker';
import { reconcileFiatOrders } from '@/lib/fiat/settlement';

/**
 * Consolidated cron dispatcher. One scheduled trigger runs every periodic worker in sequence:
 * recurring payments, money rules, and (when fiat is enabled) fiat-order reconciliation.
 *
 * Why one endpoint: Vercel's Hobby plan caps cron jobs at two, once-per-day. Bundling the workers
 * behind a single daily cron keeps the deploy within those limits. The individual endpoints
 * (/api/cron/recurring, /rules, /fiat-reconcile) stay in place, so a Pro plan or an external
 * scheduler can still hit each one hourly for finer cadence.
 *
 * Protected by CRON_SECRET (never a user session), sent as `Authorization: Bearer <CRON_SECRET>`
 * or `x-cron-secret`. Each worker is idempotent, so a scheduler retry is safe. One worker failing
 * does not abort the others — every result (or its error) is reported in the response.
 */
export const dynamic = 'force-dynamic';

function authorized(req: Request): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization') ?? req.headers.get('Authorization');
  const bearer = header?.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : null;
  return bearer === secret || req.headers.get('x-cron-secret') === secret;
}

/** Run a worker, capturing its result or error so one failure can't sink the whole tick. */
async function step<T>(name: string, run: () => Promise<T>) {
  try {
    return { [name]: { ok: true, ...(await run()) } };
  } catch (e) {
    return { [name]: { ok: false, error: e instanceof Error ? e.message : String(e) } };
  }
}

async function handle(req: Request): Promise<Response> {
  if (!env.CRON_SECRET) return NextResponse.json({ error: 'cron_disabled' }, { status: 404 });
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const results = Object.assign(
      {},
      await step('recurring', runDueRecurring),
      await step('rules', runDueRules),
      // Fiat reconciliation is a no-op unless the fiat feature is configured; skip it otherwise.
      features.fiat ? await step('fiat', reconcileFiatOrders) : { fiat: { ok: true, skipped: true } },
    );
    return NextResponse.json({ ok: true, ran: results });
  } catch (e) {
    return errorResponse(e);
  }
}

export const POST = handle;
export const GET = handle;
