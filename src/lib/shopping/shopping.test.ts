import { describe, expect, it } from 'vitest';
import { askLink, askPlace, linkText, parseShoppingIntent, payText, researchText, splitItem } from './intent';
import { diffOptions, optionsFromResult, withWebOption, type OptionSnap } from './options';
import { SELLER_LABEL, readProductPage, sellerKind } from './page';
import { checkUrl, isPublicIp } from './ssrf';
import { parseInvestIntent } from '@/lib/agent/invest-intent';
import { parseSwapIntent } from '@/lib/swap/intent';
import { parseWatchIntent } from '@/lib/yield/watch-intent';
import { parseEarnIntent } from '@/lib/earn/intent';
import type { ResearchItem } from '@/lib/research/types';

describe('reading what someone wants to buy', () => {
  it('a want, with the price and the city when they gave them', () => {
    expect(parseShoppingIntent('I want to buy a MacBook Air')).toEqual({ kind: 'add', title: 'MacBook Air', targetText: null, place: null });
    expect(parseShoppingIntent('i want to buy an iPhone 15 under $900 in Lagos')).toEqual({ kind: 'add', title: 'iPhone 15', targetText: '$900', place: 'Lagos' });
    expect(parseShoppingIntent('I need to get a PS5 for around ₦900,000')).toMatchObject({ kind: 'add', title: 'PS5', targetText: '₦900,000' });
    expect(parseShoppingIntent('track the price of a Samsung S24')).toMatchObject({ kind: 'add', title: 'Samsung S24' });
  });
  it('adding to the list', () => {
    expect(parseShoppingIntent('add a MacBook Air M3 to my shopping list')).toMatchObject({ kind: 'add', title: 'MacBook Air M3' });
    expect(parseShoppingIntent('put the iPhone 15 on my wishlist')).toMatchObject({ kind: 'add', title: 'iPhone 15' });
  });
  it('showing, removing and having bought', () => {
    expect(parseShoppingIntent('show my shopping list')).toEqual({ kind: 'show' });
    expect(parseShoppingIntent('what am I trying to buy')).toEqual({ kind: 'show' });
    expect(parseShoppingIntent('remove the iPhone 15 from my shopping list')).toEqual({ kind: 'remove', title: 'the iPhone 15' });
    expect(parseShoppingIntent('I bought the MacBook Air')).toEqual({ kind: 'bought', title: 'MacBook Air' });
  });
  it('splits an item into what, price and place', () => {
    expect(splitItem('a MacBook Air M3 for under $1,200 in Abuja')).toEqual({ title: 'MacBook Air M3', targetText: '$1,200', place: 'Abuja' });
    expect(splitItem('sneakers')).toEqual({ title: 'sneakers', targetText: null, place: null });
  });
  it('the card buttons come back as the same intent that made them', () => {
    expect(parseShoppingIntent(researchText('MacBook Air'))).toEqual({ kind: 'research', title: 'MacBook Air' });
    expect(parseShoppingIntent(linkText('MacBook Air'))).toEqual({ kind: 'ask_link', title: 'MacBook Air' });
    expect(parseShoppingIntent(payText('@lagos_gadgets', 'MacBook Air'))).toEqual({ kind: 'pay', seller: '@lagos_gadgets', title: 'MacBook Air' });
  });
  it('answers to the city and link questions, even with a buttons note between', () => {
    expect(parseShoppingIntent('Yaba, Lagos', askPlace('MacBook Air'))).toEqual({ kind: 'place', title: 'MacBook Air', place: 'Yaba, Lagos' });
    expect(parseShoppingIntent('My area is Yaba, Lagos', askPlace('MacBook Air') + '\n[Showed a button…]')).toMatchObject({ kind: 'place', place: 'Yaba, Lagos' });
    expect(parseShoppingIntent('https://www.apple.com/shop/buy-mac/macbook-air', askLink('MacBook Air'))).toEqual({ kind: 'link', title: 'MacBook Air', url: 'https://www.apple.com/shop/buy-mac/macbook-air' });
    expect(parseShoppingIntent('no idea', askLink('MacBook Air')).kind).toBe('none');
  });
  it('stocks, coins and everyday talk are not shopping', () => {
    for (const t of ['buy me $50 of Tesla stock', 'I want to buy USAT', 'I want to buy some bitcoin', 'buy 5 USDC', 'hello', 'where can I earn on my USDC?', 'what can you do']) {
      expect(parseShoppingIntent(t).kind, t).toBe('none');
    }
  });
  it('never collides with the other flows', () => {
    for (const t of ['I want to buy a MacBook Air', 'add a MacBook to my shopping list', 'show my shopping list']) {
      expect(parseInvestIntent(t).kind, t).toBe('none');
      expect(parseSwapIntent(t).kind, t).toBe('none');
      expect(parseWatchIntent(t).kind, t).toBe('none');
      expect(parseEarnIntent(t).kind, t).toBe('none');
    }
  });
});

const research = (over: Partial<ResearchItem>): ResearchItem => ({
  platform: 'instagram',
  name: 'Lagos Gadgets',
  handle: '@lagos_gadgets',
  url: 'https://instagram.com/lagos_gadgets',
  headline: null,
  verdict: 'solid',
  verdictLabel: 'Established',
  location: null,
  nearness: 'unknown',
  distanceKm: 3,
  contact: { phone: '0801 111 2222', tel: null, whatsapp: 'https://wa.me/2348011112222', email: null, website: null },
  stats: [],
  signals: [],
  checked: true,
  rating: { overall: 84, trust: 90, fit: 80, nearby: 85, price: null },
  prices: { currency: 'NGN', low: 1_100_000, median: 1_150_000, high: 1_200_000, n: 3, points: [], matched: true, text: '₦1.15M', vsMarket: null },
  negotiation: null,
  memory: null,
  relevance: 'match',
  skipReason: null,
  ...over,
});

describe('saving the best options and saying what changed', () => {
  const NOW = new Date('2026-10-27T12:00:00Z');
  it('keeps the checked, on-topic, not-high-risk ones, best first, with what they published', () => {
    const items = [research({}), research({ handle: '@sketchy', verdict: 'careful', verdictLabel: 'High risk' }), research({ handle: '@unchecked', checked: false }), research({ handle: '@other', relevance: 'adjacent' })];
    const o = optionsFromResult({ items }, NOW);
    expect(o.map((x) => x.handle)).toEqual(['@lagos_gadgets']);
    expect(o[0]).toMatchObject({ source: 'instagram', label: 'Established', rating: 84, distanceKm: 3, price: { median: 1_150_000, currency: 'NGN' }, whatsapp: 'https://wa.me/2348011112222' });
  });
  it('says nothing on the first research, then reports a new top option, a price move, and a vanished one', () => {
    const base = optionsFromResult({ items: [research({}), research({ handle: '@b', name: 'B', rating: { overall: 70, trust: 70, fit: 70, nearby: null, price: null } })] }, NOW);
    expect(diffOptions([], base)).toEqual([]);
    const next = optionsFromResult({ items: [research({ handle: '@fresh', name: 'Fresh', rating: { overall: 90, trust: 90, fit: 90, nearby: null, price: null } }), research({ prices: { currency: 'NGN', low: 1, median: 1_000_000, high: 1, n: 3, points: [], matched: true, text: '₦1M', vsMarket: null } })] }, NOW);
    const changes = diffOptions(base, next);
    expect(changes.join(' | ')).toMatch(/A new top option: @fresh \(established, rated 4\.5\/5\)/);
    expect(changes.join(' | ')).toMatch(/@lagos_gadgets now shows ₦1M, down 13% from ₦1\.15M/);
  });
  it('a web page is added once per address and listed after the rated sellers', () => {
    const web: OptionSnap = { source: 'web', name: 'MacBook Air 13"', handle: null, url: 'https://www.apple.com/x', rating: null, label: 'Official brand store', distanceKm: null, price: { text: '$999.00', median: 999, currency: 'USD' }, phone: null, whatsapp: null, note: null, checkedAt: NOW.toISOString() };
    const rated = optionsFromResult({ items: [research({})] }, NOW);
    const once = withWebOption(rated, web);
    expect(once.map((o) => o.source)).toEqual(['instagram', 'web']);
    expect(withWebOption(once, { ...web, price: { text: '$949.00', median: 949, currency: 'USD' } }).filter((o) => o.source === 'web')).toHaveLength(1);
  });
});

describe('reading a product page', () => {
  const ld = (o: unknown) => `<html><head><title>Shop</title><script type="application/ld+json">${JSON.stringify(o)}</script></head><body></body></html>`;
  it('reads the standard product block', () => {
    const p = readProductPage(ld({ '@context': 'https://schema.org', '@type': 'Product', name: 'MacBook Air 13-inch', offers: { '@type': 'Offer', price: '1,099.00', priceCurrency: 'usd', availability: 'https://schema.org/InStock' } }), 'https://www.apple.com/shop/macbook-air');
    expect(p).toMatchObject({ name: 'MacBook Air 13-inch', price: 1099, currency: 'USD', availability: 'InStock', seller: 'apple.com' });
  });
  it('finds the product inside a graph, with a list of offers, or a price range', () => {
    expect(readProductPage(ld({ '@graph': [{ '@type': 'WebSite' }, { '@type': 'Product', name: 'Phone', offers: [{ '@type': 'Offer', price: 450000, priceCurrency: 'NGN' }] }] }), 'https://shop.example.ng/p')?.price).toBe(450000);
    expect(readProductPage(ld({ '@type': 'Product', name: 'Laptop', offers: { '@type': 'AggregateOffer', lowPrice: '800', highPrice: '900', priceCurrency: 'EUR' } }), 'https://x.example.com/l')).toMatchObject({ price: 800, currency: 'EUR' });
  });
  it('falls back to the page’s price tags, and to no price at all (never a guess)', () => {
    const meta = '<html><head><meta property="og:title" content="Gaming Chair &amp; Desk"><meta property="product:price:amount" content="249.99"><meta property="product:price:currency" content="GBP"></head></html>';
    expect(readProductPage(meta, 'https://shop.example.co.uk/chair')).toMatchObject({ name: 'Gaming Chair & Desk', price: 249.99, currency: 'GBP' });
    expect(readProductPage('<html><head><title>About us</title></head></html>', 'https://shop.example.com/about')).toMatchObject({ name: 'About us', price: null });
    expect(readProductPage('<html></html>', 'https://shop.example.com/')).toBeNull();
  });
  it('reads European number formats and ignores broken data', () => {
    expect(readProductPage(ld({ '@type': 'Product', name: 'X', offers: { price: '1.299,00', priceCurrency: 'EUR' } }), 'https://a.example.de/x')?.price).toBe(1299);
    expect(readProductPage('<script type="application/ld+json">{not json</script><title>T</title>', 'https://a.example.de/x')?.price).toBeNull();
  });
});

describe('what kind of seller a web address is', () => {
  it('knows brands and big retailers by exact domain, and nothing else', () => {
    expect(sellerKind('apple.com')).toBe('official');
    expect(sellerKind('store.samsung.com')).toBe('official');
    expect(sellerKind('amazon.co.uk')).toBe('retailer');
    expect(sellerKind('jumia.com.ng')).toBe('retailer');
    expect(sellerKind('apple.com.evil.example')).toBe('unknown');
    expect(sellerKind('app1e.com')).toBe('unknown');
    expect(sellerKind('cheap-macbooks-lagos.shop')).toBe('unknown');
    expect(SELLER_LABEL.unknown).toBe('Unverified web store');
  });
});

describe('only the public internet is ever opened', () => {
  it('accepts an ordinary shop address', () => {
    expect(checkUrl('https://www.apple.com/shop/buy-mac')).toMatchObject({ ok: true });
    expect(checkUrl('jumia.com.ng/some-phone')).toMatchObject({ ok: true });
  });
  it('refuses private, local and metadata addresses in every disguise', () => {
    for (const bad of ['http://localhost:3000/', 'http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data', 'http://10.0.0.5/', 'http://192.168.1.1/admin', 'http://172.16.0.1/', 'http://[::1]/', 'http://[fd00::1]/', 'http://0x7f000001/', 'http://2130706433/', 'http://intranet/', 'http://printer.local/', 'ftp://example.com/', 'file:///etc/passwd', 'https://user:pass@example.com/', 'https://example.com:8080/', 'http://metadata.internal/']) {
      expect(checkUrl(bad).ok, bad).toBe(false);
    }
  });
  it('knows which IP addresses are public', () => {
    for (const ip of ['8.8.8.8', '104.18.2.3', '2606:4700::1111']) expect(isPublicIp(ip), ip).toBe(true);
    for (const ip of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '172.20.0.1', '192.168.0.9', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', 'fe80::1', 'fc00::1', '::ffff:127.0.0.1']) expect(isPublicIp(ip), ip).toBe(false);
  });
});
