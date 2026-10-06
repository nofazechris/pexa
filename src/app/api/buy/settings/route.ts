import { NextResponse } from 'next/server';
import { withUser, errorResponse, jsonError } from '@/lib/http';
import { getOrCreateUser } from '@/lib/users/service';
import { getSpending, saveBuySettings } from '@/lib/buy/service';

/**
 * The user's Buy spending guardrails and today's usage (GET), and updating them (PUT). Values are
 * clamped server-side to safe ranges — the hard per-purchase ceiling can't be raised from here.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await withUser(req);
  if ('response' in auth) return auth.response;
  try {
    const user = await getOrCreateUser(auth.user.userId);
    return NextResponse.json(await getSpending(user.id));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PUT(req: Request) {
  const auth = await withUser(req);
  if ('response' in auth) return auth.response;
  let body: { autonomous?: unknown; autoLimitAtomic?: unknown; dailyBudgetAtomic?: unknown; payToken?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'invalid_body');
  }
  try {
    const user = await getOrCreateUser(auth.user.userId);
    await saveBuySettings(user.id, body);
    return NextResponse.json(await getSpending(user.id));
  } catch (e) {
    return errorResponse(e);
  }
}
