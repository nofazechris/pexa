/**
 * Prices people publish, and what they add up to. Sellers write prices in captions and bios in many styles — "₦25,000", "#25,000",
 * "N25k", "25k naira", "$40", "Price: 25000" — so this finds those, works out a typical range across sellers, and compares one
 * seller to it. Everything is the seller's own published price in the currency they used; nothing is converted or invented, and a
 * seller with no prices shown simply has none.
 *
 * Pure.
 */

export type Currency = 'NGN' | 'USD' | 'GBP' | 'EUR' | 'KES' | 'GHS' | 'ZAR';

export interface PricePoint {
  amount: number;
  currency: Currency;
}

/** Plausible amounts per currency: anything outside is a phone number, a year, a follower count, or a typo. */
const RANGE: Record<Currency, [number, number]> = {
  NGN: [200, 100_000_000],
  USD: [1, 200_000],
  GBP: [1, 150_000],
  EUR: [1, 150_000],
  KES: [30, 15_000_000],
  GHS: [5, 2_000_000],
  ZAR: [10, 3_000_000],
};

const NUM = '(\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?)\\s?([kKmM])?';
// A currency marker directly before a number: ₦25,000  #25,000  N25k  NGN 25000  $40  £30  €25  KSh 3000  GH₵50  R250
const BEFORE = new RegExp(`(?:^|[^A-Za-z0-9])(₦|NGN|#|N(?=\\s?\\d)|\\$|USD|£|€|KES|KSh|GH₵|GHS|ZAR|R(?=\\s?\\d))\\s?${NUM}`, 'g');
// A currency word after: 25,000 naira · 25k NGN · 40 dollars
const AFTER = new RegExp(`(?:^|[^A-Za-z0-9.,])${NUM}\\s?(naira|ngn|dollars?|usd|cedis?|ghs|shillings?|kes|rand|pounds?|euros?)\\b`, 'gi');
// A price cue then a bare number: "Price: 25000", "only 25,000", "@ 25k", "for 25k"
const CUE = new RegExp(`\\b(?:price|prices|cost|costs|only|now|@|just)\\s*[:\\-]?\\s*${NUM}(?![\\d,.]*\\d)`, 'gi');

const SYMBOL: Record<string, Currency> = { '₦': 'NGN', ngn: 'NGN', '#': 'NGN', n: 'NGN', $: 'USD', usd: 'USD', '£': 'GBP', '€': 'EUR', kes: 'KES', ksh: 'KES', 'gh₵': 'GHS', ghs: 'GHS', zar: 'ZAR', r: 'ZAR' };
const WORD: Record<string, Currency> = { naira: 'NGN', ngn: 'NGN', dollar: 'USD', dollars: 'USD', usd: 'USD', cedi: 'GHS', cedis: 'GHS', ghs: 'GHS', shilling: 'KES', shillings: 'KES', kes: 'KES', rand: 'ZAR', pound: 'GBP', pounds: 'GBP', euro: 'EUR', euros: 'EUR' };

function toNumber(digits: string, suffix: string | undefined): number | null {
  const base = Number(digits.replace(/,/g, ''));
  if (!Number.isFinite(base)) return null;
  const mult = suffix ? (suffix.toLowerCase() === 'k' ? 1e3 : 1e6) : 1;
  return base * mult;
}

/** Default currency for a place, used only for "Price: 25000" with no currency written. */
export function currencyForPlace(place: string): Currency | null {
  const p = place.toLowerCase();
  if (/(lagos|abuja|ibadan|port harcourt|kano|enugu|benin|kaduna|abeokuta|ikeja|yaba|lekki|surulere|nigeria)/.test(p)) return 'NGN';
  if (/(nairobi|mombasa|kisumu|kenya)/.test(p)) return 'KES';
  if (/(accra|kumasi|tema|ghana)/.test(p)) return 'GHS';
  if (/(johannesburg|cape town|durban|pretoria|south africa)/.test(p)) return 'ZAR';
  return null;
}

/** Every price in the text, in order. `fallback` is the currency to assume for a bare "Price: 25000". */
export function extractPrices(text: string | null | undefined, fallback: Currency | null = null): PricePoint[] {
  if (!text) return [];
  const out: PricePoint[] = [];
  const taken: [number, number][] = [];
  const add = (index: number, length: number, amount: number | null, currency: Currency | null) => {
    if (amount === null || !currency) return;
    const [lo, hi] = RANGE[currency];
    if (amount < lo || amount > hi) return;
    if (taken.some(([a, b]) => index < b && index + length > a)) return; // already read by an earlier, stronger pattern
    taken.push([index, index + length]);
    out.push({ amount, currency });
  };
  for (const m of text.matchAll(BEFORE)) add(m.index ?? 0, m[0].length, toNumber(m[2], m[3]), SYMBOL[m[1].toLowerCase()] ?? null);
  for (const m of text.matchAll(AFTER)) add(m.index ?? 0, m[0].length, toNumber(m[1], m[2]), WORD[m[3].toLowerCase()] ?? null);
  if (fallback) for (const m of text.matchAll(CUE)) add(m.index ?? 0, m[0].length, toNumber(m[1], m[2]), fallback);
  return out;
}

export interface PriceSummary {
  currency: Currency;
  low: number;
  median: number;
  high: number;
  /** How many prices it is based on. */
  n: number;
}

const percentile = (sorted: number[], p: number) => {
  if (sorted.length === 1) return sorted[0];
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
};

/** The range and middle of a set of prices, in the currency used most. Null when there are none. */
export function summarize(points: readonly PricePoint[]): PriceSummary | null {
  if (!points.length) return null;
  const count = new Map<Currency, number>();
  for (const p of points) count.set(p.currency, (count.get(p.currency) ?? 0) + 1);
  const currency = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const sorted = points.filter((p) => p.currency === currency).map((p) => p.amount).sort((a, b) => a - b);
  // One outlier (a typo, a bulk price) shouldn't define the range: with enough prices use the 10th–90th percentile.
  const trim = sorted.length >= 8;
  return { currency, low: percentile(sorted, trim ? 0.1 : 0), median: percentile(sorted, 0.5), high: percentile(sorted, trim ? 0.9 : 1), n: sorted.length };
}

const SYMBOLS: Record<Currency, string> = { NGN: '₦', USD: '$', GBP: '£', EUR: '€', KES: 'KSh ', GHS: 'GH₵', ZAR: 'R' };

/** "₦38k", "₦1.2m", "$40", "₦850": short, the way people say prices. */
export function money(amount: number, currency: Currency): string {
  const sym = SYMBOLS[currency];
  const trimmed = (n: number, d: number) => n.toFixed(d).replace(/\.0+$/, '').replace(/(\.\d)0$/, '$1');
  if (amount >= 1_000_000) return `${sym}${trimmed(amount / 1_000_000, 2)}m`;
  if (amount >= 10_000) return `${sym}${trimmed(amount / 1_000, 1)}k`;
  if (amount >= 1_000) return `${sym}${trimmed(amount / 1_000, 2)}k`;
  return `${sym}${Math.round(amount)}`;
}

export const rangeText = (s: PriceSummary) => (s.low === s.high ? money(s.low, s.currency) : `${money(s.low, s.currency)}–${money(s.high, s.currency)}`);

/** Round an offer to a number a person would actually say (₦38,400 → ₦38k, ₦1,180,000 → ₦1.2m). */
export function niceAmount(amount: number): number {
  if (amount >= 1_000_000) return Math.round(amount / 50_000) * 50_000;
  if (amount >= 100_000) return Math.round(amount / 5_000) * 5_000;
  if (amount >= 10_000) return Math.round(amount / 1_000) * 1_000;
  if (amount >= 1_000) return Math.round(amount / 100) * 100;
  return Math.round(amount / 10) * 10 || Math.round(amount);
}

export type PriceVsMarket = { kind: 'below' | 'near' | 'above'; percent: number };

/** How a seller's middle price compares with the typical middle. Null unless both are in the same currency. */
export function versus(seller: PriceSummary, market: PriceSummary): PriceVsMarket | null {
  if (seller.currency !== market.currency || market.median <= 0) return null;
  const percent = Math.round(((seller.median - market.median) / market.median) * 100);
  return { kind: percent <= -8 ? 'below' : percent >= 8 ? 'above' : 'near', percent };
}
