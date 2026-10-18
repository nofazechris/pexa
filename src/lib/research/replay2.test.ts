import { describe, expect, it } from 'vitest';
import { assemble, type StepState } from './engine';
import { paymentTerms, readText, themeFor } from './commerce';
import { igProfile } from './read';
import type { ResearchRequest } from './types';

/**
 * REPLAY 2 — the second real "sneakers near Yaba" search (2026-10-18, after the first fix). Real structures; invented names and
 * numbers that keep each account's traits. What the person said about it:
 *   - the Instagram accounts were more correct than the X ones; real Lagos sneaker stores must not be marked down for things the data
 *     can't say (Instagram returns "0 posts" for big, verified accounts);
 *   - "no payment on delivery" in an ad is a red flag (it can be innocent, but it is one);
 *   - tweets and pages must be checked individually, and a clothes seller who mentions sneakers is not a sneaker seller.
 */
const NOW = new Date('2026-10-18T12:00:00Z');
const REQ: ResearchRequest = { kind: 'vendors', platforms: ['instagram', 'x'], what: 'sneakers', place: 'Yaba, Lagos' };
const step = (over: Partial<StepState>): StepState => ({ role: 'search', ref: null, outcome: 'PAID', priceAtomic: 7000n, ...over });
const day = 86400;
const at = Math.floor(NOW.getTime() / 1000);

const accounts = ['plug_demo', 'kicksco_demo', 'wholesale_demo', 'thin_demo'].map((u, i) => ({ username: u, full_name: ['SNEAKERS PLUG IN LAGOS', 'Kicks & Co | Sneakers Store in Lagos', 'SNEAKERS || SLIPPERS || FOOTWEARS WHOLESALER IN LAGOS', 'SNEAKERS IN LAGOS'][i], is_private: false, is_verified: i === 0 }));
const igSearch = { data: { count: accounts.length, items: accounts } };

// Verified, 6.6K followers, pay on delivery — and Instagram returned NO posts for it (count 0, no edges).
const plug = { biography: 'ONLINE STORE\nOPENS 24/7\nSAME DAY DELIVERY & POD WITHIN LAGOS\nNATIONWIDE DELIVERY\nTO ORDER SEND A DM', edge_followed_by: { count: 6604 }, edge_follow: { count: 179 }, full_name: 'SNEAKERS PLUG IN LAGOS', is_business_account: false, is_professional_account: true, is_verified: true, is_joined_recently: false, username: 'plug_demo', edge_owner_to_timeline_media: { count: 0 } };

// 4K followers, 134 posts (12 returned, newest 31 days old), bio mentions an old account.
const kicksco = {
  biography: 'Premium, Quality Sneakers\nSame-day delivery in Lagos\nOld account @kicksco_old\nNationwide shipping\nTrusted by 200+ customers\nDM/Click to shop',
  edge_followed_by: { count: 4016 },
  edge_follow: { count: 6 },
  full_name: 'Kicks & Co | Sneakers Store in Lagos',
  is_professional_account: true,
  is_verified: false,
  username: 'kicksco_demo',
  edge_owner_to_timeline_media: {
    count: 134,
    edges: [31, 40, 52, 60].map((d, i) => ({ node: { id: String(i), taken_at_timestamp: at - d * day, edge_liked_by: { count: 120 }, edge_media_to_comment: { count: 9 }, edge_media_to_caption: { edges: [{ node: { text: i === 0 ? 'New drop: Air Force 1 sneakers ₦48,000 available now' : '' } }] } } })),
  },
};

// 10.8K followers, wholesaler, category "Product/service", no posts returned.
const wholesale = { biography: 'WE DEAL DIRECTLY WITH FACTORY\nWHOLESALES & RETAIL\nSNEAKERS\nSLIPPERS\nORDER ON THE WEBSITE', edge_followed_by: { count: 10800 }, edge_follow: { count: 507 }, full_name: 'SNEAKERS || SLIPPERS || FOOTWEARS WHOLESALER IN LAGOS', category_name: 'Product/service', is_professional_account: true, is_verified: false, username: 'wholesale_demo', edge_owner_to_timeline_media: { count: 0 } };

// ~1K followers, ONE post — three years old.
const thin = { biography: 'Home of affordable sneakers\nOnline store\nSwift delivery\nLagos', edge_followed_by: { count: 1030 }, edge_follow: { count: 3 }, full_name: 'SNEAKERS IN LAGOS', category_name: 'Entrepreneur', is_professional_account: true, is_verified: false, username: 'thin_demo', external_url: 'https://wa.me/message/ABC', edge_owner_to_timeline_media: { count: 1, edges: [{ node: { taken_at_timestamp: at - 1100 * day, edge_liked_by: { count: 4 }, edge_media_to_caption: { edges: [{ node: { text: '' } }] } } }] } };

const tweet = (screen_name: string, text: string, ui: { name: string; followers_count: number; created_at: string; location?: string; verified?: boolean }, tweetAt: string) => ({
  type: 'tweet',
  tweet_id: `${screen_name}-${tweetAt}-${text.length}`,
  screen_name,
  created_at: tweetAt,
  text,
  favorites: 1,
  user_info: { screen_name, name: ui.name, created_at: ui.created_at, followers_count: ui.followers_count, verified: ui.verified ?? false, location: ui.location ?? 'Lagos' },
});

const xTimeline = {
  status: 'ok',
  timeline: [
    // A BRAND-NEW account whose ad says "NO PAYMENT ON DELIVERY".
    tweet('newtrade_demo', 'UNISEX SNEAKERS SIZE:::38—44 PRICE:30,000 ✅ FULLY BOXED. LOCATION IS LAGOS DELIVERY IS NATIONWIDE ✅ NUMBER IS 08011112222 ✅ NOTE NO PAYMENT ON DELIVERY', { name: 'ALL TRADE', followers_count: 493, created_at: 'Fri Feb 06 10:00:00 +0000 2026' }, 'Sat Oct 10 10:00:00 +0000 2026'),
    // A clothes seller: sneakers are only a styling tip.
    tweet('shorts_demo', 'Our Ankara shorts go for just ₦5,000! Best paired with a round-neck, crop top or a simple shirt and sneakers for that effortlessly stylish look.', { name: 'Ankara Shorts', followers_count: 1443, created_at: 'Mon Mar 07 10:00:00 +0000 2022' }, 'Thu Oct 08 10:00:00 +0000 2026'),
    // A seller who last advertised three years ago.
    tweet('stale_demo', 'Unisex Sneakers & Wedge Slide Frame1 45-46 (12,000) Frame2 37-42 (12,500) Nationwide Delivery. Like, Patronize', { name: 'Rite Pair', followers_count: 1670, created_at: 'Mon Mar 07 10:00:00 +0000 2022' }, 'Tue Oct 05 10:00:00 +0000 2023'),
    // A real, established seller.
    tweet('real_demo', '@someblog I sell sneakers at affordable prices Location : Lagos Free delivery within Lagos DM to order', { name: 'Jet', followers_count: 1228, created_at: 'Wed Jan 15 10:00:00 +0000 2020' }, 'Fri Oct 10 10:00:00 +0000 2026'),
  ],
};

const steps: StepState[] = [
  step({ output: igSearch }),
  step({ role: 'vet', ref: 'plug_demo', priceAtomic: 5000n, output: plug }),
  step({ role: 'vet', ref: 'kicksco_demo', priceAtomic: 5000n, output: kicksco }),
  step({ role: 'vet', ref: 'wholesale_demo', priceAtomic: 5000n, output: wholesale }),
  step({ role: 'vet', ref: 'thin_demo', priceAtomic: 5000n, output: thin }),
  step({ role: 'xsearch', priceAtomic: 5000n, output: xTimeline }),
];

describe('replay 2: the second real "sneakers near Yaba" search', () => {
  const r = assemble(REQ, steps, 'done', NOW);
  const by = (h: string) => r.items.find((i) => i.handle === h)!;
  const text = (h: string) => by(h).signals.map((s) => s.text).join(' | ');

  it('shows all four real Instagram stores — none is dropped for having "0 posts"', () => {
    for (const h of ['@plug_demo', '@kicksco_demo', '@wholesale_demo', '@thin_demo']) expect(by(h)).toBeDefined();
  });

  it('a verified 6.6K-follower store with no posts returned is NOT treated as an empty page: Established, and pay-on-delivery counts for it', () => {
    const p = by('@plug_demo');
    expect(p.verdictLabel).toBe('Established');
    expect(text('@plug_demo')).not.toMatch(/No posts at all/);
    expect(text('@plug_demo')).toMatch(/Instagram didn’t return their posts/);
    expect(text('@plug_demo')).toMatch(/pay on delivery/i);
  });

  it('a big store that mentions an old account is Unproven, not High risk — with a "ask what happened" note', () => {
    const k = by('@kicksco_demo');
    expect(k.verdictLabel).toBe('Unproven');
    expect(text('@kicksco_demo')).toMatch(/earlier account/);
    expect(k.prices?.median).toBe(48000); // read from the post's caption in Instagram's graph shape
  });

  it('an unverified wholesaler whose posts could not be read is Unproven (activity unconfirmed), not High risk', () => {
    expect(by('@wholesale_demo').verdictLabel).toBe('Unproven');
  });

  it('a page with one old post is High risk', () => {
    expect(by('@thin_demo').verdictLabel).toBe('High risk');
  });

  it('an X ad that says "no payment on delivery" is flagged, and the brand-new account is not Established', () => {
    const n = by('@newtrade_demo');
    expect(n.verdictLabel).not.toBe('Established');
    expect(text('@newtrade_demo')).toMatch(/NO PAYMENT ON DELIVERY/i);
    expect(text('@newtrade_demo')).toMatch(/under a year old|Brand-new/);
  });

  it('a clothes seller who only mentions sneakers is left out, by name', () => {
    expect(by('@shorts_demo')).toBeUndefined();
    expect(r.skipped.some((s) => s.name === '@shorts_demo' && /something other than sneakers/.test(s.reason))).toBe(true);
  });

  it('a seller who stopped advertising years ago is flagged as inactive', () => {
    const s = by('@stale_demo');
    expect(text('@stale_demo')).toMatch(/No selling post for over a year/);
    expect(s.verdictLabel).not.toBe('Established');
  });

  it('a real, established X seller is Established', () => {
    expect(by('@real_demo').verdictLabel).toBe('Established');
  });

  it('the best accounts come first and the risky ones last', () => {
    const order = r.items.map((i) => i.handle);
    expect(order.indexOf('@thin_demo')).toBeGreaterThan(order.indexOf('@plug_demo'));
    expect(order.indexOf('@thin_demo')).toBeGreaterThan(order.indexOf('@real_demo'));
    expect(order.indexOf('@newtrade_demo')).toBeGreaterThan(order.indexOf('@real_demo'));
  });
});

describe('payment terms and reading', () => {
  it.each([
    ['NOTE NO PAYMENT ON DELIVERY', true],
    ['no pod please', true],
    ['full payment before delivery', true],
    ['No refunds, no returns', true],
    ['SAME DAY DELIVERY & POD WITHIN LAGOS', false],
    ['pay on delivery available', false],
  ])('"%s" → upfront-only flag: %s', (text, flagged) => expect(paymentTerms(text).upfrontOnly !== null).toBe(flagged));
  it('pay on delivery is recognised as the safer promise, and never alongside a "no POD" line', () => {
    expect(paymentTerms('SAME DAY DELIVERY & POD WITHIN LAGOS').podOffered).toBe(true);
    expect(paymentTerms('Pay on delivery! (no POD for far states)').podOffered).toBe(false);
  });
  it('reads a caption from Instagram’s graph shape', () => {
    const p = igProfile({ username: 'a', edge_followed_by: { count: 2000 }, edge_owner_to_timeline_media: { count: 3, edges: [{ node: { taken_at_timestamp: at - day, edge_liked_by: { count: 50 }, edge_media_to_caption: { edges: [{ node: { text: 'Dunk low sneakers ₦55,000' } }] } } }] } })!;
    expect(p.recent[0].caption).toBe('Dunk low sneakers ₦55,000');
  });
  it('clothes words dominate a tweet about shorts, but not a "bags and sneakers" bio', () => {
    const foot = themeFor('sneakers');
    expect(readText('Our Ankara shorts ₦5,000, pair with a crop top, a shirt and sneakers', foot, 'NGN').kind).toBe('unrelated');
    expect(readText('We sell bags and sneakers. DM to order. ₦20,000', foot, 'NGN').kind).toBe('seller');
  });
});
