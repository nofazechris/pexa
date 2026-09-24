import 'server-only';
import OpenAI from 'openai';
import { z } from 'zod';
import { formatUnits } from 'viem';
import { env, activeNetwork, getToken, features } from '@/lib/config';
import { TOOLS, TOOLS_BY_NAME, ToolError, type ToolContext } from '@/lib/mcp/tools';
import { getPayment } from '@/lib/payments/engine';
import { getProfileByUserId } from '@/lib/users/service';
import { getFiatQuoteById } from '@/lib/fiat/service';
import { presentQuote, type QuoteView } from '@/lib/fiat/present';

/**
 * Pexa agent runtime (§10, §13, §28) — the in-app bot as a real tool-calling agent.
 *
 * It reasons over the conversation and calls Pexa's backend tools (the same handlers MCP uses, run
 * as the authenticated user). READ/PREPARE tools run automatically inside the loop (Levels 1–2).
 * A money-moving EXECUTE tool is never run by the model: the runtime intercepts it and returns a
 * pending action for the user to confirm (Level 3). The AgentPolicyEngine and single-use
 * authorization stay the security boundary — the model proposes, the backend decides (§11, §28).
 */

// Tools the model can call. Excludes create_payout (MCP-only) — in-app withdrawals go through a
// sell quote + create_sell_usdt_order so they share the confirm-card path.
const AGENT_TOOLS = new Set([
  'get_profile',
  'get_balance',
  'find_contact',
  'get_recent_transactions',
  'get_payment_status',
  'create_payment_preview',
  'create_request',
  'get_ngn_usdt_quote',
  'get_usdt_balance',
  'get_payout_accounts',
  'verify_payout_account',
  'get_user_limits',
  'get_compliance_status',
  'confirm_payment',
  'create_buy_usdt_order',
  'create_sell_usdt_order',
]);

// EXECUTE tools — intercepted for explicit user confirmation, never auto-run by the model.
const CONFIRM_TOOLS = new Set(['confirm_payment', 'create_buy_usdt_order', 'create_sell_usdt_order']);

// Fiat tools are only offered when the feature is on.
const FIAT_TOOLS = new Set([
  'get_ngn_usdt_quote',
  'get_usdt_balance',
  'get_payout_accounts',
  'verify_payout_account',
  'get_user_limits',
  'get_compliance_status',
  'create_buy_usdt_order',
  'create_sell_usdt_order',
]);

const MAX_STEPS = 8;

const SYSTEM_PROMPT = `You are Pexa — an AI financial agent. Users talk to you to move and manage money: send/request USDC on Celo by @username, check balances and activity, and (Nigeria) buy/sell USDT with naira, link a bank account, and withdraw naira. Everything happens through this chat.

How you work:
- Use tools for every fact. NEVER invent balances, rates, contacts, statuses, or that something succeeded — read it from a tool result.
- You may freely call read tools (balance, profile, contacts, transactions, quotes, limits, compliance, list payout accounts), preparation tools (create_payment_preview, get_ngn_usdt_quote), and verify_payout_account to link a bank account.
- To move money — send a payment, buy/sell/convert, or withdraw — FIRST prepare it (create_payment_preview for a send; get_ngn_usdt_quote for buy/sell/withdraw), then in the SAME turn call the matching execute tool (confirm_payment / create_buy_usdt_order / create_sell_usdt_order). Calling the execute tool does NOT run it — it makes the app show the user a Confirm button. So when the user wants to DO the action, you MUST call the execute tool; do NOT stop and ask "would you like to proceed?" in text. Only skip the execute tool when the user explicitly asked for just a rate/quote or preview.
- Withdraw to a bank = a sell: call get_ngn_usdt_quote with side "sell" and amountCurrency "NGN" for a naira amount, then create_sell_usdt_order (the user's linked account is used automatically). If they have no linked account, ask for their account number and bank, then verify_payout_account.
- You can chain steps yourself to fulfil a request (e.g. link the account, then quote, then prepare the withdrawal).
- Be concise, warm and clear. Money amounts: NGN like ₦100,000; USDT/USDC with the ticker. Restate the specifics (amount, recipient/destination) in your reply.
- Only do things Pexa supports. If something isn't available yet (recurring naira purchases, holding a naira balance), say so plainly. Never bypass limits, KYC, or confirmation.`;

export interface PendingAction {
  tool: string;
  args: Record<string, unknown>;
  /** What the client renders as a confirmation card. */
  render:
    | { type: 'payment_preview'; recipient: string; amount: string; token: string; network: string }
    | { type: 'fiat_quote'; quote: QuoteView };
}

export interface AgentTurn {
  reply: string;
  action?: PendingAction;
}

export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
}

let client: OpenAI | null = null;
function getClient(): OpenAI | null {
  if (client) return client;
  if (!env.AI_API_KEY) return null;
  client = new OpenAI({ apiKey: env.AI_API_KEY });
  return client;
}

function toolParams(schema: z.ZodTypeAny): Record<string, unknown> {
  try {
    return z.toJSONSchema(schema) as Record<string, unknown>;
  } catch {
    return { type: 'object', properties: {} };
  }
}

function toolDefs(): OpenAI.Chat.Completions.ChatCompletionTool[] {
  const defs: OpenAI.Chat.Completions.ChatCompletionTool[] = [];
  for (const t of TOOLS) {
    if (!AGENT_TOOLS.has(t.name)) continue;
    if (!features.fiat && FIAT_TOOLS.has(t.name)) continue;
    defs.push({ type: 'function', function: { name: t.name, description: t.description, parameters: toolParams(t.schema) } });
  }
  return defs;
}

function parseArgs(raw: string | undefined): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || '{}');
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function buildRender(ctx: ToolContext, tool: string, args: Record<string, unknown>): Promise<PendingAction['render'] | null> {
  if (tool === 'confirm_payment') {
    const paymentId = typeof args.paymentId === 'string' ? args.paymentId : '';
    const p = await getPayment(paymentId, ctx.userId);
    if (!p) return null;
    let recipient = `${p.recipientAddress.slice(0, 6)}…${p.recipientAddress.slice(-4)}`;
    if (p.recipientUserId) {
      const prof = await getProfileByUserId(p.recipientUserId);
      if (prof) recipient = '@' + prof.username;
    }
    const decimals = getToken(p.token, activeNetwork.network)?.decimals ?? 6;
    return { type: 'payment_preview', recipient, amount: formatUnits(BigInt(p.amount), decimals), token: p.token, network: activeNetwork.name };
  }
  if (tool === 'create_buy_usdt_order' || tool === 'create_sell_usdt_order') {
    const quoteId = typeof args.quoteId === 'string' ? args.quoteId : '';
    const q = await getFiatQuoteById(ctx.userId, quoteId);
    if (!q) return null;
    return { type: 'fiat_quote', quote: presentQuote(q) };
  }
  return null;
}

/**
 * Run one agent turn: auto-executes read/prepare tools and stops when the model wants to move
 * money, returning a pending action for the user to confirm. Returns null only when no AI key is
 * configured (the caller then falls back to the simple parser path).
 */
export async function runAgentTurn(input: { userId: string; messages: AgentMessage[] }): Promise<AgentTurn | null> {
  const openai = getClient();
  if (!openai) return null;
  const ctx: ToolContext = { userId: input.userId };

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...input.messages.map((m) => ({ role: m.role, content: m.content }) as OpenAI.Chat.Completions.ChatCompletionMessageParam),
  ];
  const tools = toolDefs();

  for (let step = 0; step < MAX_STEPS; step++) {
    const resp = await openai.chat.completions.create({
      model: env.AI_MODEL || 'gpt-4o-mini',
      messages,
      tools,
      tool_choice: 'auto',
      temperature: 0,
      max_tokens: 500,
    });
    const msg = resp.choices[0]?.message;
    if (!msg) return { reply: "Sorry — I couldn't process that." };

    const calls = (msg.tool_calls ?? []).filter((c) => c.type === 'function');
    if (calls.length === 0) return { reply: msg.content ?? '' };

    // A money-moving call → stop and hand back a confirmation card (never executed by the model).
    const confirmCall = calls.find((c) => CONFIRM_TOOLS.has(c.function.name));
    if (confirmCall) {
      const args = parseArgs(confirmCall.function.arguments);
      const render = await buildRender(ctx, confirmCall.function.name, args);
      if (render) return { reply: msg.content ?? '', action: { tool: confirmCall.function.name, args, render } };
      // Preview couldn't be built (e.g. no prepared quote/payment yet) — let the model prepare first.
    }

    // Otherwise (or on a failed render), run the auto tools and feed results back.
    messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: msg.tool_calls });
    for (const call of calls) {
      if (call.type !== 'function') continue;
      let content: string;
      if (CONFIRM_TOOLS.has(call.function.name)) {
        content = JSON.stringify({ error: 'not_ready', message: 'Prepare the action first (quote/preview) before confirming.' });
      } else {
        const def = TOOLS_BY_NAME.get(call.function.name);
        if (!def || !AGENT_TOOLS.has(call.function.name)) {
          content = JSON.stringify({ error: 'unknown_tool' });
        } else {
          try {
            content = JSON.stringify(await def.handler(ctx, parseArgs(call.function.arguments)));
          } catch (e) {
            content = JSON.stringify({ error: e instanceof ToolError ? e.code : 'error', message: e instanceof Error ? e.message : 'Tool failed.' });
          }
        }
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content });
    }
  }

  return { reply: 'That took more steps than expected — could you rephrase what you need?' };
}

/** Execute a confirmed action (an EXECUTE tool) as the user. Runs the same policy-gated handler. */
export async function executeConfirmedAction(input: {
  userId: string;
  tool: string;
  args: Record<string, unknown>;
}): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  if (!CONFIRM_TOOLS.has(input.tool)) return { ok: false, error: 'Not a confirmable action.' };
  const def = TOOLS_BY_NAME.get(input.tool);
  if (!def) return { ok: false, error: 'Unknown action.' };
  try {
    const result = await def.handler({ userId: input.userId }, input.args);
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e instanceof ToolError ? e.message : e instanceof Error ? e.message : 'Action failed.' };
  }
}
