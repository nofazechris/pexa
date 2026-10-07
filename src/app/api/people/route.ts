import { NextResponse } from 'next/server';
import { withUser, errorResponse } from '@/lib/http';
import { getOrCreateUser } from '@/lib/users/service';
import { quickPicks } from '@/lib/contacts/people';
import { lastSeen } from '@/lib/contacts/match';

/**
 * The people you deal with, for quick picks: saved beneficiaries first, then everyone you have paid or been
 * paid by (either direction), most recent first. Built from real payments — nothing to maintain.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await withUser(req);
  if ('response' in auth) return auth.response;
  try {
    const user = await getOrCreateUser(auth.user.userId);
    const people = await quickPicks(user.id, 6);
    return NextResponse.json({
      people: people.map((p) => ({ username: p.username, uid: p.uid, saved: p.saved, lastSeen: lastSeen(p) || null })),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
