import { isEarnToken, parseAmount, type EarnAction, type EarnToken } from './aave';

/**
 * Reading "deposit $10 USDT into Aave" / "withdraw everything from Aave" without guessing. Like sending money and converting, the
 * app reads this itself and only ever PREPARES the action — the person's Confirm is what runs it.
 *
 * "Deposit" alone means *receive money* in Pexa, so an earn intent needs an earning word too (Aave, earn, yield, lend, interest).
 * "Where can I earn on my USDC?" is research, not an action, so it needs an action verb as well.
 */

export type EarnIntent =
  | { kind: 'none' }
  /** USAT can't be deposited: say so and offer to convert it first. */
  | { kind: 'usat' }
  /** `token` / `amount` are null when we still have to ask. */
  | { kind: 'earn'; action: EarnAction; token: EarnToken | null; amount: string | 'all' | null };

const ASK_TOKEN_RE = /Which coin do you want to (deposit into|withdraw from) Aave(?: \(\$([\d.]+)\))?: USDT or USDC\?/;
const ASK_AMOUNT_RE = /How much (USDT|USDC) do you want to (deposit into|withdraw from) Aave\?/;

export const askEarnToken = (action: EarnAction, amount: string | 'all' | null) =>
  `Which coin do you want to ${action === 'deposit' ? 'deposit into' : 'withdraw from'} Aave${amount && amount !== 'all' ? ` ($${amount})` : ''}: USDT or USDC?`;

export const askEarnAmount = (action: EarnAction, token: EarnToken) =>
  `How much ${token} do you want to ${action === 'deposit' ? 'deposit into' : 'withdraw from'} Aave? (A number like 5 or 25.50${action === 'withdraw' ? ' — or “all”' : ''}.)`;

const DEPOSIT_VERBS = /\b(deposit|put|invest|lend|supply|stake|park|move|add)\b/i;
const WITHDRAW_VERBS = /\b(withdraw|take (?:it |them |my \w+ )?out|cash out|pull|remove|redeem|get (?:it|my money) back)\b/i;
const EARN_CONTEXT = /\b(aave|earn(?:ing|ings)?|yield|lend(?:ing)?|interest|apy)\b/i;
const NOT_EARN = /\b(receive|incoming|send|pay|payment|transfer|bridge|vault|statement)\b/i;
const AMOUNT_RE = /\$?\s*(\d[\d,]*(?:\.\d+)?)/;
const ALL_RE = /\b(all|everything|whole balance|entire balance|max)\b/i;

function tokensIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/\b(usdt|usdc|usat|tether)\b/gi)) out.add(m[1].toLowerCase() === 'tether' ? 'USDT' : m[1].toUpperCase());
  return out;
}

function amountIn(text: string): string | 'all' | null {
  if (ALL_RE.test(text)) return 'all';
  const m = text.match(AMOUNT_RE);
  if (!m) return null;
  const n = m[1].replace(/,/g, '');
  return parseAmount(n) !== null ? n : null;
}

export function parseEarnIntent(text: string, previousAssistant?: string): EarnIntent {
  const t = text.trim();
  if (!t || t.length > 200) return { kind: 'none' };

  // The answer to "Which coin …: USDT or USDC?"
  const askedToken = previousAssistant?.match(ASK_TOKEN_RE);
  if (askedToken) {
    const toks = [...tokensIn(t)].filter(isEarnToken);
    if (toks.length === 1) return { kind: 'earn', action: askedToken[1] === 'deposit into' ? 'deposit' : 'withdraw', token: toks[0], amount: askedToken[2] ?? amountIn(t) };
  }
  // The answer to "How much USDT do you want to deposit into Aave?"
  const askedAmount = previousAssistant?.match(ASK_AMOUNT_RE);
  if (askedAmount) {
    const bare = t.replace(/\b(usdt|usdc|dollars?|usd)\b/gi, '').trim();
    const action: EarnAction = askedAmount[2] === 'deposit into' ? 'deposit' : 'withdraw';
    const token = askedAmount[1] as EarnToken;
    if (ALL_RE.test(bare) && bare.split(/\s+/).length <= 3) return { kind: 'earn', action, token, amount: 'all' };
    if (parseAmount(bare.replace(/^\$/, '').replace(/,/g, '')) !== null) return { kind: 'earn', action, token, amount: bare.replace(/^\$/, '').replace(/,/g, '') };
  }

  if (NOT_EARN.test(t) && !/\baave\b/i.test(t)) return { kind: 'none' };
  if (!EARN_CONTEXT.test(t)) return { kind: 'none' };

  const withdraw = WITHDRAW_VERBS.test(t);
  const deposit = DEPOSIT_VERBS.test(t);
  if (!withdraw && !deposit) return { kind: 'none' };

  const toks = tokensIn(t);
  const earnable = [...toks].filter(isEarnToken);
  if (toks.has('USAT') && !earnable.length) return { kind: 'usat' };
  // "Earn" or "yield" on their own, with no amount, coin or Aave, is a question about earning, not an instruction.
  if (!earnable.length && !AMOUNT_RE.test(t) && !/\baave\b/i.test(t) && !ALL_RE.test(t)) return { kind: 'none' };

  return { kind: 'earn', action: withdraw ? 'withdraw' : 'deposit', token: earnable.length === 1 ? earnable[0] : null, amount: amountIn(t) };
}
