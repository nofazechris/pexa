/**
 * "Check." — checking WHAT? A person who has just been shown a deposit address and then types "check" means "has my money
 * arrived?", not "look up this seller". Short messages only mean something in the context of what is on screen, so this reads
 * the last few things said (and the notes of the cards that were shown) before deciding.
 *
 * Pure and tested. It only decides what the message refers to; the answer is then read from the chain, never guessed.
 */

export type TurnMessage = { role: 'user' | 'assistant'; content: string };

/** Short follow-ups that mean "has it happened yet?": "check", "check now", "did it arrive?", "any update?", "is it there?". */
const BARE_CHECK = /^\s*(?:ok(?:ay)?[,.]?\s+)?(?:please\s+|pls\s+)?(?:can you\s+|could you\s+)?(?:re-?check|check|refresh|verify|look|see|update|status)(?:\s+(?:now|again|it|that|this|please|pls|for me|for it|if it(?:'s| is)?(?: there| in| here)?|my (?:deposit|payment|transfer|money|funds|balance)|the (?:deposit|payment|transfer|money|funds)))*\s*[.!?]*\s*$/i;
const HAS_IT_ARRIVED = /\b(?:did|has|have|is|was|does|do)\b[^.?!]{0,40}\b(?:it|that|this|my (?:deposit|money|funds|transfer|payment|usdc)|the (?:deposit|money|funds|transfer|payment)|anything)\b[^.?!]{0,30}\b(?:arriv\w*|came|come|landed|land|go(?:ne)? through|received|show(?:ed|n)? up|there|here|in(?: yet)?|complete[d]?|done|reach\w*)\b/i;
const ANY_NEWS = /^\s*(?:any|is there any)\s+(?:update|news|luck|deposit|money|change|sign)s?\b[^.?!]*[.!?]*\s*$/i;
const CHECK_WITH_SUBJECT = /\bcheck\b[^.?!]{0,30}\b(?:deposit|arriv\w*|transfer|funds|my balance|if (?:it|the)|whether)\b/i;

export function isCheckRequest(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 90) return false;
  return BARE_CHECK.test(t) || HAS_IT_ARRIVED.test(t) || ANY_NEWS.test(t) || CHECK_WITH_SUBJECT.test(t);
}

/** Notes/lines that mean "a deposit is what we're talking about". */
const DEPOSIT_CONTEXT = /deposit address|wallet address|arrives in (?:your|the person’s) pexa wallet|i[’']ll notify you when it lands|waiting to see if their deposit arrived|add money|receive money on celo|you deposited/i;
const PAYMENT_CONTEXT = /confirm card to send|payment receipt|sending \d|confirm below/i;
const SWAP_CONTEXT = /conversion quote|conversion result|converting/i;

export type CheckTopic = 'deposit' | 'payment' | 'swap' | 'unknown';

/**
 * What does a "check" mean right now? Looks at the most recent assistant messages (newest first): whichever kind of thing was
 * last on screen is what is being asked about.
 */
export function checkTopic(messages: readonly TurnMessage[]): CheckTopic {
  const recent = messages.filter((m) => m.role === 'assistant').slice(-4).reverse();
  for (const m of recent) {
    if (DEPOSIT_CONTEXT.test(m.content)) return 'deposit';
    if (SWAP_CONTEXT.test(m.content)) return 'swap';
    if (PAYMENT_CONTEXT.test(m.content)) return 'payment';
  }
  return 'unknown';
}

/** The whole decision: is the latest message a "check", and if so, about what? */
export function whatToCheck(messages: readonly TurnMessage[]): CheckTopic | null {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user' || !isCheckRequest(last.content)) return null;
  // Mentioning a seller, a person or an account is a vendor check, not "did it arrive".
  if (/\b(seller|vendor|legit|scam|trust\w*|safe|reliable|account|profile|@\w)/i.test(last.content)) return null;
  return checkTopic(messages.slice(0, -1));
}
