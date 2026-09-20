import { NextResponse } from 'next/server';
import { withUser, errorResponse, jsonError } from '@/lib/http';
import { getOrCreateUser } from '@/lib/users/service';
import { executeConfirmedAction } from '@/lib/agent/runtime';

/**
 * Execute a user-confirmed agent action (§11, §28). The client sends the exact tool + args the
 * agent proposed and the user confirmed; this runs that one EXECUTE tool as the authenticated user.
 * The tool handler re-runs the policy engine and single-use authorization, so a stale or tampered
 * confirmation cannot move money — intent is never authorization.
 */
export async function POST(req: Request) {
  const auth = await withUser(req);
  if ('response' in auth) return auth.response;

  let body: { tool?: unknown; args?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'invalid_body');
  }
  const tool = typeof body.tool === 'string' ? body.tool : '';
  const args = body.args && typeof body.args === 'object' ? (body.args as Record<string, unknown>) : {};
  if (!tool) return jsonError(400, 'missing_fields', { message: 'tool is required.' });

  try {
    const user = await getOrCreateUser(auth.user.userId);
    const res = await executeConfirmedAction({ userId: user.id, tool, args });
    if (!res.ok) return jsonError(422, 'execute_failed', { message: res.error });
    return NextResponse.json({ result: res.result });
  } catch (e) {
    return errorResponse(e);
  }
}
