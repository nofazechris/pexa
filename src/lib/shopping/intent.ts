/**
 * Reading what someone says about a thing they want to buy — "I want to buy a MacBook Air", "add an iPhone 15 to my shopping list",
 * "find the best options for my MacBook", "I bought the MacBook" — and the short answers to the app's own questions (which city,
 * paste the link). The app reads it itself so the list, the research and the payment step don't depend on a small model's mood.
 * Pure.
 */

export type ShoppingIntent =
  | { kind: 'none' }
  | { kind: 'add'; title: string; targetText: string | null; place: string | null }
  | { kind: 'show' }
  | { kind: 'remove'; title: string }
  | { kind: 'bought'; title: string }
  | { kind: 'research'; title: string }
  | { kind: 'ask_link'; title: string }
  | { kind: 'pay'; seller: string; title: string }
  | { kind: 'place'; title: string; place: string }
  | { kind: 'link'; title: string; url: string }
  | { kind: 'browse'; title: string; url: string };

const QUESTION = {
  place: (title: string) => `Which city should I look in for your ${title}? (Or tap “Use my location”.)`,
  link: (title: string) => `Paste the product link for your ${title} and I’ll read the price from the page.`,
};
export const askPlace = QUESTION.place;
export const askLink = QUESTION.link;
const ASK_PLACE_RE = /Which city should I look in for your (.+?)\? \(Or tap/;
const ASK_LINK_RE = /Paste the product link for your (.+?) and I’ll read the price/;

/** The button texts the cards send. */
export const researchText = (title: string) => `Find the best options for my ${title}`;
export const linkText = (title: string) => `Add a product link for my ${title}`;
export const browseText = (title: string, url: string) => `Read the link for my ${title} in a browser: ${url}`;
export const payText = (seller: string, title: string) => `I’m ready to pay ${seller} for my ${title}`;

const NOT_GOODS = /\b(stocks?|shares?|etfs?|usdc|usdt|usat|cusd|celo|bitcoin|btc|eth|ethereum|crypto|coins?|nft|tokens?)\b/i;
const ADD_LIST = /\b(?:add|put|save)\s+(.+?)\s+(?:to|on|in)\s+my\s+(?:shopping|buy(?:ing)?|wish)\s?list\b/i;
const WANT = /\b(?:i\s+(?:want|need|plan|would like|'d like)\s+to\s+(?:buy|get|purchase)|i(?:'m| am)\s+(?:looking|trying|planning)\s+to\s+(?:buy|get|purchase)|i(?:'m| am)\s+(?:looking for|shopping for)|help me (?:buy|get)|track (?:the )?price(?:s)? of|keep track of (?:the )?price(?:s)? of)\s+(.+)$/i;
const SHOW = /\b(?:my|the)\s+(?:shopping|buy(?:ing)?|wish)\s?list\b|\bwhat am i (?:trying to buy|shopping for)\b/i;
const REMOVE = /\b(?:remove|delete|drop|take)\s+(.+?)\s+(?:from|off)\s+my\s+(?:shopping|buy(?:ing)?|wish)\s?list\b/i;
const BOUGHT = /\bi(?:'ve| have)?\s+(?:bought|got|purchased|ordered)\s+(?:the|my|a|an)?\s*(.+)$/i;
const RESEARCH = /^(?:find|research|look for|search for|get me)\s+the best options for my\s+(.+)$/i;
const LINK_BTN = /^add a product link for my\s+(.+)$/i;
const BROWSE_BTN = /^read the link for my\s+(.+?)\s+in a browser:\s+(\S+)$/i;
const PAY_BTN = /^i[’']m ready to pay\s+(.+?)\s+for my\s+(.+)$/i;

/** "a MacBook Air M3 for under $1,200 in Lagos" → the item, what they'd pay, and where. */
export function splitItem(raw: string): { title: string; targetText: string | null; place: string | null } {
  let s = raw.trim().replace(/[.!?]+$/, '');
  let place: string | null = null;
  const inPlace = s.match(/\s+(?:in|near|around)\s+([A-Z][A-Za-z' -]{2,40}(?:,\s*[A-Z][A-Za-z' -]{2,30})?)$/);
  if (inPlace && !/\b(?:the|my|a)\b/i.test(inPlace[1])) {
    place = inPlace[1].trim();
    s = s.slice(0, inPlace.index).trim();
  }
  let targetText: string | null = null;
  const target = s.match(/\s+(?:for\s+)?(?:under|below|less than|around|about|at most|max(?:imum)?(?: of)?|up to|within)\s+((?:[$₦€£]|ngn|usd|kes|ghs)?\s?\d[\d,.]*\s?(?:k|m|million|thousand|dollars?|naira|usd|ngn)?)$/i);
  if (target) {
    targetText = target[1].trim();
    s = s.slice(0, target.index).trim();
  }
  const title = s.replace(/^(?:a|an|the|some|my)\s+/i, '').replace(/\s+/g, ' ').trim();
  return { title: title.slice(0, 80), targetText, place };
}

const urlIn = (t: string) => t.match(/https?:\/\/[^\s<>"]+|(?:www\.)[a-z0-9-]+\.[a-z]{2,}[^\s<>"]*/i)?.[0] ?? null;

export function parseShoppingIntent(text: string, previousAssistant?: string): ShoppingIntent {
  const t = text.trim();
  const browse = t.length <= 700 ? t.match(BROWSE_BTN) : null;
  if (browse) return { kind: 'browse', title: browse[1].trim(), url: browse[2] };
  if (!t || t.length > 300) return { kind: 'none' };

  // Answers to the app's own questions.
  const askedLink = previousAssistant?.match(ASK_LINK_RE);
  if (askedLink) {
    const url = urlIn(t);
    if (url) return { kind: 'link', title: askedLink[1], url };
  }
  const askedPlace = previousAssistant?.match(ASK_PLACE_RE);
  if (askedPlace && t.length <= 70 && !/\?$/.test(t)) {
    const place = t.replace(/^my area is\s+/i, '').replace(/^(?:in|i['’]m in|i am in|at)\s+/i, '').trim();
    if (place.length >= 2 && !/^(?:no|yes|ok|skip|cancel|never ?mind)$/i.test(place)) return { kind: 'place', title: askedPlace[1], place };
  }

  // The cards' buttons.
  const pay = t.match(PAY_BTN);
  if (pay) return { kind: 'pay', seller: pay[1], title: pay[2] };
  const lb = t.match(LINK_BTN);
  if (lb) return { kind: 'ask_link', title: lb[1].trim() };
  const rs = t.match(RESEARCH);
  if (rs) return { kind: 'research', title: rs[1].trim() };

  if (NOT_GOODS.test(t)) return { kind: 'none' };

  const rm = t.match(REMOVE);
  if (rm) return { kind: 'remove', title: rm[1].trim() };
  const added = t.match(ADD_LIST);
  if (added) return { kind: 'add', ...splitItem(added[1]) };
  if (SHOW.test(t) && !WANT.test(t)) return { kind: 'show' };
  const b = t.match(BOUGHT);
  if (b && /^i(?:'ve| have)?\s+(?:bought|got|purchased|ordered)\b/i.test(t)) return { kind: 'bought', title: b[1].trim() };
  const want = t.match(WANT);
  if (want) {
    const item = splitItem(want[1]);
    if (item.title.length >= 2) return { kind: 'add', ...item };
  }
  return { kind: 'none' };
}
