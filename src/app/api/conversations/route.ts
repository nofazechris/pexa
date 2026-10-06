import { NextResponse } from 'next/server';
import { withUser, errorResponse } from '@/lib/http';
import { getOrCreateUser } from '@/lib/users/service';
import { listConversations } from '@/lib/conversations/service';

/** The signed-in user's saved chats, newest first (titles only — open one to load its messages). */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await withUser(req);
  if ('response' in auth) return auth.response;
  try {
    const user = await getOrCreateUser(auth.user.userId);
    return NextResponse.json({ conversations: await listConversations(user.id) });
  } catch (e) {
    return errorResponse(e);
  }
}
