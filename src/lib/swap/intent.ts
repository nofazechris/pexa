import { isSwapToken, parseAmount, type SwapToken } from './route';

/**
 * Reading "convert $5 to USAT" (and "swap 10 USDC for USDT", "sell my USAT", "buy 5 USAT") without guessing.
 * The app reads this itself, like sending money: it only ever PREPARES a conversion — the person's Confirm is what runs it.
 */

export type SwapIntent =
  | { kind: 'none' }
  /** `amount` is a plain number string, 'all', or null when we still have to ask. */
  | { kind: 'swap'; from: SwapToken; to: SwapToken; amount: string | 'all' | null };

export const ASK_AMOUNT_RE = /How much (USDC|USDT|USAT) do you want to convert to (USDC|USDT|USAT)\?/;

export function askSwapAmount(from: SwapToken, to: SwapToken): string {
  return `How much ${from} do you want to convert to ${to}? (A number like 5 or 25.50 — or “all”.)`;
}

const TOKEN_RE = /\b(usdc|usdt|usat)\b/gi;
const SWAP_VERBS = /\b(convert|swap|exchange|change|turn|trade|switch|move)\b/i;
const BUY_USAT = /\b(buy|get|purchase|grab|want)\b(?:\s+me)?(?:\s+(?:some|\$?\d[\d.,]*(?:\s*(?:usdc|dollars?|usd|bucks))?(?:\s+worth\s+of)?))?\s+usat\b/i;
const SELL_WORDS = /\b(sell|cash out|swap back|convert back|back to (usdc|usdt)|out of usat)\b/i;
/** "change my pay token to USAT" is a setting, and "use USAT to buy posts" is Buy — neither is a conversion. */
const NOT_A_CONVERSION = /\b(pay(?:ment)?s?\s+(?:token|with|in|using)|use usat|using usat|paying (?:in|with)|default (?:token|currency)|buy settings|preferred)\b/i;
const AMOUNT_RE = /\$?\s*(\d[\d,]*(?:\.\d+)?)/;
const ALL_RE = /\b(all|everything|whole balance|entire balance|max)\b/i;

function tokensIn(text: string): SwapToken[] {
  const out: SwapToken[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    const t = m[1].toUpperCase();
    if (isSwapToken(t)) out.push(t);
  }
  return out;
}

export function parseSwapIntent(text: string, previousAssistant?: string): SwapIntent {
  const t = text.trim();
  if (!t || t.length > 200) return { kind: 'none' };

  // The answer to "How much USDC do you want to convert to USAT?"
  const asked = previousAssistant?.match(ASK_AMOUNT_RE);
  if (asked) {
    const from = asked[1].toUpperCase() as SwapToken;
    const to = asked[2].toUpperCase() as SwapToken;
    const bare = t.replace(/\b(usdc|usdt|usat|dollars?|usd)\b/gi, '').trim();
    if (ALL_RE.test(bare) && bare.split(/\s+/).length <= 3) return { kind: 'swap', from, to, amount: 'all' };
    if (parseAmount(bare) !== null) return { kind: 'swap', from, to, amount: bare.replace(/^\$/, '').replace(/,/g, '') };
  }

  if (NOT_A_CONVERSION.test(t)) return { kind: 'none' };
  const tokens = tokensIn(t);
  const distinct = [...new Set(tokens)];
  const mentionsUsat = distinct.includes('USAT');
  const hasVerb = SWAP_VERBS.test(t);

  // Something is being converted: USAT is named, or two different dollar coins are.
  const conversion = (mentionsUsat && (hasVerb || BUY_USAT.test(t) || SELL_WORDS.test(t))) || (distinct.length >= 2 && hasVerb);
  if (!conversion) return { kind: 'none' };

  let from: SwapToken;
  let to: SwapToken;
  const fromNamed = t.match(/\bfrom\s+(usdc|usdt|usat)\b/i);
  if (distinct.length >= 2) {
    from = fromNamed ? (fromNamed[1].toUpperCase() as SwapToken) : tokens[0];
    to = distinct.find((x) => x !== from) as SwapToken;
    // "convert to USAT from USDC": the one after "to/into/for" is the target.
    const toNamed = t.match(/\b(?:to|into|for)\s+(usdc|usdt|usat)\b/i);
    if (toNamed && !fromNamed) {
      to = toNamed[1].toUpperCase() as SwapToken;
      from = distinct.find((x) => x !== to) as SwapToken;
    }
  } else if (mentionsUsat) {
    const amountBeforeUsat = /\b(convert|swap|exchange|change|trade)\b\s*(?:my\s+)?(?:\$?[\d.,]+|all(?:\s+my)?)\s*usat\b/i.test(t);
    const selling = SELL_WORDS.test(t) || (fromNamed && fromNamed[1].toUpperCase() === 'USAT') || amountBeforeUsat;
    from = selling ? 'USAT' : 'USDC';
    to = selling ? 'USDC' : 'USAT';
  } else {
    return { kind: 'none' };
  }
  if (from === to) return { kind: 'none' };

  let amount: string | 'all' | null = null;
  if (ALL_RE.test(t) && !/\ball\s+(?:of\s+)?(?:the|these)\b/i.test(t)) amount = 'all';
  else {
    const m = t.match(AMOUNT_RE);
    if (m) {
      const clean = m[1].replace(/,/g, '');
      if (parseAmount(clean) !== null) amount = clean;
    }
  }
  return { kind: 'swap', from, to, amount };
}
