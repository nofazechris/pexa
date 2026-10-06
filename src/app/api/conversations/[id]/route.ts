import { NextResponse } from 'next/server';
import { withUser, errorResponse, jsonError } from '@/lib/http';
import { getOrCreateUser } from '@/lib/users/service';
import { deleteConversation, getConversation, saveConversation } from '@/lib/conversations/service';

/** One saved chat: open it (GET), save it (PUT — creates it if new), or delete it (DELETE). */
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 700_000;

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await withUser(req);
  if ('response' in auth) return auth.response;
  try {
    const { id } = await ctx.params;
    const user = await getOrCreateUser(auth.user.userId);
    const convo = await getConversation(user.id, id);
    if (!convo) return jsonError(404, 'not_found');
    return NextResponse.json(convo);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await withUser(req);
  if ('response' in auth) return auth.response;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return jsonError(413, 'too_large');
    let body: { messages?: unknown };
    try {
      body = JSON.parse(text);
    } catch {
      return jsonError(400, 'invalid_body');
    }
    const { id } = await ctx.params;
    const user = await getOrCreateUser(auth.user.userId);
    const res = await saveConversation(user.id, id, body.messages);
    if (!res.ok) return res.code === 'invalid_id' ? jsonError(400, 'invalid_id') : jsonError(404, 'not_found');
    return NextResponse.json({ saved: res.saved });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await withUser(req);
  if ('response' in auth) return auth.response;
  try {
    const { id } = await ctx.params;
    const user = await getOrCreateUser(auth.user.userId);
    const ok = await deleteConversation(user.id, id);
    return ok ? NextResponse.json({ deleted: true }) : jsonError(404, 'not_found');
  } catch (e) {
    return errorResponse(e);
  }
}
