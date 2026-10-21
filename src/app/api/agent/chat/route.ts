import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/security/ratelimit';
import { withUser, errorResponse, jsonError } from '@/lib/http';
import { getOrCreateUser } from '@/lib/users/service';
import { runAgentTurn, type AgentMessage } from '@/lib/agent/runtime';

/**
 * The Pexa agent chat endpoint (§28). Runs the tool-calling agent for the authenticated user and
 * returns the assistant's reply plus, when the agent wants to move money, a pending action for the
 * client to confirm. Execution happens only through /api/agent/execute after the user confirms —
 * the model never moves money itself (§11).
 */
// An autonomous Buy purchase can run inside a chat turn (the agent waits for the paid result).
export const maxDuration = 300;

export async function POST(req: Request) {
  const auth = await withUser(req);
  if ('response' in auth) return auth.response;
  const tooMany = rateLimit('agent-chat', auth.user.userId, { max: 30, windowMs: 60000 });
  if (tooMany) return tooMany;

  let body: { message?: unknown; history?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'invalid_body');
  }
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) return jsonError(400, 'empty_message');

  // Recent turns for context (bounded), oldest→newest, then the new user message.
  const history: AgentMessage[] = Array.isArray(body.history)
    ? body.history
        .filter((m): m is { role: string; content: string } => !!m && typeof m === 'object' && typeof (m as { content?: unknown }).content === 'string')
        .slice(-16)
        .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content.slice(0, 2000) }))
    : [];

  // A browser that asks for it gets the turn as a stream of lines: what the agent is doing as it does it, then the answer.
  if ((req.headers.get('accept') ?? '').includes('application/x-ndjson')) {
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (o: unknown) => {
          try {
            controller.enqueue(enc.encode(JSON.stringify(o) + '\n'));
          } catch {
            /* the browser went away */
          }
        };
        try {
          const user = await getOrCreateUser(auth.user.userId);
          const turn = await runAgentTurn({ userId: user.id, messages: [...history, { role: 'user', content: message }] }, { onStage: (e) => send({ t: 'stage', ...e }) });
          if (!turn) send({ t: 'error', status: 503, error: 'agent_unavailable' });
          else send({ t: 'turn', turn });
        } catch (e) {
          const r = errorResponse(e);
          const body = (await r.json().catch(() => ({}))) as { error?: string };
          send({ t: 'error', status: r.status, error: body.error ?? '' });
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } });
  }

  try {
    const user = await getOrCreateUser(auth.user.userId);
    const turn = await runAgentTurn({ userId: user.id, messages: [...history, { role: 'user', content: message }] });
    if (!turn) return jsonError(503, 'agent_unavailable', { message: 'The agent is not configured.' });
    return NextResponse.json(turn);
  } catch (e) {
    return errorResponse(e);
  }
}
