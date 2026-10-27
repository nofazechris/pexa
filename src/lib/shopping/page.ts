/**
 * Reading a product page. Most shops describe each product in a standard block (schema.org "Product" with an "Offer") for search
 * engines; that is where the name, price and stock come from, with the page's own price meta tags as a fallback. A page that gives
 * no price gives no price — nothing is guessed. And a web address gets a plain label for what kind of seller it is, going only by
 * the domain: it says nothing about whether the page is honest, so it never says "safe". Pure.
 */

import type { OptionSnap } from './options';

export interface ProductPage {
  name: string | null;
  price: number | null;
  currency: string | null;
  availability: string | null;
  /** The shop's domain, e.g. "apple.com". */
  seller: string;
  url: string;
}

type Json = unknown;
const isObj = (v: Json): v is Record<string, Json> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function priceNumber(v: Json): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : null;
  if (typeof v !== 'string') return null;
  // "1,299.00", "1.299,00", "₦1,200,000", "12,50". A comma is a decimal point only when it is the single comma and 1–2 digits follow
  // it; otherwise commas (and repeated dots) are thousands separators.
  const s = v.replace(/[^\d.,]/g, '');
  if (!s) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  const commas = (s.match(/,/g) ?? []).length;
  const dots = (s.match(/\./g) ?? []).length;
  let normal: string;
  if (lastComma > lastDot && commas === 1 && s.length - lastComma - 1 <= 2) normal = s.replace(/\./g, '').replace(',', '.');
  else if (dots > 1 && commas === 0) normal = s.replace(/\./g, '');
  else normal = s.replace(/,/g, '');
  const n = Number(normal);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function* walk(node: Json, depth = 0): Generator<Record<string, Json>> {
  if (depth > 6) return;
  if (Array.isArray(node)) {
    for (const x of node) yield* walk(x, depth + 1);
  } else if (isObj(node)) {
    yield node;
    for (const v of Object.values(node)) if (typeof v === 'object') yield* walk(v, depth + 1);
  }
}

const isProduct = (o: Record<string, Json>) => {
  const t = o['@type'];
  return t === 'Product' || (Array.isArray(t) && t.includes('Product'));
};

function offerOf(product: Record<string, Json>): { price: number | null; currency: string | null; availability: string | null } {
  for (const o of walk(product.offers)) {
    const price = priceNumber(o.price) ?? priceNumber(o.lowPrice);
    if (price !== null) {
      const avail = typeof o.availability === 'string' ? o.availability.replace(/^https?:\/\/schema\.org\//i, '') : null;
      return { price, currency: typeof o.priceCurrency === 'string' ? o.priceCurrency.toUpperCase() : null, availability: avail };
    }
  }
  return { price: null, currency: null, availability: null };
}

const meta = (html: string, name: string): string | null => {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`, 'i');
  const m = html.match(re);
  return m ? (m[1] ?? m[2] ?? null) : null;
};

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

export function sellerDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

export function readProductPage(html: string, url: string): ProductPage | null {
  const seller = sellerDomain(url);
  if (!seller) return null;
  let name: string | null = null;
  let offer: ReturnType<typeof offerOf> = { price: null, currency: null, availability: null };

  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: Json;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    for (const o of walk(data)) {
      if (!isProduct(o)) continue;
      const got = offerOf(o);
      if (got.price !== null) {
        offer = got;
        name = typeof o.name === 'string' ? decode(o.name) : name;
        break;
      }
      if (!name && typeof o.name === 'string') name = decode(o.name);
    }
    if (offer.price !== null) break;
  }

  if (offer.price === null) {
    const amount = meta(html, 'product:price:amount') ?? meta(html, 'og:price:amount');
    const price = amount ? priceNumber(amount) : null;
    if (price !== null) offer = { price, currency: (meta(html, 'product:price:currency') ?? meta(html, 'og:price:currency') ?? '').toUpperCase() || null, availability: null };
  }
  if (!name) {
    const og = meta(html, 'og:title');
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    name = og ? decode(og) : title ? decode(title).slice(0, 140) : null;
  }
  if (offer.price === null && !name) return null;
  return { name: name ? name.slice(0, 160) : null, price: offer.price, currency: offer.currency, availability: offer.availability, seller, url };
}

// ---- what kind of seller is a domain ----

export type SellerKind = 'official' | 'retailer' | 'unknown';

const OFFICIAL = ['apple.com', 'samsung.com', 'dell.com', 'hp.com', 'lenovo.com', 'microsoft.com', 'sony.com', 'xiaomi.com', 'mi.com', 'huawei.com', 'oppo.com', 'oneplus.com', 'google.com', 'asus.com', 'acer.com', 'nintendo.com', 'playstation.com', 'nike.com', 'adidas.com', 'tecno-mobile.com', 'infinixmobility.com', 'itel-life.com'];
const RETAILER = [/^amazon\.[a-z.]+$/, /^jumia\.[a-z.]+$/, /^konga\.com$/, /^ebay\.[a-z.]+$/, /^aliexpress\.com$/, /^walmart\.com$/, /^bestbuy\.com$/, /^target\.com$/, /^currys\.co\.uk$/, /^argos\.co\.uk$/, /^noon\.com$/, /^takealot\.com$/];

const isOrSubdomain = (host: string, d: string) => host === d || host.endsWith('.' + d);

export function sellerKind(domain: string): SellerKind {
  const d = domain.toLowerCase();
  if (OFFICIAL.some((o) => isOrSubdomain(d, o))) return 'official';
  const bare = d.replace(/^(?:www|m|shop|store|smile)\./, '');
  if (RETAILER.some((r) => r.test(bare))) return 'retailer';
  return 'unknown';
}

export const SELLER_LABEL: Record<SellerKind, string> = {
  official: 'Official brand store',
  retailer: 'Major retailer',
  unknown: 'Unverified web store',
};

export const SELLER_NOTE: Record<SellerKind, string> = {
  official: 'Go by the exact address; copycat sites look the same.',
  retailer: 'A large marketplace can still list third-party sellers: check who is actually selling it.',
  unknown: 'I can only read the price. Check reviews, the return policy and how they take payment before you pay.',
};

/** The shopping-list option for a product page that was read (by plain fetch or in a rented browser). */
export function optionFromPage(page: ProductPage, at: Date, how: string | null = null): OptionSnap {
  const kind = sellerKind(page.seller);
  return {
    source: 'web',
    name: page.name ?? page.seller,
    handle: null,
    url: page.url,
    rating: null,
    label: SELLER_LABEL[kind],
    distanceKm: null,
    price: page.price === null ? null : { text: `${page.currency ?? ''} ${page.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}`.trim(), median: page.price, currency: page.currency ?? '' },
    phone: null,
    whatsapp: null,
    note: `${page.seller}: ${SELLER_NOTE[kind]}${page.availability ? ` (${page.availability})` : ''}${how ? ` ${how}` : ''}`,
    checkedAt: at.toISOString(),
  };
}
