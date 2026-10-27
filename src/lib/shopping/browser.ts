import { isAllowedBuyUrl } from '@/lib/buy/x402';
import { priceNumber, type ProductPage } from './page';

/**
 * Reading a product page in a browser Pexa rents from Buy (`browser.sessions.create`, a few thousandths of a dollar for a couple of
 * minutes). The page is only ever LOOKED AT: whatever it says is data — the browser marks it as untrusted and so do we — and the only
 * things taken from it are a name, a price and an availability phrase, found by fixed rules. Nothing a web page writes is passed to
 * the model, followed as an instruction, or typed into a form. Pure: the network half is browser-run.ts.
 */

/** How long a session is rented for. Opening one page and reading it takes seconds; a slow shop still fits. */
export const BROWSER_MINUTES = 2;

export interface BrowserSession {
  sessionId: string;
  accessToken: string;
  commandUrl: string;
  statusUrl: string;
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** The session out of what the paid purchase returned. Both addresses must be Buy's own and belong to that one session. */
export function sessionFrom(output: unknown): BrowserSession | null {
  const root = rec(output);
  const b = rec(root.browser ?? root);
  const { sessionId, accessToken, commandUrl, statusUrl } = b;
  if (typeof sessionId !== 'string' || !/^[0-9a-f]{8,64}$/i.test(sessionId)) return null;
  if (typeof accessToken !== 'string' || accessToken.length < 16 || accessToken.length > 200 || /\s/.test(accessToken)) return null;
  if (typeof commandUrl !== 'string' || typeof statusUrl !== 'string') return null;
  if (!isAllowedBuyUrl(commandUrl) || !isAllowedBuyUrl(statusUrl)) return null;
  if (new URL(statusUrl).pathname !== `/v1/browser/sessions/${sessionId}`) return null;
  if (new URL(commandUrl).pathname !== `/v1/browser/sessions/${sessionId}/commands`) return null;
  return { sessionId, accessToken, commandUrl, statusUrl };
}

// --- commands ---------------------------------------------------------------------------------

export type BrowserCommand = { action: 'open'; url: string } | { action: 'get'; kind: 'url' | 'title' } | { action: 'get'; kind: 'text'; target: string };

export const openPage = (url: string): BrowserCommand => ({ action: 'open', url });
export const getUrl = (): BrowserCommand => ({ action: 'get', kind: 'url' });
export const getTitle = (): BrowserCommand => ({ action: 'get', kind: 'title' });
/** `get text` needs a target (a CSS selector); it errors when the page has none of it. */
export const getText = (target: string): BrowserCommand => ({ action: 'get', kind: 'text', target });

/** Where shops tend to put the price, most specific first; the whole page is the last resort. */
export const PRICE_TARGETS = ['[itemprop="price"]', '[data-testid*="price" i]', '#priceblock_ourprice', '.price', '[class*="price" i]'] as const;

export type CommandResult = { ok: true; origin: string | null; data: Record<string, unknown> } | { ok: false; message: string };

/** What a command answered. Only `data` is used, and its text is capped. `origin` is the page the answer came from. */
export function resultOf(body: unknown): CommandResult {
  const root = rec(body);
  const out = rec(root.output);
  if (out.success !== true || (out.error !== null && out.error !== undefined)) {
    const err = typeof out.error === 'string' ? out.error : typeof root.reason === 'string' ? root.reason : 'the browser could not do that';
    return { ok: false, message: err.slice(0, 160) };
  }
  const data = { ...rec(out.data) };
  delete data.lifecycle;
  const origin = typeof rec(out._boundary).origin === 'string' ? (rec(out._boundary).origin as string) : null;
  return { ok: true, origin: origin && origin !== 'unknown' ? origin : null, data };
}

const MAX_TEXT = 6000;
export const textOf = (r: CommandResult): string | null => (r.ok && typeof r.data.text === 'string' ? r.data.text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT) || null : null);

// --- reading the answers ----------------------------------------------------------------------

const SYMBOL: Record<string, string> = { $: 'USD', 'US$': 'USD', '£': 'GBP', '€': 'EUR', '₦': 'NGN', '₹': 'INR', 'R$': 'BRL', 'A$': 'AUD', 'C$': 'CAD', 'KSh': 'KES', 'GH₵': 'GHS' };
const CODES = 'USD|GBP|EUR|NGN|KES|GHS|ZAR|CAD|AUD|INR|AED|EGP|UGX|TZS|XOF';
const AMOUNT = String.raw`\d{1,3}(?:[,\s]\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?`;
const PRICE = new RegExp(`(?:(US\\$|R\\$|A\\$|C\\$|KSh|GH₵|[$£€₦₹])\\s?(${AMOUNT}))|(?:\\b(${CODES})\\s?(${AMOUNT}))|(?:(${AMOUNT})\\s?(${CODES})\\b)`, 'g');

export interface PriceMention {
  amount: number;
  currency: string;
}

/** Every price written in a piece of text, in order. */
export function pricesIn(text: string): PriceMention[] {
  const out: PriceMention[] = [];
  for (const m of text.matchAll(PRICE)) {
    const currency = m[1] ? SYMBOL[m[1]] : (m[3] ?? m[6]);
    const amount = priceNumber(m[2] ?? m[4] ?? m[5]);
    if (currency && amount !== null && amount > 0) out.push({ amount, currency });
  }
  return out;
}

const AVAILABILITY: [RegExp, string][] = [
  [/\b(?:out of stock|sold out|currently unavailable|temporarily unavailable)\b/i, 'Out of stock'],
  [/\bin stock\b/i, 'In stock'],
  [/\bpre-?order\b/i, 'Pre-order'],
];
export function availabilityIn(text: string): string | null {
  for (const [re, label] of AVAILABILITY) if (re.test(text)) return label;
  return null;
}

/** "MacBook Air 13-inch | Apple (NG)" → "MacBook Air 13-inch". Only a trailing site name is removed. */
export function cleanTitle(t: string): string {
  return t.replace(/\s+/g, ' ').replace(/\s+[|–—-]\s+[^|–—-]{2,40}$/, '').trim().slice(0, 160);
}

export interface Looked {
  /** Where the browser ended up (after any redirect). */
  finalUrl: string;
  title: string | null;
  heading: string | null;
  /** Text of the first price element found, if the page has one. */
  priceText: string | null;
  /** The whole page's text (capped), for the availability phrase and the last-resort price. */
  pageText: string | null;
}

export type PageReading = { ok: true; page: ProductPage; how: string } | { ok: false; message: string };

/** From what the browser saw: the name, the price and whether it is in stock — or an honest "I couldn't tell". */
export function readLooked(l: Looked): PageReading {
  let host: string;
  try {
    host = new URL(l.finalUrl).hostname.replace(/^www\./, '');
  } catch {
    return { ok: false, message: 'The browser opened something that isn’t a normal web page.' };
  }
  const fromElement = l.priceText ? pricesIn(l.priceText)[0] : undefined;
  const onPage = l.pageText ? pricesIn(l.pageText.slice(0, 2500)) : [];
  const price = fromElement ?? onPage[0];
  const name = (l.heading && l.heading.length >= 3 ? l.heading : l.title ? cleanTitle(l.title) : null)?.slice(0, 160) ?? null;
  if (!price) return { ok: false, message: `The browser opened ${host}${name ? ` (“${name.slice(0, 60)}”)` : ''}, but no price showed up on the page. Shops often show it only after you pick a size or colour, or after you sign in.` };
  const how = fromElement
    ? 'Price read from the page’s price label.'
    : new Set(onPage.map((p) => `${p.currency}${p.amount}`)).size > 1
      ? 'This is the first price on the page; the page shows several, so check it is the one you want.'
      : 'Price read from the page.';
  return { ok: true, how, page: { name, price: price.amount, currency: price.currency, availability: l.pageText ? availabilityIn(l.pageText) : null, seller: host, url: l.finalUrl } };
}

/** Did the browser end up on the address we asked for (or a page of the same shop)? A redirect to elsewhere is reported, not hidden. */
export function sameShop(asked: string, final: string): boolean {
  try {
    const a = new URL(asked).hostname.replace(/^www\./, '');
    const b = new URL(final).hostname.replace(/^www\./, '');
    return a === b || a.endsWith('.' + b) || b.endsWith('.' + a);
  } catch {
    return false;
  }
}
