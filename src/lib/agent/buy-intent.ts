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
  if (isBuyIntent(last)) return true;
  if (AFFIRMATION.test(last)) {
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')?.content ?? '';
    const before = users[users.length - 2]?.content ?? '';
    return /\?\s*$/.test(lastAssistant.trim()) && isBuyIntent(before);
  }
  return false;
}

/**
 * Is this conversation about Buy? Looks at the last few messages (so "yes", "their instagram is @x" and the
 * hidden "I approved the purchase" follow-up all count) — these turns use a stronger model, because Buy
 * flows chain several tool calls and small models stop to chat instead.
 */
export function isBuyConversation(messages: readonly TurnMessage[]): boolean {
  const recent = messages.slice(-6);
  if (recent.some((m) => isBuyIntent(m.content))) return true;
  const last = messages[messages.length - 1]?.content ?? '';
  // Asking about past purchases ("receipt for that", "what did it find") is Buy territory too.
  return /\bapproved the purchase\b/i.test(last) || /\b(receipts?|(?:my|past|previous|last) (?:purchases?|buys?)|what did (?:it|that|you) (?:find|buy|get))\b/i.test(last);
}
