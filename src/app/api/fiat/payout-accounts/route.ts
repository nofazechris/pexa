import { NextResponse } from 'next/server';
import { withUser, errorResponse, jsonError } from '@/lib/http';
import { getOrCreateUser } from '@/lib/users/service';
import { features } from '@/lib/config';
import { verifyPayoutAccount, listPayoutAccounts } from '@/lib/fiat/payouts';
import { presentPayoutAccount } from '@/lib/fiat/present';

/**
 * Bank payout accounts (§7). POST verifies a Nigerian bank account with the provider and stores its
 * tokenized reference (never raw details). GET lists the user's accounts. Disabled unless fiat is on.
 */
export async function POST(req: Request) {
  const auth = await withUser(req);
  if ('response' in auth) return auth.response;
  if (!features.fiat) return jsonError(404, 'fiat_not_enabled');

  let body: { accountNumber?: unknown; bankCode?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'invalid_body');
  }
  const accountNumber = typeof body.accountNumber === 'string' ? body.accountNumber.trim() : '';
  const bankCode = typeof body.bankCode === 'string' ? body.bankCode.trim() : '';
  if (!accountNumber || !bankCode) return jsonError(400, 'missing_fields', { message: 'accountNumber and bankCode are required.' });

  try {
    const user = await getOrCreateUser(auth.user.userId);
    const res = await verifyPayoutAccount(user.id, { accountNumber, bankCode });
    if (!res.ok) return jsonError(422, 'verification_failed', { message: res.error });
    return NextResponse.json({ account: presentPayoutAccount(res.account) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function GET(req: Request) {
  const auth = await withUser(req);
  if ('response' in auth) return auth.response;
  if (!features.fiat) return jsonError(404, 'fiat_not_enabled');

  try {
    const user = await getOrCreateUser(auth.user.userId);
    const accounts = await listPayoutAccounts(user.id);
    return NextResponse.json({ accounts: accounts.map(presentPayoutAccount) });
  } catch (e) {
    return errorResponse(e);
  }
}
