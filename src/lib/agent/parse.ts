import { CONFIRMATION_REQUIRED, type AgentIntent, type IntentType } from './intent';

/**
 * Deterministic fallback intent parser (§26–27). Used when no LLM key is configured, and as the
 * fast path for clear commands (no network round-trip). Pure and side-effect-free — the LLM path
 * produces the same {@link AgentIntent} shape, validated by `parseAgentIntent`.
 *
 * Fiat amounts keep their raw form (commas / ₦ / "usdt") in `parameters.amount`; the fiat service
 * parses them to smallest units. `unit` says which currency the amount is in.
 */
export function parseIntentRuleBased(message: string): AgentIntent {
  const low = message.trim().toLowerCase();
  const amountMatch = low.match(/([0-9]+(?:\.[0-9]{1,2})?)/);
  const amount = amountMatch ? amountMatch[1] : undefined;
  const handleMatch = low.match(/@([a-z0-9_]+)/);
  const handle = handleMatch ? '@' + handleMatch[1] : undefined;
  const every = low.match(/every\s+([a-z]+)/);

  // Fiat amounts: NGN keeps commas/₦ (service parses them); USDT captured with its unit.
  const ngnAmt = (message.match(/₦\s*([\d,]+(?:\.\d+)?)/) ?? low.match(/([\d,]+(?:\.\d+)?)\s*(?:naira|ngn)/))?.[1];
  const usdtAmt = low.match(/([\d,]+(?:\.\d+)?)\s*usdt/)?.[1];
  const mentionsUsdt = /usdt/.test(low);
  const mentionsNaira = /naira|ngn|₦/.test(low);

  const build = (type: IntentType, parameters: Record<string, unknown>, confidence: number): AgentIntent => ({
    type,
    parameters,
    confidence,
    requiresConfirmation: CONFIRMATION_REQUIRED.includes(type),
  });

  // --- Fiat (NGN↔USDT) — checked before crypto/balance so "how much naira for 100 USDT" isn't a
  //     balance query and "₦100,000" isn't mis-parsed as "100".
  if (/how much|what.*get|rate/.test(low) && (usdtAmt || (ngnAmt && mentionsUsdt))) {
    return usdtAmt
      ? build('GET_FIAT_QUOTE', { amount: usdtAmt, unit: 'USDT', side: 'sell' }, 0.85)
      : build('GET_FIAT_QUOTE', { amount: ngnAmt, unit: 'NGN', side: 'buy' }, 0.85);
  }
  if (/\bfund\b/.test(low) && ngnAmt) return build('FUND_WALLET_NGN', { amount: ngnAmt, unit: 'NGN' }, 0.85);
  if ((/\bwithdraw\b/.test(low) || /\bbank\b/.test(low)) && ngnAmt) {
    return build('WITHDRAW_NGN', { amount: ngnAmt, unit: 'NGN' }, 0.85);
  }
  if (/\bbuy\b/.test(low) && mentionsUsdt && ngnAmt) {
    const recurring = every ? `Every ${every[1]}` : undefined;
    return recurring
      ? build('CREATE_RECURRING_CONVERSION', { amount: ngnAmt, unit: 'NGN', recurring }, 0.8)
      : build('BUY_USDT_NGN', { amount: ngnAmt, unit: 'NGN' }, 0.9);
  }
  if ((/\bconvert\b/.test(low) || /\bsell\b/.test(low)) && usdtAmt && (mentionsNaira || /\bsell\b/.test(low))) {
    return build('SELL_USDT_NGN', { amount: usdtAmt, unit: 'USDT' }, 0.9);
  }

  // --- Crypto (USDC on Celo)
  if (/balance|how much/.test(low)) return build('GET_BALANCE', {}, 0.9);
  if (/recent|activity|history|transactions|payments/.test(low) && !amount) return build('GET_TRANSACTIONS', {}, 0.85);
  if (every && amount) {
    return build('SEND_PAYMENT', { recipient: handle, amount, token: 'USDC', recurring: `Every ${every[1]}` }, handle ? 0.8 : 0.4);
  }
  if (/request|invoice|ask/.test(low) && amount) {
    const note = (low.match(/for\s+(.+)$/) ?? [])[1]?.replace(/[.]$/, '');
    return build('REQUEST_PAYMENT', { recipient: handle, amount, token: 'USDC', memo: note }, handle ? 0.8 : 0.4);
  }
  if (amount) return build('SEND_PAYMENT', { recipient: handle, amount, token: 'USDC' }, handle ? 0.85 : 0.4);
  return build('GET_PROFILE', {}, 0.3);
}
