import 'server-only';
import OpenAI from 'openai';
import { env } from '@/lib/config';
import { INTENT_TYPES, parseAgentIntent, type AgentIntent } from './intent';
import { parseIntentRuleBased } from './parse';

/**
 * Agent intent extraction (§24–28).
 *
 * Turns a natural-language message into a validated {@link AgentIntent}. Uses OpenAI when
 * `AI_API_KEY` is set (behind this provider boundary, so the model is swappable), and falls
 * back to the deterministic rule-based parser otherwise — so the agent works today and gets
 * smarter once a key is configured. The model's free-form output is never trusted: it must
 * parse into the schema, or we fall back (§29). Money-moving intents always require
 * confirmation, enforced by `parseAgentIntent`.
 */

const SYSTEM_PROMPT = `You are Pexa's payment intent parser. Pexa is an AI financial agent that sends, requests and
schedules USDC stablecoin payments on the Celo network, by @username. Convert the user's latest
message into exactly ONE structured intent. Output ONLY a JSON object — no prose, no code fences.

Shape:
{"type": one of [${INTENT_TYPES.join(', ')}], "parameters": object, "confidence": 0..1, "requiresConfirmation": boolean}

How to choose the type:
- SEND_PAYMENT — the user wants to pay/send money to someone now, OR set up a repeating payment.
  Recurring language ("every Friday", "weekly", "each month", "recurring") is still SEND_PAYMENT,
  distinguished only by the "recurring" parameter below.
- REQUEST_PAYMENT — the user wants to ask/invoice someone else to pay THEM ("request", "ask ... for", "invoice").
- GET_BALANCE — asking how much they have / their balance / available funds.
- GET_TRANSACTIONS — asking about recent payments, activity, or history (no specific amount to send).
- GET_PROFILE — asking about their own username / account / receive info.
- FIND_CONTACT — looking up whether a @username exists or is in their contacts.
- GET_PAYMENT_STATUS — asking about the status of a specific payment or transaction they already made.
- BUY_USDT_NGN — buy USDT with naira ("buy ₦100,000 of USDT", "get 50k naira of usdt").
- SELL_USDT_NGN — convert/sell USDT for naira ("convert 100 USDT to naira", "sell 50 usdt").
- GET_FIAT_QUOTE — asking the rate/how much they'd get, WITHOUT committing ("how much naira for 100 USDT?").
- FUND_WALLET_NGN — add naira to their Pexa wallet ("fund my wallet with ₦50,000").
- WITHDRAW_NGN — withdraw naira to their bank ("withdraw ₦100,000", "send ₦100,000 to my bank").
- CREATE_RECURRING_CONVERSION — a repeating fiat buy ("buy ₦20,000 of USDT every month").

Parameters:
- SEND_PAYMENT / REQUEST_PAYMENT: {recipient: "@username", amount: "20", token: "USDC", memo?: string, recurring?: string}
  - recipient: always prefixed with "@". If the user names someone without "@", still emit "@name". If no recipient is given, omit it and LOWER the confidence.
  - amount: a plain decimal string, no currency symbol or commas ("20", "12.50"). Ignore "$", "USD", "dollars".
  - token: default "USDC" unless another supported token is clearly named.
  - memo: the stated reason, e.g. from "for the design" -> "the design". Omit if none.
  - recurring: ONLY for repeating payments — a short human cadence label like "Every Friday", "Weekly", "Monthly". Omit for one-off payments.
- FIND_CONTACT: {username: "@name"}
- Fiat intents (BUY_USDT_NGN / SELL_USDT_NGN / GET_FIAT_QUOTE / FUND_WALLET_NGN / WITHDRAW_NGN /
  CREATE_RECURRING_CONVERSION): {amount: "100000", unit: "NGN" | "USDT"}. Buys/funding/withdrawals are
  in NGN (unit "NGN"); sells are in USDT (unit "USDT"). Keep the amount as digits (a decimal is fine);
  do not include ₦, commas or "USDT". For GET_FIAT_QUOTE also add side: "buy" (NGN→USDT) or "sell" (USDT→NGN).
  For CREATE_RECURRING_CONVERSION add recurring: a cadence label like "Monthly".
- Other types take {}.

Rules:
- requiresConfirmation MUST be true for SEND_PAYMENT and REQUEST_PAYMENT; false otherwise.
- confidence reflects how sure you are of BOTH the type and its parameters. A pay/request with a
  clear recipient and amount is ~0.9+. Missing recipient or amount, or a vague message, is <0.6.
- Never invent a recipient, amount, or reason that the user did not state.
- Base the intent only on the user's message. Do not add commentary or fields not listed above.

Examples:
"Send $20 to @sarah" -> {"type":"SEND_PAYMENT","parameters":{"recipient":"@sarah","amount":"20","token":"USDC"},"confidence":0.95,"requiresConfirmation":true}
"pay sarah 12.50 for lunch" -> {"type":"SEND_PAYMENT","parameters":{"recipient":"@sarah","amount":"12.50","token":"USDC","memo":"lunch"},"confidence":0.9,"requiresConfirmation":true}
"Pay @sarah $20 every Friday" -> {"type":"SEND_PAYMENT","parameters":{"recipient":"@sarah","amount":"20","token":"USDC","recurring":"Every Friday"},"confidence":0.92,"requiresConfirmation":true}
"Request $50 from @mike for the design" -> {"type":"REQUEST_PAYMENT","parameters":{"recipient":"@mike","amount":"50","token":"USDC","memo":"the design"},"confidence":0.93,"requiresConfirmation":true}
"What's my balance?" -> {"type":"GET_BALANCE","parameters":{},"confidence":0.97,"requiresConfirmation":false}
"show my recent payments" -> {"type":"GET_TRANSACTIONS","parameters":{},"confidence":0.9,"requiresConfirmation":false}
"is @chris on pexa?" -> {"type":"FIND_CONTACT","parameters":{"username":"@chris"},"confidence":0.85,"requiresConfirmation":false}
"Buy ₦100,000 of USDT" -> {"type":"BUY_USDT_NGN","parameters":{"amount":"100000","unit":"NGN"},"confidence":0.95,"requiresConfirmation":true}
"convert 100 USDT to naira" -> {"type":"SELL_USDT_NGN","parameters":{"amount":"100","unit":"USDT"},"confidence":0.95,"requiresConfirmation":true}
"how much naira will I get for 100 USDT?" -> {"type":"GET_FIAT_QUOTE","parameters":{"amount":"100","unit":"USDT","side":"sell"},"confidence":0.9,"requiresConfirmation":false}
"fund my wallet with ₦50,000" -> {"type":"FUND_WALLET_NGN","parameters":{"amount":"50000","unit":"NGN"},"confidence":0.9,"requiresConfirmation":true}
"withdraw ₦100,000 to my bank" -> {"type":"WITHDRAW_NGN","parameters":{"amount":"100000","unit":"NGN"},"confidence":0.9,"requiresConfirmation":true}
"buy ₦20,000 of USDT every month" -> {"type":"CREATE_RECURRING_CONVERSION","parameters":{"amount":"20000","unit":"NGN","recurring":"Monthly"},"confidence":0.88,"requiresConfirmation":true}
"send some money" -> {"type":"SEND_PAYMENT","parameters":{"token":"USDC"},"confidence":0.3,"requiresConfirmation":true}`;

let client: OpenAI | null = null;
function getClient(): OpenAI | null {
  if (client) return client;
  if (!env.AI_API_KEY) return null;
  client = new OpenAI({ apiKey: env.AI_API_KEY });
  return client;
}

/**
 * At/above this confidence the deterministic parser is trusted and we skip the LLM entirely.
 * The common commands ("Send $20 to @sarah", "what's my balance?", "pay @sarah every Friday")
 * clear this bar, so they resolve in ~0ms with no network round-trip. Only genuinely ambiguous
 * messages fall through to the model. This is the single biggest win for perceived speed.
 */
const FAST_PATH_CONFIDENCE = 0.8;

export async function extractIntent(message: string): Promise<AgentIntent> {
  // Fast path: answer confident, unambiguous commands instantly without touching the network.
  const quick = parseIntentRuleBased(message);
  const openai = getClient();
  if (!openai || quick.confidence >= FAST_PATH_CONFIDENCE) return quick;

  try {
    const completion = await openai.chat.completions.create({
      model: env.AI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: message },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: 150,
    });
    const raw = completion.choices[0]?.message?.content;
    if (!raw) return quick;
    const parsed = parseAgentIntent(JSON.parse(raw));
    // If the model's output doesn't fit the schema, fall back rather than trust it (§29).
    return parsed.ok ? parsed.intent : quick;
  } catch {
    return quick;
  }
}
