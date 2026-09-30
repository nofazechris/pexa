import { NextResponse } from 'next/server';
import { withUser, errorResponse, siteOrigin } from '@/lib/http';
import { getOrCreateUser } from '@/lib/users/service';
import { userReferralSummary } from '@/lib/referrals/service';
import { buildReferralLink } from '@/lib/referrals/code';

/**
 * The signed-in user's referral link and how many people have joined through it (created on first
 * use). Powers the "Invite friends" card on the Wallet screen.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await withUser(req);
  if ('response' in auth) return auth.response;
  try {
    const user = await getOrCreateUser(auth.user.userId);
    const { code, referrals } = await userReferralSummary(user.id);
    return NextResponse.json({ code, link: buildReferralLink(siteOrigin(req), code), referrals });
  } catch (e) {
    return errorResponse(e);
  }
}
