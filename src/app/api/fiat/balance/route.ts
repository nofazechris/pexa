import { NextResponse } from 'next/server';
import { withUser, errorResponse, jsonError } from '@/lib/http';
import { getOrCreateUser } from '@/lib/users/service';
import { features } from '@/lib/config';
import { getConvertedUsdtBalanceRaw } from '@/lib/fiat/service';
import { formatUnitsToUsdt } from '@/lib/fiat/units';

/** The user's USDT balance from settled Pexa conversions. Disabled unless fiat is on. */
export async function GET(req: Request) {
  const auth = await withUser(req);
  if ('response' in auth) return auth.response;
  if (!features.fiat) return jsonError(404, 'fiat_not_enabled');

  try {
    const user = await getOrCreateUser(auth.user.userId);
    const raw = await getConvertedUsdtBalanceRaw(user.id);
    return NextResponse.json({
      usdt: formatUnitsToUsdt(raw),
      sandbox: features.fiatSandbox,
      fundingLive: features.fundingLive,
      public: features.fiatPublic,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
