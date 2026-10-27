import { describe, expect, it } from 'vitest';
import { PLACES_FIELD_MASK, PLACES_ID, PLACES_URL, badInput, buildPlacesCapability, fixedHeaders } from '@/lib/buy/catalog';
import { ALLOWED_SERVICES, SERVICE, capFor, decideNext, describePlan, freshForMs } from '@/lib/research/engine';
import type { ResearchRequest } from '@/lib/research/types';
import { askStorePlace, parseShoppingIntent, storesText } from './intent';
import { arrange, withStores, withWebOption, type OptionSnap } from './options';
import { productTitle, titleFromUrl } from './page';
import { highlightsOf, parsePlaces, placesBody, rankStores, reviewLabel, storeOptions } from './stores';

// The shape Google Places (New) text search returns, as Buy passes it through.
const GOOGLE = {
  places: [
    { id: 'ChIJ-far', displayName: { text: 'Mega Gadgets Ikeja', languageCode: 'en' }, formattedAddress: '12 Allen Ave, Ikeja, Lagos', location: { latitude: 6.6018, longitude: 3.3515 }, rating: 4.7, userRatingCount: 812, nationalPhoneNumber: '0802 000 1111', websiteUri: 'https://megagadgets.example/', googleMapsUri: 'https://maps.google.com/?cid=1', businessStatus: 'OPERATIONAL', regularOpeningHours: { openNow: true }, types: ['electronics_store', 'store'] },
    { id: 'ChIJ-near', displayName: { text: 'Yaba Phone Hub' }, formattedAddress: '5 Herbert Macaulay Way, Yaba, Lagos', location: { latitude: 6.5101, longitude: 3.3719 }, rating: 4.1, userRatingCount: 64, internationalPhoneNumber: '+234 803 222 3333', googleMapsUri: 'https://maps.google.com/?cid=2', businessStatus: 'OPERATIONAL', regularOpeningHours: { openNow: false } },
    { id: 'ChIJ-bad', displayName: { text: 'Sketchy Deals' }, formattedAddress: 'Somewhere, Lagos', location: { latitude: 6.511, longitude: 3.373 }, rating: 2.4, userRatingCount: 31, businessStatus: 'OPERATIONAL' },
    { id: 'ChIJ-gone', displayName: { text: 'Old Shop' }, location: { latitude: 6.5095, longitude: 3.3711 }, rating: 4.9, userRatingCount: 300, businessStatus: 'CLOSED_PERMANENTLY' },
    { id: 'x', formattedAddress: 'a place with no name' },
    { id: 'ChIJ-evil', displayName: { text: 'Link Test' }, websiteUri: 'javascript:alert(1)', googleMapsUri: 'https://user:pw@maps.example/', location: { latitude: 999, longitude: 3 }, businessStatus: 'OPERATIONAL' },
  ],
};
const YABA = { lat: 6.5095, lon: 3.3711 };

describe('asking Google Places', () => {
  it('builds a plain, valid text query', () => {
    expect(placesBody('MacBook Air', 'Lagos')).toEqual({ textQuery: 'MacBook Air store in Lagos', maxResultCount: 8 });
    expect(placesBody('phone shop', 'Yaba, Lagos').textQuery).toBe('phone shop in Yaba, Lagos');
    expect(placesBody('sofa', '').textQuery).toBe('sofa store');
    expect(placesBody('x'.repeat(500), 'y'.repeat(500)).textQuery.length).toBeLessThanOrEqual(200);
    expect(placesBody('sofa', 'Lagos', 99).maxResultCount).toBe(10);
  });
  it('every body we build passes the check that guards the (non-refundable) payment', () => {
    for (const [what, place] of [['MacBook Air', 'Lagos'], ['organic honey', 'Nairobi'], ['wedding dress', ''], ['x'.repeat(300), 'y'.repeat(300)]]) expect(badInput(PLACES_ID, placesBody(what, place))).toBeNull();
  });
  it('a body Google would reject is stopped before it can be paid for', () => {
    expect(badInput(PLACES_ID, {})).toMatch(/search text/);
    expect(badInput(PLACES_ID, { textQuery: 'a' })).toMatch(/search text/);
    expect(badInput(PLACES_ID, { textQuery: 'phones', maxResultCount: 50 })).toMatch(/1 to 10/);
    expect(badInput(PLACES_ID, { textQuery: 'phones', evil: 1 })).toMatch(/doesn’t take/);
    expect(badInput('x.posts.search', {})).toBeNull();
  });
  it('is a Buy provider route with the field mask fixed, never taken from outside', () => {
    const cap = buildPlacesCapability();
    expect(cap).toMatchObject({ id: PLACES_ID, url: PLACES_URL, method: 'POST', source: 'provider' });
    expect(cap.pricing.options[0].atomic).toBe('40000');
    expect(new URL(PLACES_URL).hostname).toBe('usebuy.ai');
    expect(fixedHeaders(PLACES_ID)['X-Goog-FieldMask']).toBe(PLACES_FIELD_MASK);
    expect(PLACES_FIELD_MASK).toMatch(/places\.id.*places\.displayName.*places\.userRatingCount/);
    expect(fixedHeaders('x.posts.search')).toEqual({});
  });
});

describe('reading what Google returned', () => {
  it('keeps the useful facts and skips what is unusable', () => {
    const hits = parsePlaces(GOOGLE);
    expect(hits.map((h) => h.name)).toEqual(['Mega Gadgets Ikeja', 'Yaba Phone Hub', 'Sketchy Deals', 'Old Shop', 'Link Test']);
    expect(hits[0]).toMatchObject({ rating: 4.7, reviews: 812, phone: '0802 000 1111', website: 'https://megagadgets.example/', openNow: true, point: { lat: 6.6018, lon: 3.3515 } });
    expect(hits[1]).toMatchObject({ phone: '+234 803 222 3333', openNow: false, website: null });
  });
  it('shows only ordinary web links and real coordinates', () => {
    const evil = parsePlaces(GOOGLE).find((h) => h.name === 'Link Test');
    expect(evil).toMatchObject({ website: null, mapsUrl: null, point: null });
  });
  it('finds the list inside a wrapper or a JSON string, and survives rubbish', () => {
    expect(parsePlaces({ output: GOOGLE })).toHaveLength(5);
    expect(parsePlaces(JSON.stringify(GOOGLE))).toHaveLength(5);
    expect(parsePlaces(null)).toEqual([]);
    expect(parsePlaces('not json')).toEqual([]);
    expect(parsePlaces({ places: 'nope' })).toEqual([]);
  });
});

describe('ranking and judging stores', () => {
  it('review labels are plain and need enough reviews to mean anything', () => {
    expect(reviewLabel(4.7, 812)).toBe('Well reviewed');
    expect(reviewLabel(4.1, 64)).toBe('Good reviews');
    expect(reviewLabel(4.9, 3)).toBe('Few reviews');
    expect(reviewLabel(2.4, 31)).toBe('Poorly reviewed');
    expect(reviewLabel(3.8, 200)).toBe('Mixed reviews');
    expect(reviewLabel(null, 0)).toBe('No reviews yet');
  });
  it('drops what closed for good, puts the nearest first and the poorly reviewed last', () => {
    const r = rankStores(parsePlaces(GOOGLE), YABA);
    expect(r.map((s) => s.name)).toEqual(['Yaba Phone Hub', 'Mega Gadgets Ikeja', 'Link Test', 'Sketchy Deals']);
    expect(r[0].distanceKm).toBeLessThan(0.5);
    expect(r[1].distanceKm).toBeGreaterThan(10);
    expect(r[3].label).toBe('Poorly reviewed');
  });
  it('keeps Google’s own order when it can’t measure distance', () => {
    const r = rankStores(parsePlaces(GOOGLE), null);
    expect(r.map((s) => s.name).slice(0, 2)).toEqual(['Mega Gadgets Ikeja', 'Yaba Phone Hub']);
    expect(r.every((s) => s.distanceKm === null)).toBe(true);
  });
  it('says the facts first and picks nothing', () => {
    const lines = highlightsOf(rankStores(parsePlaces(GOOGLE), YABA));
    expect(lines[0]).toMatch(/^Closest: Yaba Phone Hub, under 1 km away/);
    expect(lines[1]).toMatch(/^Best reviewed: Mega Gadgets Ikeja, 4\.7★ from 812 reviews/);
    expect(lines.join(' ')).not.toMatch(/\b(best choice|you should|buy from)\b/i);
  });
  it('becomes shopping-list options with a call, directions and a note', () => {
    const o = storeOptions(rankStores(parsePlaces(GOOGLE), YABA), new Date('2026-10-27T12:00:00Z'));
    expect(o).toHaveLength(4);
    expect(o[0]).toMatchObject({ source: 'store', name: 'Yaba Phone Hub', phone: '+234 803 222 3333', mapsUrl: 'https://maps.google.com/?cid=2', label: 'Good reviews', price: null, rating: null });
    expect(o[0].note).toMatch(/4\.1★ from 64 Google reviews · closed right now · 5 Herbert Macaulay Way/);
  });
});

const snap = (source: OptionSnap['source'], name: string, url: string | null = null): OptionSnap => ({ source, name, handle: null, url, rating: null, label: 'x', distanceKm: null, price: null, phone: null, whatsapp: null, note: null, checkedAt: '2026-10-27T12:00:00Z' });

describe('keeping stores, sellers and pages together on one list', () => {
  it('orders sellers, then stores, then pages', () => {
    const l = arrange([snap('web', 'P', 'https://p'), snap('store', 'S'), snap('instagram', 'I')]);
    expect(l.map((o) => o.source)).toEqual(['instagram', 'store', 'web']);
  });
  it('a new store search replaces only the stores', () => {
    const list = [snap('instagram', 'I'), snap('store', 'Old'), snap('web', 'P', 'https://p')];
    expect(withStores(list, [snap('store', 'New')]).map((o) => o.name)).toEqual(['I', 'New', 'P']);
  });
  it('adding a page keeps the stores', () => {
    const list = withWebOption([snap('store', 'S'), snap('instagram', 'I')], snap('web', 'P', 'https://p'));
    expect(list.map((o) => o.name)).toEqual(['I', 'S', 'P']);
  });
  it('each kind stays short', () => {
    const many = [...Array(8)].map((_, i) => snap('store', `S${i}`));
    expect(arrange(many)).toHaveLength(4);
  });
});

describe('asking for stores in plain words', () => {
  it('the card button', () => {
    expect(parseShoppingIntent(storesText('PS5'))).toEqual({ kind: 'stores', title: 'PS5' });
  });
  it('"where can I buy…"', () => {
    expect(parseShoppingIntent('where can I buy a PS5 near me')).toEqual({ kind: 'stores_ask', title: 'PS5', place: null });
    expect(parseShoppingIntent('Where can I buy organic honey in Nairobi?')).toEqual({ kind: 'stores_ask', title: 'organic honey', place: 'Nairobi' });
    expect(parseShoppingIntent('where can i get a wedding dress')).toMatchObject({ kind: 'stores_ask', title: 'wedding dress' });
  });
  it('"the nearest … shop"', () => {
    expect(parseShoppingIntent('find the nearest phone shop')).toMatchObject({ kind: 'stores_ask', title: 'phone' });
    expect(parseShoppingIntent('closest bike dealer in Accra')).toMatchObject({ kind: 'stores_ask', title: 'bike', place: 'Accra' });
  });
  it('the answer to “which city” goes to the store search', () => {
    expect(parseShoppingIntent('Yaba, Lagos', askStorePlace('PS5'))).toEqual({ kind: 'stores_place', title: 'PS5', place: 'Yaba, Lagos' });
  });
  it('money talk is still money talk', () => {
    expect(parseShoppingIntent('where can I buy USDC')).toEqual({ kind: 'none' });
    expect(parseShoppingIntent('where can I buy bitcoin in Lagos')).toEqual({ kind: 'none' });
  });
});

describe('a product link on its own', () => {
  it('is a product to track', () => {
    expect(parseShoppingIntent('https://www.apple.com/shop/buy-mac/macbook-air')).toEqual({ kind: 'product_link', url: 'https://www.apple.com/shop/buy-mac/macbook-air' });
    expect(parseShoppingIntent('track this https://www.jumia.com.ng/some-phone.html')).toMatchObject({ kind: 'product_link' });
    expect(parseShoppingIntent('www.konga.com/product/tv')).toMatchObject({ kind: 'product_link' });
  });
  it('social, chain and code links are not products', () => {
    for (const u of ['https://x.com/someone/status/1', 'https://www.instagram.com/p/abc', 'https://celoscan.io/tx/0xabc', 'https://github.com/a/b', 'https://wa.me/234801']) expect(parseShoppingIntent(u)).toEqual({ kind: 'none' });
  });
  it('a sentence that merely contains a link is left to the conversation', () => {
    expect(parseShoppingIntent('what do you think of https://www.apple.com/shop/buy-mac/macbook-air ?')).toEqual({ kind: 'none' });
  });
  it('names the product from the page, or from the address when the page can’t be read', () => {
    expect(productTitle('Apple MacBook Air 13-inch Laptop - Space Grey | Amazon.com')).toBe('Apple MacBook Air 13-inch Laptop - Space Grey');
    expect(productTitle('Buy iPhone 15 | Apple (NG)')).toBe('iPhone 15');
    expect(productTitle('x '.repeat(80)).length).toBeLessThanOrEqual(80);
    expect(titleFromUrl('https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html')).toBe('A light in the attic');
    expect(titleFromUrl('https://www.jumia.com.ng/samsung-galaxy-s24-ultra-256gb-12345678.html')).toBe('Samsung galaxy s24 ultra 256gb');
    expect(titleFromUrl('https://shop.example.com/')).toBe('shop.example.com');
  });
});

describe('the store-search plan', () => {
  const req: ResearchRequest = { kind: 'stores', platforms: [], what: 'PS5', place: 'Lagos', itemId: 'i1' };
  it('is one small, allow-listed purchase that may be reused for half a day', () => {
    expect(ALLOWED_SERVICES.has(SERVICE.places)).toBe(true);
    expect(capFor(req)).toBe(50_000n);
    expect(freshForMs(SERVICE.places)).toBe(12 * 3600_000);
    const plan = describePlan(req);
    expect(plan.title).toMatch(/PS5.*Lagos/);
    expect(plan.steps.join(' ')).toMatch(/nothing is bought, and nothing is paid to a store/);
    expect(plan.estimate).toBe('$0.04');
  });
  it('buys one Places search, then stops', () => {
    expect(decideNext(req, [])).toMatchObject({ action: 'buy', role: 'places', capabilityId: 'google.places.search', input: { textQuery: 'PS5 store in Lagos', maxResultCount: 8 } });
    expect(decideNext(req, [{ role: 'places', ref: null, outcome: 'PAID', priceAtomic: 40_000n }])).toEqual({ action: 'finish', reason: 'done' });
    expect(decideNext(req, [{ role: 'places', ref: null, outcome: 'FAILED', priceAtomic: 0n }])).toEqual({ action: 'finish', reason: 'search_failed' });
    expect(decideNext(req, [{ role: 'places', ref: null, outcome: 'UNCERTAIN', priceAtomic: 40_000n }])).toEqual({ action: 'finish', reason: 'uncertain' });
  });
});
