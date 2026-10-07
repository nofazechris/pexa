import { NextResponse } from 'next/server';
import { clientIp, rateLimit } from '@/lib/security/ratelimit';
import { jsonError, errorResponse, siteOrigin } from '@/lib/http';
import { waitlistStatusByCode } from '@/lib/referrals/service';
import { buildReferralLink } from '@/lib/referrals/code';

/**
 * A waitlist entrant's current place in line + referral count, looked up by their share code (the
 * code the landing page remembers for them). The code is an unguessable token, so possessing it is
 * what proves "this is my entry"; the response never includes an email or any other personal data.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const tooMany = rateLimit('waitlist-status', clientIp(req), { max: 60, windowMs: 60_000 });
  if (tooMany) return tooMany;
  const code = new URL(req.url).searchParams.get('code');
  try {
    const status = await waitlistStatusByCode(code);
    if (!status) return jsonError(404, 'not_found');
    return NextResponse.json({
      referral: { code: status.code, link: buildReferralLink(siteOrigin(req), status.code), position: status.position, total: status.total, referrals: status.referrals },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
