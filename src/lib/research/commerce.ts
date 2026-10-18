/**
 * What it means to "sell" something online, per kind of thing people buy. Searching for "sneakers" must not bring back a sneaker
 * CLEANING service, a charity tweeting about Lagos, or a page with "sneakers" stuffed into its name — so each category says which
 * words mean the product, which words mean something nearby that is NOT the product (cleaning, repair, accessories, training), and
 * what a real selling post looks like (for sale, DM to order, a price, a phone number).
 *
 * Pure.
 */
import { extractPrices, type Currency } from './price';

export type Category = 'footwear' | 'bags' | 'clothing' | 'gadgets' | 'beauty' | 'home' | 'general';

export interface Theme {
  category: Category;
  /** The words that name the product itself, as a regex alternation (no anchors). */
  productWords: string;
  /** Matches the product's words anywhere. */
  product: RegExp;
  /** Matches words that mean something NEARBY, which is not the product (a service, an accessory…). */
  adjacent: RegExp;
  /** Search words for finding sellers: the first is what the person said; the rest are what sellers actually call it. */
  queries: string[];
}

const word = (source: string) => new RegExp(`\\b(?:${source})\\b`, 'i');

/** Things that are never the product, whatever the category: services, lessons, repairs, giveaways, jobs. */
const UNIVERSAL_ADJACENT = 'clean(?:ing|er|ers)?|wash(?:ing)?|laundry|dry ?clean(?:ing)?|restor(?:e|es|ing|ation)|repair(?:s|ing)?|fix(?:ing)?|servicing|training|course|class(?:es)?|tutorial|giveaway|giving away|job|jobs|hiring|vacancy|recruit(?:ing|ment)?';

const make = (category: Category, productWords: string, adjacentWords: string, queries: string[]): Theme => ({ category, productWords, product: word(productWords), adjacent: word(adjacentWords), queries });

const THEMES: Theme[] = [
  make('footwear', 'sneakers?|kicks|shoes?|slides?|slippers?|sandals?|loafers?|heels?|boots?|trainers?|footwear|crocs|jordans?|dunks?|yeezys?|air ?force(?: ?1)?|af1|birkenstock|timberland', `${UNIVERSAL_ADJACENT}|dirty|polish|cobbler|sole ?guards?|crep protect|protector|insoles?|shoe ?care|drop[- ]?off|customi[sz]ing|customi[sz]ation|unyellowing`, ['{what}', '{what} plug']),
  make('bags', 'bags?|handbags?|backpacks?|purses?|totes?|luggage|clutch(?:es)?|wallets?|satchels?|duffel|briefcases?', UNIVERSAL_ADJACENT, ['{what}', '{what} store']),
  make('clothing', "shirts?|tees?|t-?shirts?|tops?|polos?|jeans|trousers?|pants|shorts|dress(?:es)?|gowns?|skirts?|hoodies?|sweaters?|jackets?|suits?|native|ankara|kaftans?|agbada|senator|thrift|okrika|clothes|clothing|outfits?|menswear|men'?s ?wear|ladies ?wear|women'?s ?wear|fashion|joggers?|tracksuits?|jerseys?|caps?|hats?", `${UNIVERSAL_ADJACENT}|tailor(?:ing|s)?|sewing|seamstress|fabric|alteration`, ['{what}', '{what} store']),
  make('gadgets', 'phones?|smartphones?|iphones?|samsung|tecno|infinix|laptops?|macbooks?|notebooks?|tablets?|ipads?|earbuds?|airpods?|headphones?|headsets?|chargers?|power ?banks?|smart ?watch(?:es)?|speakers?|cameras?|consoles?|ps[45]|playstation|xbox|monitors?|keyboards?|gadgets?|electronics?|tvs?|televisions?|routers?|drones?', `${UNIVERSAL_ADJACENT}|unlock(?:ing)?|icloud|software|screen replacement|data recovery|jailbreak|mining`, ['{what}', '{what} store']),
  make('beauty', 'wigs?|hair|perfumes?|fragrances?|body ?sprays?|skincare|skin care|creams?|lotions?|lipsticks?|lip ?gloss|makeup products?|cosmetics|oils?|bundles?|frontals?|closures?', `${UNIVERSAL_ADJACENT}|salon|braiding|braider|stylist|installation|makeup artist|mua|lash tech|nail tech`, ['{what}', '{what} store']),
  make('home', 'furniture|sofas?|couch(?:es)?|beds?|mattress(?:es)?|wardrobes?|tables?|chairs?|fridges?|freezers?|generators?|air ?fryers?|blenders?|microwaves?|cookers?|appliances?|kitchenware|curtains?|rugs?|bedding|inverters?', `${UNIVERSAL_ADJACENT}|installation|fumigation|plumbing|electrician|interior design`, ['{what}', '{what} store']),
];

const FILLER = new Set(['the', 'and', 'for', 'with', 'who', 'sells', 'selling', 'best', 'good', 'new', 'cheap', 'some', 'any', 'buy', 'find']);

/** Words in a request, reduced to stems ("sneakers" → "sneaker") for a loose match. */
const stems = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !FILLER.has(w))
    .map((w) => (w.length > 4 ? w.replace(/(?:es|s)$/, '') : w));

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The theme for what a person is shopping for. Anything unrecognised gets a general one built from their own words. */
export function themeFor(what: string): Theme {
  const t = what.toLowerCase().replace(/[’‘]/g, "'");
  for (const th of THEMES) if (th.product.test(t)) return th;
  const words = stems(what);
  const source = words.length ? words.map(escapeRe).join('|') : 'item';
  return { category: 'general', productWords: source, product: new RegExp(`(?:${source})`, 'i'), adjacent: word(UNIVERSAL_ADJACENT), queries: ['{what}', '{what} store'] };
}

/** The city part of a place ("Yaba, Lagos" → "Lagos"). A neighbourhood narrows a search to almost nothing, so searches use the city. */
export const cityOf = (place: string) => place.split(',').map((p) => p.trim()).filter(Boolean).slice(-1)[0] ?? '';

/** Search keywords: the item as said, then the item as sellers call it — each with the city. */
export function searchKeywords(what: string, place: string, theme: Theme = themeFor(what), kind: 'vendors' | 'hire' = 'vendors'): string[] {
  const city = cityOf(place);
  // People to hire are called by the work they do ("tailor services"), not found under a shop name.
  const queries = kind === 'hire' ? ['{what}', '{what} services'] : theme.queries;
  const out = queries.map((q) => `${q.replace('{what}', what).trim()} ${city}`.trim().slice(0, 100));
  return [...new Set(out)];
}

// --- reading a piece of text (a bio, a caption, a tweet) ---------------------------------------------------

const decode = (s: string) => s.replace(/[’‘]/g, "'").replace(/&amp;/g, '&').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/** Words a real selling post uses. Deliberately narrow: "quality" or "original" appear in plenty of posts that sell nothing. */
const SELLING = /\b(?:hire me|available for (?:hire|work|projects|bookings?)|portfolio|dm for rates|taking (?:orders|clients|bookings)|book(?:ing)?s? (?:open|now)|for sale|on sale|now available|in stock|dm (?:to|for|us|me)|orders? (?:now|today|via|on)|place your orders?|whats ?app|call us|call me|call\/whats ?app|pay on delivery|nationwide|shipping|new arrivals?|restock(?:ed)?|wholesale|retail|pre-?order|prices?|link in bio|slots? available|brand new)\b/i;
const SELL_VERB = /\b(?:we|i|they|store|shop)\b[^.\n]{0,12}\b(?:sell|sells|selling|deal(?:s)? in|stock|stocks|supply|supplies)\b/i;
const PHONE = /(?<![\d,.])\+?\d[\d \t().-]{8,}\d/;

/** Distinct product words of a theme that appear in the text. */
function distinctHits(text: string, th: Theme): number {
  const found = text.toLowerCase().match(new RegExp(th.product.source, 'gi')) ?? [];
  return new Set(found.map((f) => f.toLowerCase())).size;
}

/**
 * Does the text sell a DIFFERENT kind of thing, with the asked-for product only mentioned in passing? "Our Ankara shorts go for ₦5,000,
 * best with a crop top, a shirt and sneakers" mentions sneakers but sells clothes: more of its product words belong to clothing.
 */
export function sellsSomethingElse(text: string, theme: Theme): boolean {
  if (theme.category === 'general') return false;
  const mine = distinctHits(text, theme);
  return THEMES.some((th) => {
    if (th.category === theme.category) return false;
    const other = distinctHits(text, th);
    return other >= 3 && other >= mine * 2;
  });
}

export type PaymentTerms = { podOffered: boolean; upfrontOnly: string | null };

const NO_POD = /\b(?:no (?:payment|pay|pod|p\.o\.d\.?) (?:on|upon) deliver(?:y|ed)?|no pod\b|no p\.o\.d|payment (?:before|first)\b|pay (?:first|before delivery)|full payment (?:before|first|upfront)|upfront payment|no refunds?|no returns?|no exchange)/i;
const POD = /\b(?:pod|p\.o\.d|pay(?:ment)? (?:on|upon|after) delivery)\b/i;

/** Payment terms a seller states. "No payment on delivery" is a classic scam pattern (it may be innocent, but it is a flag); "pay on delivery" is the safer promise. */
export function paymentTerms(raw: string | null | undefined): PaymentTerms {
  const text = (raw ?? '').replace(/\s+/g, ' ');
  const no = NO_POD.exec(text);
  if (no) return { podOffered: false, upfrontOnly: no[0].trim() };
  return { podOffered: POD.test(text), upfrontOnly: null };
}

export type TextKind = 'seller' | 'adjacent' | 'mention' | 'unrelated';

export interface TextRead {
  kind: TextKind;
  /** Plain-words evidence: "says it sells this", "shows a price", "gives a phone number". */
  evidence: string[];
  /** Names the product itself. */
  product: boolean;
  /** Has selling language, a price, or a phone number. */
  selling: boolean;
  /** Names a nearby thing that is not the product (cleaning, repair…). */
  adjacent: boolean;
  /** Sells a different kind of thing and only mentions the product in passing. */
  somethingElse: boolean;
}

/**
 * Is this text someone SELLING the thing asked for? `seller` needs the product plus selling language. A cleaning service, a repair
 * shop or a lesson is `adjacent` even though it names the product — unless the text plainly says they sell it ("we sell sneakers
 * and cleaning kits"). Product words with no selling language are only a `mention` (news, opinion, a charity's post).
 */
export function readText(raw: string | null | undefined, theme: Theme, currency: Currency | null = null): TextRead {
  const text = decode(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!text || text === 'undefined') return { kind: 'unrelated', evidence: [], product: false, selling: false, adjacent: false, somethingElse: false };
  const else_ = sellsSomethingElse(text, theme);
  const product = theme.product.test(text) && !else_;
  const adjacent = theme.adjacent.test(text);
  const prices = extractPrices(text, currency);
  const hasPhone = PHONE.test(text);
  const sellVerb = SELL_VERB.test(text);
  const sellingWords = SELLING.test(text);
  const selling = sellVerb || sellingWords || prices.length > 0 || hasPhone;

  const evidence: string[] = [];
  if (sellVerb) evidence.push('says it sells this');
  else if (sellingWords) evidence.push('uses selling language');
  if (prices.length) evidence.push('shows a price');
  if (hasPhone) evidence.push('gives a phone number');

  // "We sell … sneakers": a direct statement of selling the product, even when a nearby word also appears.
  const sellsProduct = new RegExp(`\\b(?:sell|sells|selling|deal(?:s)? in|stock|stocks|supply|supplies)\\b[^.\\n]{0,80}(?:${theme.productWords})`, 'i').test(text);

  let kind: TextKind;
  if (!product) kind = adjacent ? 'adjacent' : 'unrelated';
  else if (adjacent && !sellsProduct) kind = 'adjacent';
  else kind = selling ? 'seller' : 'mention';
  return { kind, evidence, product, selling, adjacent, somethingElse: else_ };
}
