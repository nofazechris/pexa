import { describe, expect, it } from 'vitest';
import { assemble, decideNext, foundXSellers, type StepState } from './engine';
import { cityOf, readText, searchKeywords, themeFor } from './commerce';
import { isKeywordStuffed } from './vendor';
import { extractPrices } from './price';
import type { ResearchRequest } from './types';

/**
 * REPLAY of a real search ("sneakers" near Yaba, Lagos, 2026-10-18) that gave bad results. The structures below are exactly what
 * Buy's Instagram and X services returned; names, numbers and wording are invented but keep the same traits. What the person told
 * us about the real run is the standard here:
 *   - a page advertising sneakers that "doesn't look legit" must not read as a good option;
 *   - a seller of sneaker CLEANING products is not a sneaker vendor;
 *   - unrelated accounts must not show up at all.
 */
const NOW = new Date('2026-10-18T12:00:00Z');
const REQ: ResearchRequest = { kind: 'vendors', platforms: ['instagram', 'x'], what: 'sneakers', place: 'Yaba, Lagos' };
const step = (over: Partial<StepState>): StepState => ({ role: 'search', ref: null, outcome: 'PAID', priceAtomic: 7000n, ...over });

// Instagram's user search found ONE account — with the neighbourhood in the keyword.
const igSearch = { data: { count: 1, items: [{ full_name: 'BAGS AND SNEAKERS IN YABA LAGOS', id: '1', is_private: false, is_verified: false, username: 'yaba_bags_store' }] } };

// Its profile, in the shape the service returns (field names are the real ones).
const igProfile = {
  status: true,
  biography: '👉We style you with topnotch bags and sneakers\n👉Your Bag Shopping Crescent\n👉Slay and Be Classy on a Budget\nOld account disabled @yaba_bags_old',
  edge_followed_by: { count: 68 },
  edge_follow: { count: 63 },
  full_name: 'BAGS AND SNEAKERS IN YABA LAGOS',
  is_business_account: false,
  is_professional_account: true,
  business_address_json: '{"city_name":null,"city_id":null,"latitude":null,"longitude":null,"street_address":null,"zip_code":null}',
  category_name: 'Entrepreneur',
  is_private: false,
  is_verified: false,
  is_joined_recently: false,
  username: 'yaba_bags_store',
  edge_felix_video_timeline: { count: 1 },
  edge_owner_to_timeline_media: { count: 0 },
};

const tweet = (screen_name: string, text: string, ui: { name: string; followers_count: number; created_at: string; verified?: boolean; location?: string }, at = 'Wed Oct 08 10:00:00 +0000 2026') => ({
  type: 'tweet',
  tweet_id: String(Math.random()).slice(2),
  screen_name,
  favorites: 3,
  created_at: at,
  text,
  replies: 0,
  views: 100,
  user_info: { screen_name, name: ui.name, created_at: ui.created_at, followers_count: ui.followers_count, verified: ui.verified ?? false, location: ui.location ?? '' },
});

// X's search was asked for "people" and returned TWEETS, including plenty that are nothing to do with buying sneakers.
const xTimeline = {
  status: 'ok',
  timeline: [
    tweet('news_demo', 'Lagos continues to attract global names! 🇳🇬\n\nFrench luxury shoe designer opens a new store at the Lekki mall this week.', { name: 'News Demo', followers_count: 2001, created_at: 'Mon Jan 04 10:00:00 +0000 2016' }),
    tweet('ngo_demo', 'Our children deserve a future that’s not threatened by plastic waste.\n\nThe choices we make today in Lagos and beyond…', { name: 'Waste Charity', followers_count: 9166, created_at: 'Mon Feb 03 10:00:00 +0000 2025', location: 'Lekki Lagos' }),
    tweet('activist_demo', 'Comrade X’s ordeals in the hands of the Lagos State Commissioner of Police…', { name: 'Activist', followers_count: 12736, created_at: 'Mon Feb 03 10:00:00 +0000 2014', location: 'Lagos' }),
    tweet('cleaning_demo', 'We are open.\n\nDrop off your dirty kicks, let’s work some magic on them.\n\nOur store opens at 10am in Yaba.', { name: 'Kicks Clean Demo', followers_count: 386, created_at: 'Mon Mar 08 10:00:00 +0000 2021', location: 'Lagos, Nigeria' }),
    tweet('leather_demo', '100% leather ankle sneakers\n\nhelp retweet my Craft\n\n35,000\n08011112222\nLagos', { name: 'Leather Demo', followers_count: 9955, created_at: 'Fri Jun 02 10:00:00 +0000 2023', verified: true, location: 'lagos' }, 'Tue Oct 14 09:00:00 +0000 2026'),
    tweet('spam_demo', 'Oscar shoes collection we sell all kinds of Ladies shoes, sneakers, handbags, and they are very affordable. ===&gt;&gt; https://t.co/abc', { name: 'Austin Demo', followers_count: 440, created_at: 'Thu Mar 05 10:00:00 +0000 2020', location: 'Lagos' }),
    tweet('spam_demo', 'Oscar shoes collection we sell all kinds of Ladies shoes, sneakers, handbags, and they are very affordable. ===&gt;&gt; https://t.co/def', { name: 'Austin Demo', followers_count: 440, created_at: 'Thu Mar 05 10:00:00 +0000 2020', location: 'Lagos' }),
    tweet('spam_demo', 'Hello guy’s, I sell nice ladies shoes handbags sneakers and they are very affordable. ===&gt;&gt; https://t.co/ghi', { name: 'Austin Demo', followers_count: 440, created_at: 'Thu Mar 05 10:00:00 +0000 2020', location: 'Lagos' }),
    { text: 'undefined', type: 'tweet' }, // X sometimes sends a blank item
  ],
};

const steps: StepState[] = [
  step({ output: igSearch }),
  step({ role: 'xsearch', priceAtomic: 5000n, output: xTimeline }),
  step({ role: 'vet', ref: 'yaba_bags_store', priceAtomic: 5000n, output: igProfile }),
];

describe('replay: the real "sneakers near Yaba" search', () => {
  const result = assemble(REQ, steps, 'done', NOW);
  const by = (handle: string) => result.items.find((i) => i.handle === handle);

  it('shows only accounts that actually sell sneakers', () => {
    expect(result.items.map((i) => i.handle).sort()).toEqual(['@leather_demo', '@spam_demo', '@yaba_bags_store']);
  });

  it('leaves out the cleaning service, and says so by name', () => {
    expect(by('@cleaning_demo')).toBeUndefined();
    expect(result.skipped.some((s) => s.name === '@cleaning_demo' && /service/i.test(s.reason))).toBe(true);
    expect(result.notes.join(' ')).toMatch(/Left out: @cleaning_demo/);
  });

  it('leaves out the charity, the activist and the news account, and counts them', () => {
    for (const h of ['@ngo_demo', '@activist_demo', '@news_demo']) expect(by(h)).toBeUndefined();
    expect(result.skipped.find((s) => /other account/.test(s.name))?.name).toMatch(/^3 other accounts/);
  });

  it('puts the real seller (verified, 10K followers, a price and a phone number) on top', () => {
    expect(result.items[0].handle).toBe('@leather_demo');
    const top = result.items[0];
    expect(top.verdictLabel).toBe('Established');
    expect(top.contact.phone).toBe('08011112222');
    expect(top.prices?.median).toBe(35000);
    expect(top.rating!.overall).toBeGreaterThanOrEqual(78);
  });

  it('rates the page with 0 posts, 68 followers and "old account disabled" as HIGH RISK, last, with the reasons shown', () => {
    const risky = by('@yaba_bags_store')!;
    expect(result.items[result.items.length - 1].handle).toBe('@yaba_bags_store');
    expect(risky.verdict).toBe('careful');
    expect(risky.verdictLabel).toBe('High risk');
    expect(risky.rating!.trust).toBeLessThanOrEqual(30);
    const text = risky.signals.map((s) => s.text).join(' | ');
    expect(text).toMatch(/No posts at all/);
    expect(text).toMatch(/Fewer than 100 followers \(68\)/);
    expect(text).toMatch(/replaces an earlier account/);
    expect(text).toMatch(/written as search words/);
  });

  it('a spammy repeat-poster is not "Established": the repeated ad is called out', () => {
    const spam = by('@spam_demo')!;
    expect(spam.verdict).not.toBe('solid');
    expect(spam.signals.some((s) => /same ad over and over/.test(s.text))).toBe(true);
  });

  it('judges X authors from all of their posts', () => {
    const sellers = foundXSellers(steps, REQ);
    const spam = sellers.find((s) => s.username === 'spam_demo')!;
    expect(spam).toMatchObject({ kind: 'seller', ads: 3, distinctAds: 2 });
    const cleaner = sellers.find((s) => s.username === 'cleaning_demo')!;
    expect(cleaner.kind).toBe('adjacent');
    expect(cleaner.adjacentWord).toMatch(/drop.?off|dirty/);
    expect(sellers.some((s) => s.username === 'undefined')).toBe(false);
  });
});

describe('searching better', () => {
  it('searches the CITY, not the neighbourhood (which found a single account), and under the name sellers use too', () => {
    expect(searchKeywords('sneakers', 'Yaba, Lagos')).toEqual(['sneakers Lagos', 'sneakers plug Lagos']);
    expect(cityOf('Yaba, Lagos')).toBe('Lagos');
    expect(cityOf('Lagos')).toBe('Lagos');
  });
  it('when the first search finds fewer than 3 accounts and X has been tried, it searches again under the second name', () => {
    const n = decideNext({ ...REQ, platforms: ['instagram'] }, [step({ output: igSearch })]);
    expect(n).toMatchObject({ action: 'buy', role: 'fallback', input: { queryParams: { keyword: 'sneakers plug Lagos' } } });
  });
  it('the X search asks for selling posts, newest first, in the city', () => {
    const n = decideNext({ ...REQ, platforms: ['x'] }, []);
    expect(n).toMatchObject({ role: 'xsearch', input: { type: 'latest' } });
    expect((n as unknown as { input: { query: string } }).input.query).toMatch(/\(sneakers\) \("for sale" OR price OR "dm to order" OR "order now" OR available\) Lagos/);
  });
});

describe('what counts as selling it (the theme)', () => {
  const foot = themeFor('sneakers');
  const kind = (text: string, theme = foot) => readText(text, theme, 'NGN').kind;

  it('recognises the categories people shop in', () => {
    expect([themeFor('sneakers').category, themeFor('men’s wear').category, themeFor('ladies tops').category, themeFor('iPhone 13').category, themeFor('laptops').category, themeFor('handbags').category, themeFor('wigs').category, themeFor('sofa').category, themeFor('pressure cooker').category, themeFor('guitar picks').category]).toEqual(['footwear', 'clothing', 'clothing', 'gadgets', 'gadgets', 'bags', 'beauty', 'home', 'home', 'general']);
  });
  it('a selling post for the product is a seller', () => {
    expect(kind('Brand new Air Force 1 sneakers ₦45,000. DM to order, delivery nationwide')).toBe('seller');
    expect(kind('We sell all kinds of ladies shoes, sneakers and handbags')).toBe('seller');
  });
  it('a cleaning, repair or lesson page is NOT a seller of the product', () => {
    expect(kind('Professional sneaker cleaning and restoration. Drop off your kicks')).toBe('adjacent');
    expect(kind('Sneaker cleaning kits for sale, ₦8,000')).toBe('adjacent');
    expect(kind('Learn to make sneakers: 6-week course starts Monday')).toBe('adjacent');
    expect(kind('iPhone screen repair in 30 minutes', themeFor('iphone'))).toBe('adjacent');
    expect(kind('We sell sneakers and also offer cleaning', foot)).toBe('seller'); // an explicit "we sell" wins
  });
  it('talk about the product without selling it is only a mention', () => {
    expect(kind('Everyone in Lagos is wearing these sneakers this season')).toBe('mention');
    expect(kind('Plastic waste is threatening our children’s future')).toBe('unrelated');
  });
  it('works for other things people buy', () => {
    expect(kind('Fresh iPhone 13 Pro, ₦650,000, call 08011112222', themeFor('iphone 13'))).toBe('seller');
    expect(kind('MacBook Air M2 in stock, DM for price', themeFor('laptops'))).toBe('seller');
    expect(kind('Men’s polo shirts and joggers available, ₦12,000 each', themeFor('men’s wear'))).toBe('seller');
    expect(kind('Genuine leather handbags for sale, pay on delivery', themeFor('bags'))).toBe('seller');
    expect(kind('Laptop repair and data recovery', themeFor('laptops'))).toBe('adjacent');
  });
  it('a name packed with search words is flagged; a real brand name is not', () => {
    expect(isKeywordStuffed('BAGS AND SNEAKERS IN YABA LAGOS', 'sneakers', 'Yaba, Lagos')).toBe(true);
    expect(isKeywordStuffed('Lagos Kicks', 'sneakers', 'Yaba, Lagos')).toBe(false);
    expect(isKeywordStuffed('Sole Mate', 'sneakers', 'Lagos')).toBe(false);
  });
  it('reads a price written alone on a line, only when the currency is known', () => {
    const t = '100% leather ankle sneakers\n\n35,000\n08011112222\nLagos';
    expect(extractPrices(t, 'NGN').map((p) => p.amount)).toEqual([35000]);
    expect(extractPrices(t, null)).toEqual([]);
    expect(extractPrices('Est.\n2024\n', 'NGN')).toEqual([]);
  });
});
