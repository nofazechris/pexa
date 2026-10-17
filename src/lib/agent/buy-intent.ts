/**
 * Deterministic routing for requests the agent must answer from Buy's marketplace. Small models
 * under-use tools (they chat, or mistake "X" for a username), so for requests that are plainly about live
 * social data, flights, a browser, cloud compute, or "what can I buy", the first step of the turn is
 * forced to search the catalog. Searching is free and moves no money; any purchase still goes through the
 * price + approval/policy path. Pure, so it's testable.
 */

const PLATFORM = /\b(reddit|subreddits?|tweets?|tweeting|twitter|instagram|insta|tiktok|youtube|linkedin|flights?)\b/i;
const X_PHRASES = /\b(?:on|from|in|at|via) x\b|\bx(?:\/twitter| posts?| search)\b/i;
const OTHER = /\b(what can i buy|buy marketplace|(?:on|from|in|with|using) buy\b|browser session|rent a browser|run (?:a|this|my) (?:script|code|command)|cloud (?:vm|computer|compute)|virtual machine|spin up a (?:vm|server))\b/i;
const CROWD = /\bpeople (?:are )?(?:saying|tweeting|posting|talking)\b/i;

const AFFIRMATION = /^(?:yes|yeah|yep|yup|y|ok|okay|sure|please|please do|do it|go ahead|go on|sounds good|yes please|sure thing)\W*$/i;

export type TurnMessage = { role: 'user' | 'assistant'; content: string };

const FIND_VERB = /\b(find|finding|looking for|look for|searching for|search for|recommend|suggest|who sells|who can|where (?:can|do) i (?:buy|get)|i need|i want|need a|get me|best)\b/i;
const FIND_NOUN = /\b(vendors?|sellers?|plugs?|shops?|stores?|suppliers?|dealers?|merchants?|tailors?|seamstress(?:es)?|designers?|developers?|programmers?|photographers?|videographers?|freelancers?|braiders?|hair ?stylists?|barbers?|make-?up artists?|caterers?|accountants?|marketers?|editors?|writers?|plumbers?|electricians?|mechanics?|hire|someone to)\b/i;
const NEAR_ME = /\b(near me|nearby|near by|close to me|closest to me|closest|nearest|around me|in my area|near my)\b/i;
const ABOUT_ONE_ACCOUNT = /\b(legit|scam|scammer|safe|trust|real or fake|fake)\b|@\w/i;

/**
 * "Find me a sneaker vendor in Lagos", "I need a graphic designer": discovery, which the agent answers with the research
 * plan — not by searching the catalog for a service, and not the "is @x legit?" check on one named account.
 */
export function isFindRequest(text: string): boolean {
  if (ABOUT_ONE_ACCOUNT.test(text)) return false;
  // "designer near me" has no verb, but a service or seller plus "near me" is still a request to find one.
  return /\bwho sells\b/i.test(text) || ((FIND_VERB.test(text) || NEAR_ME.test(text)) && FIND_NOUN.test(text));
}

export function isBuyIntent(text: string): boolean {
  return PLATFORM.test(text) || X_PHRASES.test(text) || OTHER.test(text) || (CROWD.test(text) && /\b(x|twitter|reddit|online|social)\b/i.test(text));
}

/**
 * Should this turn open by searching Buy's catalog? True when the latest user message is a Buy request,
 * or a bare "yes" that accepts the assistant's own question about one.
 */
export function shouldForceBuySearch(messages: readonly TurnMessage[]): boolean {
  const users = messages.filter((m) => m.role === 'user');
  const last = users[users.length - 1]?.content?.trim() ?? '';
  if (!last) return false;
  if (isFindRequest(last)) return false; // the agent plans a research instead of searching the catalog
  if (isBuyIntent(last)) return true;
  if (AFFIRMATION.test(last)) {
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')?.content ?? '';
    const before = users[users.length - 2]?.content ?? '';
    return /\?\s*$/.test(lastAssistant.trim()) && isBuyIntent(before);
  }
  return false;
}

const SOCIAL_WORDS = /\b(instagram|insta|tiktok|twitter|x|youtube|linkedin|reddit|ig)\b/i;
const TRUST_WORDS = /\b(legit|scam|scammer|safe|trust|trustworthy|real or fake|fake|before i pay|vendor|seller)\b/i;

/**
 * "Check the Instagram account @lagos_kicks before I pay: is it legit?" — a @handle next to a social network or a trust question
 * is a social account, not a Pexa user. On such a turn the people-lookup tools are taken away, so the model can't answer "no one
 * called that on Pexa".
 */
export function isSocialAccountCheck(text: string): boolean {
  if (!/@[\w.]{2,}/.test(text)) return false;
  if (/\b(send|transfer|request|invoice)\b/i.test(text)) return false;
  return SOCIAL_WORDS.test(text) || TRUST_WORDS.test(text);
}

const PAY_WORDS = /\b(pay|paying|send (?:them )?(?:the )?money|transfer|settle up|checkout|check out|buy (?:it|this|from))\b/i;
const VENDOR_WORDS = /\b(vendor|seller|plug|shop|store|supplier|designer|tailor|photographer|him|her|them|this one|that one|the first|the second|the top|number \d|option \d)\b/i;

/** The reply when someone asks Pexa to pay a vendor from a shortlist: Pexa researches; the person pays outside Pexa. */
export const VENDOR_PAY_REPLY =
  'I can’t pay vendors for you — Pexa is your research agent: it finds sellers, compares what they charge, rates them and helps you negotiate, so you decide before spending your own money. When you’re ready, deal with the seller directly. I can still help you pick, write the message, or check one of them more closely.';

/**
 * "ok pay this vendor for me" right after a shortlist: a request to pay someone from the results. Pexa doesn't do that — it only
 * researches. An explicit @username or wallet address means a normal send between people, which is not what this is about.
 */
export function isVendorPaymentRequest(messages: readonly TurnMessage[]): boolean {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user') return false;
  if (!PAY_WORDS.test(last.content) || !VENDOR_WORDS.test(last.content)) return false;
  if (/@\w{2,}|0x[0-9a-fA-F]{6,}/.test(last.content)) return false;
  return messages.slice(-8, -1).some((m) => m.role === 'assistant' && /\[Showed a (?:vendor|hiring) shortlist/i.test(m.content));
}

const ASKS_PLACE = /\b(city|area|neighbou?rhood|location|which (?:part|town|state)|where (?:are you|should|do you|in))\b/i;

/**
 * Should the reply to a "find me a vendor / someone to hire" request carry a "Use my location" button? True when the agent is asking
 * where, and the person's recent message was a find request. The button shares only an area name, never coordinates.
 */
export function shouldOfferLocation(messages: readonly TurnMessage[], reply: string): boolean {
  if (!reply.includes('?') || !ASKS_PLACE.test(reply)) return false;
  return messages
    .filter((m) => m.role === 'user')
    .slice(-2)
    .some((m) => isFindRequest(m.content));
}

/**
 * Is this conversation about Buy? Looks at the last few messages (so "yes", "their instagram is @x" and the
 * hidden "I approved the purchase" follow-up all count) — these turns use a stronger model, because Buy
 * flows chain several tool calls and small models stop to chat instead.
 */
export function isBuyConversation(messages: readonly TurnMessage[]): boolean {
  const recent = messages.slice(-6);
  if (recent.some((m) => isBuyIntent(m.content) || (m.role === 'user' && isFindRequest(m.content)) || /\[Showed a (?:vendor|hiring) shortlist/i.test(m.content))) return true;
  const last = messages[messages.length - 1]?.content ?? '';
  // Asking about past purchases ("receipt for that", "what did it find") is Buy territory too.
  return /\bapproved the purchase\b/i.test(last) || /\b(receipts?|(?:my|past|previous|last) (?:purchases?|buys?)|what did (?:it|that|you) (?:find|buy|get))\b/i.test(last);
}
