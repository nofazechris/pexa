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
  /** The message asks for several payments at once (two people, or two amounts). Only ever set when true. */
  multiple?: boolean;
}

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

/**
 * Is this assistant message one of OUR send questions ("Who should I send 1 USDC to?", "How much would you
 * like to send to @joyful?")? It must be a question, be about sending, and ask for a person or an amount.
 * A "how much?" about a savings vault or anything else is NOT a send question — that distinction is what
 * keeps an old "send 1 USDC to joyful" from being revived when the user is answering something unrelated.
 */
function isSendQuestion(text: string): boolean {
  return /\?/.test(text) && /\bsend\b/i.test(text) && (ASKED_WHO.test(text) || ASKED_HOW_MUCH.test(text));
}

/** Words that mean "forget it" — they end a send exchange rather than answer it. */
const CANCEL_WORDS = /^\s*(cancel|stop|never ?mind|forget it|no|nope|nah|don'?t|abort)\b/i;

/**
 * The messages that belong to the CURRENT send exchange: the latest user message, plus — only while each
 * assistant message in between is one of our send questions — the earlier user messages it was answering.
 * Anything older, or separated by any other kind of reply, is a different conversation and is never read.
 */
function currentExchange(messages: readonly TurnMessage[]): TurnMessage[] {
  let start = messages.length - 1;
  while (start >= 2 && messages[start - 1].role === 'assistant' && isSendQuestion(messages[start - 1].content) && messages[start - 2].role === 'user') start -= 2;
  return messages.slice(start);
}

export function parseSendSlots(messages: readonly TurnMessage[]): SendSlots {
  const none: SendSlots = { wantsSend: false, amount: null, recipient: null };
  const lastIdx = messages.length - 1;
  if (lastIdx < 0 || messages[lastIdx].role !== 'user') return none;

  const last = messages[lastIdx].content.trim();
  if (!last || CANCEL_WORDS.test(last)) return none;

  const exchange = currentExchange(messages);
  const lastInExchange = exchange.length - 1;
  const prevAssistant = lastInExchange >= 1 && exchange[lastInExchange - 1].role === 'assistant' ? exchange[lastInExchange - 1].content : '';
  const answering = lastInExchange >= 2 && isSendQuestion(prevAssistant);
  const requestingNow = isPlainSend(last);
  if (!requestingNow && !answering) return none;
  // A fresh message that clearly isn't a plain send (naira, request, savings…) belongs to the other tools.
  if (!answering && NOT_A_PLAIN_SEND.test(last)) return none;
  // And a reply that is plainly about something else — savings, a question, a lookup — is not an answer either.
  if (answering && !requestingNow && (NOT_A_PLAIN_SEND.test(last) || LOOKUP_WORDS.test(last) || QUESTION_START.test(last))) return none;

  // Newest first within this exchange: the latest thing the user said wins ("make it 5" after "send 1").
  let amount: string | null = null;
  let recipient: string | null = null;
  let fromLast = false; // did the latest message itself supply something?
  for (let i = lastInExchange; i >= 0 && (amount === null || recipient === null); i--) {
    const m = exchange[i];
    if (m.role !== 'user') continue;
    const before = i >= 1 && exchange[i - 1].role === 'assistant' ? exchange[i - 1].content : '';
    const askedFor = isSendQuestion(before);
    if (amount === null) {
      amount = (askedFor && ASKED_HOW_MUCH.test(before) ? bareAmount(m.content) : null) ?? extractAmount(m.content);
      if (amount !== null && i === lastInExchange) fromLast = true;
    }
    if (recipient === null) {
      recipient = (askedFor && ASKED_WHO.test(before) ? bareRecipient(m.content) : null) ?? extractRecipient(m.content);
      if (recipient !== null && i === lastInExchange) fromLast = true;
    }
  }
  // A bare number must not be read as a name, and the amount can't also be the recipient.
  if (recipient && /^\d+$/.test(recipient)) recipient = null;
  // Answering a question must actually answer it. "what's my balance?" in reply to "how much to send?" is a
  // change of subject, not an answer — hand it back instead of looping the question.
  if (!requestingNow && !fromLast) return none;
  // "1 to @joyful and 2 to @omoefe" is two payments; we do one at a time rather than quietly doing a wrong one.
  if (requestingNow && (distinctRecipients(last).length > 1 || distinctAmounts(last).length > 1)) return { wantsSend: true, amount, recipient, multiple: true };
  return { wantsSend: true, amount, recipient };
}

function distinctRecipients(text: string): string[] {
  const names = new Set<string>();
  for (const m of text.matchAll(/@([a-z0-9_]{3,20})\b/gi)) {
    const n = cleanName(m[1]);
    if (n) names.add(n);
  }
  for (const m of text.matchAll(/\bto\s+([a-z0-9_]{3,20})\b/gi)) {
    const n = cleanName(m[1]);
    if (n) names.add(n);
  }
  // "to joyful and omoefe" / "to joyful, omoefe": a list of people after one "to".
  for (const m of text.matchAll(/\bto\s+@?[a-z0-9_]{3,20}((?:\s*(?:,|and|&)\s*@?[a-z0-9_]{3,20})+)/gi)) {
    for (const part of m[1].split(/\s*(?:,|and|&)\s*/i)) {
      const n = cleanName(part.trim());
      if (n) names.add(n);
    }
  }
  return [...names];
}

/** Amounts that are clearly money ("$5", "2 USDC") — a bare "2 days" in a note is not counted. */
function distinctAmounts(text: string): string[] {
  const found = new Set<string>();
  const clean = text.replace(ADDRESS, ' ');
  for (const m of clean.matchAll(/(?<![\w@.#-])(?:\$\s?(\d{1,9}(?:\.\d{1,6})?)|(\d{1,9}(?:\.\d{1,6})?)\s*(?:usdc|usd|dollars?|bucks?)\b)/gi)) {
    const n = Number(m[1] ?? m[2]);
    if (n > 0) found.add(String(n));
  }
  return [...found];
}

/**
 * Is this conversation about moving or tracking money between people? Those turns chain tools and need to
 * understand "the guy I paid yesterday", so they get the stronger model (the cheap one fumbles them).
 */
export function isMoneyConversation(messages: readonly TurnMessage[]): boolean {
  return messages.slice(-4).some((m) => /\b(send|sending|sent|pay|paid|transfer|request|beneficiar\w*|recents?|contacts?|who did i|usernames?)\b/i.test(m.content));
}

const TYPED_YES = /^\s*(yes|yeah|yep|yup|ok|okay|sure|confirm|do it|go ahead|send it|proceed|approve|please do|yes please)\W*$/i;
const TYPED_NO = /^\s*(no|nope|nah|cancel|cancel that|cancel it|stop|never ?mind|don'?t|abort|forget it)\W*$/i;

/**
 * Money moves only when the user TAPS the card — never because they typed "yes". If a card is waiting
 * ("confirm below" / "approve it below") and the user types a bare yes or no, say what to tap instead of
 * building a second card. Returns the reply, or null when this isn't that situation.
 */
export function replyToTypedAnswer(messages: readonly TurnMessage[]): string | null {
  const n = messages.length;
  if (n < 2 || messages[n - 1].role !== 'user' || messages[n - 2].role !== 'assistant') return null;
  const card = messages[n - 2].content;
  const text = messages[n - 1].content;
  const isPayment = /confirm below/i.test(card);
  const isPurchase = /approve it below/i.test(card);
  if (!isPayment && !isPurchase) return null;
  if (TYPED_YES.test(text)) {
    return isPayment ? 'To send it, tap “Confirm payment” on the card above — I can’t send money from a typed message.' : 'To buy it, tap “Approve & pay” on the card above — I can’t spend from a typed message.';
  }
  if (TYPED_NO.test(text)) return 'Okay — nothing was sent or charged. Tap Cancel on the card to clear it, or tell me what you’d like instead.';
  return null;
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
