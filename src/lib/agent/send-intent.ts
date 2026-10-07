/**
 * Reading a "send money" conversation the way a person would. Small AI models lose track of an amount said
 * one message ago, or ignore a name given in the same sentence; for something as simple as "send 1 USDC to
 * joyful" that is not acceptable. So the app reads the amount and the recipient from the conversation
 * itself, asks only for what is genuinely missing (never twice), and then shows the Confirm card.
 *
 * Pure and fully tested. It only EXTRACTS; it never moves money — the Confirm card is still the user's tap.
 */

export type TurnMessage = { role: 'user' | 'assistant'; content: string };

export interface SendSlots {
  /** The latest message is a send request, or the answer to a question we asked about one. */
  wantsSend: boolean;
  /** Decimal USDC amount as a string ("1", "2.5"), or null if none was given. */
  amount: string | null;
  /** A username (no @), a UID, or a 0x address; null if none was given. */
  recipient: string | null;
}

const WINDOW = 6;
const SEND_VERB = /\b(send|pay|transfer|give|wire|remit)\b/i;
// Things that look like a send but are something else (other tools handle them).
const NOT_A_PLAIN_SEND = /\b(request|invoice|bill|naira|ngn|bank|withdraw|usdt|swap|convert|vault|save|saving|deposit|fund|buy|sell|recurring|every|schedule|monthly|weekly|daily|each|rule)\b|₦/i;

const ASKED_WHO = /\b(who|which|whom|username|recipient|send (?:it )?to)\b[^?]*\?/i;
const ASKED_HOW_MUCH = /\bhow much\b[^?]*\?|\bwhat amount\b[^?]*\?/i;

const STOPWORDS = new Set([
  'money', 'funds', 'fund', 'usdc', 'usd', 'dollar', 'dollars', 'buck', 'bucks', 'cash', 'payment', 'some', 'the', 'him', 'her', 'them', 'me', 'myself',
  'my', 'it', 'this', 'that', 'someone', 'somebody', 'anyone', 'friend', 'back', 'now', 'today', 'please', 'again', 'same', 'more', 'out', 'over', 'there',
  'first', 'then', 'also', 'just', 'and', 'for', 'from', 'with', 'you', 'yes', 'yeah', 'yep', 'sure', 'okay', 'ok', 'confirm', 'cancel', 'send', 'pay',
]);

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100,
};

const ADDRESS = /\b0x[a-fA-F0-9]{40}\b/;
const UID = /\bPX[A-HJ-NP-Z2-9]{6}\b/i;

function cleanName(raw: string | undefined): string | null {
  if (!raw) return null;
  const n = raw.toLowerCase().replace(/^@+/, '');
  if (STOPWORDS.has(n) || /^\d+$/.test(n)) return null;
  return n;
}

/** The amount stated in one message, if any. Digits ("1", "$5", "2.5 usdc") or a few number words ("one usdc"). */
export function extractAmount(text: string): string | null {
  const digits = /(?<![\w@.#-])\$?\s?(\d{1,9}(?:\.\d{1,6})?)(?![\w.]*\d)(?=\s*(?:usdc|usd|dollars?|bucks?)?\b)/i.exec(text);
  if (digits && !ADDRESS.test(text.slice(Math.max(0, digits.index - 2), digits.index + digits[0].length + 2))) {
    const n = Number(digits[1]);
    if (n > 0) return String(n);
  }
  const word = /\b(one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|hundred)\s+(?:usdc|dollars?|bucks?|usd)\b/i.exec(text);
  if (word) return String(WORD_NUMBERS[word[1].toLowerCase()]);
  if (/\ba\s+(?:dollar|buck)\b/i.test(text)) return '1';
  return null;
}

/** The recipient named in one message, if any: @name, a UID, a 0x address, or "to name" / "pay name". */
export function extractRecipient(text: string): string | null {
  const addr = ADDRESS.exec(text);
  if (addr) return addr[0];
  const uid = UID.exec(text);
  if (uid) return uid[0].toUpperCase();
  const ats = [...text.matchAll(/@([a-z0-9_]{3,20})\b/gi)];
  if (ats.length) return cleanName(ats[ats.length - 1][1]);
  const to = [...text.matchAll(/\bto\s+([a-z0-9_]{3,20})\b/gi)]
    .map((m) => cleanName(m[1]))
    .filter((n): n is string => n !== null);
  if (to.length) return to[to.length - 1];
  const direct = /\b(?:send|pay|transfer|give)\s+([a-z0-9_]{3,20})\b/i.exec(text);
  return cleanName(direct?.[1]);
}

/** A reply that is only a name / UID / address ("joyful", "@joyful", "PX7K2M9Q"). */
function bareRecipient(text: string): string | null {
  const t = text.trim();
  if (ADDRESS.test(t) && t.replace(ADDRESS, '').trim() === '') return ADDRESS.exec(t)![0];
  if (/^PX[A-HJ-NP-Z2-9]{6}$/i.test(t)) return t.toUpperCase();
  const m = /^@?([a-z0-9_]{3,20})[.!]?$/i.exec(t);
  return cleanName(m?.[1]);
}

/** A reply that is only a number / amount ("1", "1 USDC", "$5"). */
function bareAmount(text: string): string | null {
  const t = text.trim();
  if (!/^\$?\s?\d{1,9}(?:\.\d{1,6})?\s*(?:usdc|usd|dollars?|bucks?)?[.!]?$/i.test(t) && !/^(?:one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|hundred)(?:\s+(?:usdc|usd|dollars?|bucks?))?[.!]?$/i.test(t)) return null;
  return extractAmount(t) ?? (WORD_NUMBERS[t.toLowerCase().split(/\s+/)[0]]?.toString() ?? null);
}

// Questions about the past or about people ("who did I pay recently?", "have I paid chris?") look up history;
// they are not instructions to send.
const LOOKUP_WORDS = /\b(recent|recently|history|last time|who did|did i|have i|has he|has she|how much did|what did|show me|list)\b/i;
const QUESTION_START = /^\s*(who|what|when|where|why|which|did|have|has|is|are)\b/i;

function isPlainSend(text: string): boolean {
  return SEND_VERB.test(text) && !NOT_A_PLAIN_SEND.test(text) && !LOOKUP_WORDS.test(text) && !QUESTION_START.test(text);
}

export function parseSendSlots(messages: readonly TurnMessage[]): SendSlots {
  const none: SendSlots = { wantsSend: false, amount: null, recipient: null };
  const window = messages.slice(-WINDOW);
  const lastIdx = window.length - 1;
  if (lastIdx < 0 || window[lastIdx].role !== 'user') return none;

  const last = window[lastIdx].content.trim();
  if (!last) return none;

  // Is the latest message a send request, or the answer to a question we asked about one?
  const prevAssistant = lastIdx >= 1 && window[lastIdx - 1].role === 'assistant' ? window[lastIdx - 1].content : '';
  const answeringWho = ASKED_WHO.test(prevAssistant);
  const answeringHowMuch = ASKED_HOW_MUCH.test(prevAssistant);
  const earlierSendRequest = window.slice(0, lastIdx).some((m) => m.role === 'user' && isPlainSend(m.content));
  const answering = (answeringWho || answeringHowMuch) && (earlierSendRequest || /\bsend\b/i.test(prevAssistant));
  const requestingNow = isPlainSend(last);
  if (!requestingNow && !answering) return none;
  // A fresh message that clearly isn't a plain send (naira, request, savings…) belongs to the other tools.
  if (!answering && NOT_A_PLAIN_SEND.test(last)) return none;

  // Newest first: the latest thing the user said wins ("make it 5" after "send 1").
  let amount: string | null = null;
  let recipient: string | null = null;
  for (let i = lastIdx; i >= 0 && (amount === null || recipient === null); i--) {
    const m = window[i];
    if (m.role !== 'user') continue;
    const before = i >= 1 && window[i - 1].role === 'assistant' ? window[i - 1].content : '';
    if (amount === null) amount = (ASKED_HOW_MUCH.test(before) ? bareAmount(m.content) : null) ?? extractAmount(m.content);
    if (recipient === null) recipient = (ASKED_WHO.test(before) ? bareRecipient(m.content) : null) ?? extractRecipient(m.content);
  }
  // A bare number must not be read as a name or vice versa; and the amount can't also be the recipient.
  if (recipient && /^\d+$/.test(recipient)) recipient = null;
  return { wantsSend: true, amount, recipient };
}

/**
 * Is this conversation about moving or tracking money between people? Those turns chain tools and need to
 * understand "the guy I paid yesterday", so they get the stronger model (the cheap one fumbles them).
 */
export function isMoneyConversation(messages: readonly TurnMessage[]): boolean {
  return messages.slice(-4).some((m) => /\b(send|sending|sent|pay|paid|transfer|request|beneficiar\w*|recents?|contacts?|who did i|usernames?)\b/i.test(m.content));
}

/** Questions the app asks itself; worded so parseSendSlots recognises the next reply as an answer. */
export function askWho(amount: string | null, recents: readonly string[]): string {
  const what = amount ? `${amount} USDC` : 'it';
  const hint = recents.length ? ` Your recent: ${recents.slice(0, 3).map((u) => '@' + u).join(', ')}.` : '';
  return `Who should I send ${what} to? Give me their @username.${hint}`;
}

export function askHowMuch(recipient: string): string {
  return `How much would you like to send to ${recipient.startsWith('0x') ? recipient.slice(0, 8) + '…' : '@' + recipient}?`;
}
