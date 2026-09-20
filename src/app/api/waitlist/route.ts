import { NextResponse } from 'next/server';
import { jsonError, errorResponse } from '@/lib/http';
import { joinWaitlist } from '@/lib/waitlist/service';

/**
 * Public waitlist signup (§26–27). No auth — anyone on the landing page can join. Defends the
 * open endpoint with server-side validation, a honeypot, and best-effort per-IP rate limiting.
 * Duplicates return the same friendly success as a fresh signup, so the endpoint never reveals
 * who is already on the list and never surfaces a raw database error.
 */

const SUCCESS = { success: true, message: "You're on the list." };

// Best-effort in-memory limiter. Per-instance only (serverless may run several), so it slows
// abuse without being a hard guarantee — the DB unique index is the real correctness guard.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear(); // crude cap so the map can't grow unbounded
  return recent.length > MAX_PER_WINDOW;
}

function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  return fwd?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
}

export async function POST(req: Request) {
  let email = '';
  let firstName: string | undefined;
  let honeypot = '';
  try {
    const body = (await req.json()) as { email?: unknown; firstName?: unknown; company?: unknown };
    if (typeof body.email === 'string') email = body.email;
    if (typeof body.firstName === 'string') firstName = body.firstName;
    if (typeof body.company === 'string') honeypot = body.company; // hidden field; humans leave it blank
  } catch {
    return jsonError(400, 'invalid_body');
  }

  // A filled honeypot is a bot: return success without storing anything.
  if (honeypot.trim()) return NextResponse.json(SUCCESS);

  if (rateLimited(clientIp(req))) {
    return jsonError(429, 'rate_limited', { message: 'Too many attempts. Please try again in a minute.' });
  }

  try {
    const res = await joinWaitlist({ email, firstName, source: 'landing' });
    if (!res.ok) {
      return jsonError(400, res.error, { message: 'Please enter a valid email address.' });
    }
    return NextResponse.json(SUCCESS);
  } catch (e) {
    return errorResponse(e);
  }
}
