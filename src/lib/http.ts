import 'server-only';
import { NextResponse } from 'next/server';
import { getSessionUser, type SessionUser } from '@/lib/auth/server';
import { env } from '@/lib/config';
import { DbNotConfiguredError } from '@/lib/db';
import { isTransientDbError } from '@/lib/db/errors';

/**
 * Small helpers shared by API routes: consistent JSON errors, the auth gate, and translating
 * infrastructure errors (missing database) into clean responses instead of 500s.
 */

export function jsonError(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...extra }, { status });
}

/**
 * The public origin to put in links we generate (referral links, emails). The configured
 * NEXT_PUBLIC_SITE_URL wins; otherwise the request's own origin. We deliberately do NOT read
 * X-Forwarded-Host / similar: they're attacker-controllable, and a forged one would let someone get
 * an email sent to a victim containing a link to a domain of their choosing.
 */
export function siteOrigin(req: Request): string {
  const configured = env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/+$/, '');
  return new URL(req.url).origin;
}

/** Resolve the session or return a 401 response to send back. */
export async function withUser(
  req: Request,
): Promise<{ user: SessionUser } | { response: NextResponse }> {
  const user = await getSessionUser(req);
  if (!user) return { response: jsonError(401, 'unauthorized') };
  return { user };
}

/**
 * Map a thrown error to a JSON response. Never leaves the client with a body-less 500: a missing
 * database is `database_not_configured`, an infrastructure hiccup (DNS, dropped connection, pooler
 * at capacity) is a retryable 503 `temporarily_unavailable`, and anything else is a logged 500
 * `server_error`. Clients rely on the JSON `error`/`message` to show something accurate.
 */
export function errorResponse(e: unknown): NextResponse {
  if (e instanceof DbNotConfiguredError) {
    return jsonError(503, 'database_not_configured');
  }
  console.error('[api] unhandled error:', e);
  if (isTransientDbError(e)) {
    return jsonError(503, 'temporarily_unavailable', { message: 'We couldn’t reach our servers just now. Please try again in a moment.' });
  }
  return jsonError(500, 'server_error', { message: 'Something went wrong on our end. Please try again.' });
}
