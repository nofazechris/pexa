import { NextResponse, after } from 'next/server';
import { jsonError, errorResponse, siteOrigin } from '@/lib/http';
import { joinWaitlist } from '@/lib/waitlist/service';
import { getOrCreateCode, recordReferral, waitlistStatus } from '@/lib/referrals/service';
import { buildReferralLink } from '@/lib/referrals/code';
import { waitlistWelcomeEmail } from '@/lib/email/templates';
import { sendEmail } from '@/lib/email/send';

/**
 * Public waitlist signup (§26–27). No auth — anyone on the landing page can join. Defends the
 * open endpoint with server-side validation, a honeypot, and best-effort per-IP rate limiting.
 * Duplicates return the same friendly success as a fresh signup, so the endpoint never reveals
 * who is already on the list and never surfaces a raw database error.
 */

const SUCCESS = { success: true, message: "You're on the list — we'll email your early-access invite when the app opens." };

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
  let ref: unknown;
  try {
    const body = (await req.json()) as { email?: unknown; firstName?: unknown; company?: unknown; ref?: unknown };
    if (typeof body.email === 'string') email = body.email;
    if (typeof body.firstName === 'string') firstName = body.firstName;
    if (typeof body.company === 'string') honeypot = body.company; // hidden field; humans leave it blank
    ref = body.ref; // the referrer's code from the share link (validated/ignored if junk downstream)
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
    // Already on the list: the same generic success as a new signup, with nothing extra — returning
    // a position or link here would reveal who is on the list to anyone who types an email.
    if (!res.created) return NextResponse.json(SUCCESS);

    // New signup. Everything below is best-effort: the signup itself is already saved, so a hiccup
    // in the referral bookkeeping must never turn into a failed signup.
    try {
      const code = await getOrCreateCode('waitlist', res.id);
      if (ref) await recordReferral({ code: ref, refereeType: 'waitlist', refereeId: res.id }).catch((e) => console.error('[waitlist] referral credit failed:', e));
      const status = await waitlistStatus(res.id);
      const link = buildReferralLink(siteOrigin(req), code);
      if (status) {
        const welcome = waitlistWelcomeEmail({ position: status.position, total: status.total, link });
        const to = res.email;
        after(async () => {
          await sendEmail(to, welcome); // no-op until RESEND_API_KEY + EMAIL_FROM are configured
        });
      }
      return NextResponse.json({
        ...SUCCESS,
        referral: status ? { code, link, position: status.position, total: status.total, referrals: status.referrals } : { code, link },
      });
    } catch (e) {
      console.error('[waitlist] referral setup failed (signup saved):', e);
      return NextResponse.json(SUCCESS);
    }
  } catch (e) {
    return errorResponse(e);
  }
}
