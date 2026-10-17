import { describe, expect, it } from 'vitest';
import { applyRatings, fitScore, initialRating, marketOf, nearbyScore, negotiationFor, overall, priceScore, rankByRating, stars, trustScore } from './rate';
import { scoreInstagram } from './score';
import { assemble, type StepState } from './engine';
import { igProfile } from './read';
import type { ResearchItem, ResearchRequest } from './types';

const NOW = new Date('2026-10-18T12:00:00Z');
const at = Math.floor(NOW.getTime() / 1000);
const day = 86400;

const base = (over: Partial<ResearchItem>): ResearchItem => ({
  platform: 'instagram',
  name: 'Lagos Kicks',
  handle: '@lagos_kicks',
  url: null,
  headline: null,
  verdict: 'solid',
  verdictLabel: 'Looks solid',
  location: null,
  nearness: 'unknown',
  distanceKm: null,
  contact: { phone: null, tel: null, whatsapp: null, email: null, website: null },
  stats: [],
  signals: [],
  checked: true,
  rating: initialRating(80, 90),
  prices: null,
  negotiation: null,
  ...over,
});
const withPrices = (points: number[], over: Partial<ResearchItem> = {}): ResearchItem => {
  const sorted = [...points].sort((a, b) => a - b);
  return base({ prices: { currency: 'NGN', low: sorted[0], median: sorted[Math.floor(sorted.length / 2)], high: sorted[sorted.length - 1], n: points.length, points, matched: true, text: '', vsMarket: null }, ...over });
};
const ctx = { what: 'sneakers', place: 'Yaba, Lagos', kind: 'vendors' as const };

describe('the parts of a rating', () => {
  it('trust rises with good facts and falls hard with worries', () => {
    const g = (n: number) => Array.from({ length: n }, () => ({ tone: 'good' as const, text: 'g' }));
    const w = (n: number) => Array.from({ length: n }, () => ({ tone: 'warn' as const, text: 'w' }));
    expect([trustScore([]), trustScore(g(3)), trustScore(g(9)), trustScore(w(1)), trustScore(w(4))]).toEqual([55, 91, 98, 35, 5]);
    expect(trustScore([{ tone: 'info', text: 'i' }])).toBe(55); // information never changes trust
  });
  it('fit follows how much of the request appears', () => {
    expect([fitScore(0, 2), fitScore(1, 2), fitScore(2, 2), fitScore(0, 0)]).toEqual([35, 68, 100, null]);
  });
  it('nearness: a measured distance wins, else the stated place', () => {
    expect([nearbyScore({ distanceKm: 1, nearness: 'other' }), nearbyScore({ distanceKm: 7, nearness: 'area' }), nearbyScore({ distanceKm: 300, nearness: 'city' })]).toEqual([98, 85, 20]);
    expect([nearbyScore({ distanceKm: null, nearness: 'area' }), nearbyScore({ distanceKm: null, nearness: 'city' }), nearbyScore({ distanceKm: null, nearness: 'other' }), nearbyScore({ distanceKm: null, nearness: 'unknown' })]).toEqual([95, 70, 20, null]);
  });
  it('price: cheaper is better, much dearer is worse, absurdly cheap is not a bargain', () => {
    expect([priceScore({ kind: 'below', percent: -15 }), priceScore({ kind: 'below', percent: -30 }), priceScore({ kind: 'near', percent: 2 }), priceScore({ kind: 'above', percent: 18 }), priceScore({ kind: 'above', percent: 60 }), priceScore({ kind: 'below', percent: -60 }), priceScore(null)]).toEqual([85, 90, 70, 50, 20, 50, null]);
  });
  it('overall averages only what is known, and an unchecked account has no rating', () => {
    expect(overall({ trust: 80, fit: 100, nearby: null, price: null })).toBe(87); // (80*.45 + 100*.25) / .70 = 87.1
    expect(overall({ trust: 80, fit: 100, nearby: 100, price: 100 })).toBe(91);
    expect(overall({ trust: null, fit: 100, nearby: 100, price: 100 })).toBeNull();
    expect(stars(88)).toBe('4.4');
  });
});

describe('the typical price', () => {
  it('needs comparable prices from at least three sellers — two sellers are not a market', () => {
    expect(marketOf([withPrices([30000, 40000, 50000])])).toBeNull();
    expect(marketOf([withPrices([30000]), withPrices([40000])])).toBeNull();
    expect(marketOf([withPrices([30000, 40000]), withPrices([50000, 60000])])).toBeNull();
    const m = marketOf([withPrices([30000, 40000]), withPrices([50000, 60000]), withPrices([45000])]);
    expect(m?.view).toMatchObject({ currency: 'NGN', n: 5, text: '₦30k–₦60k', middle: '₦45k' });
  });
  it('ignores prices that are not for the thing asked about (the seller’s other items)', () => {
    const mixed = (pts: number[]) => withPrices(pts, { prices: { ...withPrices(pts).prices!, matched: false } });
    expect(marketOf([mixed([12000, 38000, 42000]), mixed([20000, 65000, 72000])])).toBeNull();
  });
  it('ignores sellers with no prices', () => {
    expect(marketOf([base({}), base({})])).toBeNull();
  });
});

describe('rating the shortlist', () => {
  const cheap = withPrices([30000, 32000, 35000], { handle: '@cheap', distanceKm: 3 });
  const mid = withPrices([38000, 40000, 42000], { handle: '@mid', distanceKm: 4 });
  const dear = withPrices([60000, 65000, 70000], { handle: '@dear', distanceKm: 2 });
  const noPrices = base({ handle: '@quiet', distanceKm: 5 });

  it('compares each seller with the typical price and scores it', () => {
    const { items, market } = applyRatings([cheap, mid, dear, noPrices], ctx);
    expect(market?.middle).toBe('₦40k');
    const by = Object.fromEntries(items.map((i) => [i.handle, i]));
    expect(by['@cheap'].prices?.vsMarket?.kind).toBe('below');
    expect(by['@mid'].prices?.vsMarket?.kind).toBe('near');
    expect(by['@dear'].prices?.vsMarket?.kind).toBe('above');
    expect(by['@quiet'].prices).toBeNull();
    expect(by['@cheap'].rating!.price).toBeGreaterThan(by['@dear'].rating!.price!);
    expect(by['@quiet'].rating!.price).toBeNull();
  });
  it('the same seller rates lower when the price is high', () => {
    const { items } = applyRatings([cheap, mid, dear], ctx);
    const r = (h: string) => items.find((i) => i.handle === h)!.rating!.overall;
    expect(r('@cheap')).toBeGreaterThan(r('@dear'));
  });
  it('does not change the items it was given', () => {
    const before = JSON.stringify([cheap, mid]);
    applyRatings([cheap, mid, dear], ctx);
    expect(JSON.stringify([cheap, mid])).toBe(before);
  });
  it('ranks by rating, unrated last, closer wins a tie', () => {
    const a = base({ handle: '@a', rating: initialRating(70, 70), distanceKm: 9 });
    const b = base({ handle: '@b', rating: initialRating(90, 90), distanceKm: 20 });
    const c = base({ handle: '@c', rating: initialRating(70, 70), distanceKm: 2 });
    const u = base({ handle: '@u', rating: null, checked: false });
    expect(rankByRating([u, a, b, c]).map((i) => i.handle)).toEqual(['@b', '@c', '@a', '@u']);
  });
});

describe('negotiation help', () => {
  const others = [withPrices([30000, 38000, 40000]), withPrices([36000, 42000, 45000]), withPrices([34000, 39000, 41000])];
  const market = marketOf(others);

  it('for a seller above the typical price: a lower first offer and a message that says so', () => {
    const dear = withPrices([55000, 60000, 65000], { name: 'Tunde Kicks' });
    const n = negotiationFor(applyRatings([...others, dear], ctx).items[3], market, ctx);
    expect(n.tip).toMatch(/above what others charge/);
    expect(n.offer).toMatch(/^₦\d+k$/);
    expect(n.message).toMatch(/Hi Tunde/);
    expect(n.message).toContain(n.offer!);
    expect(n.message).toMatch(/similar ones are about/);
  });
  it('never offers more than the seller already asks', () => {
    const dear = withPrices([55000, 60000, 65000]);
    const n = negotiationFor(dear, market, ctx);
    const asked = 60000;
    const offered = Number(n.offer!.replace(/[^\d.]/g, '')) * 1000;
    expect(offered).toBeLessThan(asked);
  });
  it('for a seller near the typical price: a small discount to ask for', () => {
    const fair = withPrices([39000, 40000, 41000]);
    const n = negotiationFor(applyRatings([...others, fair], ctx).items[3], market, ctx);
    expect(n.tip).toMatch(/In line/);
    expect(n.offer).not.toBeNull();
  });
  it('for a seller far below everyone: a warning, not a bargain', () => {
    const odd = withPrices([8000, 9000, 10000]);
    const n = negotiationFor(applyRatings([...others, odd], ctx).items[3], market, ctx);
    expect(n.tip).toMatch(/scam|poor quality/);
    expect(n.offer).toBeNull();
    expect(n.message).toMatch(/video|photos/);
  });
  it('with no prices published: ask for a quote, and say what others charge when known', () => {
    const quiet = base({});
    expect(negotiationFor(quiet, market, ctx).tip).toMatch(/Others charge ₦[\d.]+k–₦[\d.]+k/);
    expect(negotiationFor(quiet, null, ctx).tip).toMatch(/at least two/);
    expect(negotiationFor(quiet, null, ctx).offer).toBeNull();
  });
  it('for hiring: ask about the job, rate and timeline — no invented prices', () => {
    const n = negotiationFor(base({ platform: 'linkedin', name: 'Ada Obi' }), null, { what: 'graphic designer', place: 'Lagos', kind: 'hire' });
    expect(n.offer).toBeNull();
    expect(n.message).toMatch(/rate for this job/);
  });
});

describe('end to end from a profile with prices in its posts', () => {
  const req: ResearchRequest = { kind: 'vendors', source: 'instagram', what: 'sneakers', place: 'Yaba, Lagos' };
  const step = (over: Partial<StepState>): StepState => ({ role: 'search', ref: null, outcome: 'PAID', priceAtomic: 7000n, ...over });
  const profile = (user: string, captions: string[], followers = 4000) => ({
    username: user,
    biography: `Sneakers 👟 DM to order · 📍 Surulere, Lagos`,
    follower_count: followers,
    media_count: 120,
    is_business: true,
    recent_media: captions.map((caption, i) => ({ taken_at: at - day * (2 + i * 3), like_count: 200, comment_count: 15, caption })),
  });

  it('reads prices from captions, builds the typical price, and rates the cheaper good seller higher', () => {
    const steps: StepState[] = [
      step({ output: { users: [{ username: 'fair_kicks', full_name: 'Fair Kicks' }, { username: 'dear_kicks', full_name: 'Dear Kicks' }] } }),
      step({ role: 'xsearch', priceAtomic: 5000n, output: { results: [] } }),
      step({ role: 'vet', ref: 'fair_kicks', priceAtomic: 5000n, output: profile('fair_kicks', ['Air Force 1 sneakers ₦38,000', 'Dunks sneakers ₦42,000', 'Slides #12,000']) }),
      step({ role: 'vet', ref: 'dear_kicks', priceAtomic: 5000n, output: profile('dear_kicks', ['Air Force 1 sneakers ₦65,000', 'Dunks sneakers ₦72,000', 'Slides #20,000']) }),
      step({ role: 'vet', ref: 'mid_kicks', priceAtomic: 5000n, output: profile('mid_kicks', ['Air Force 1 sneakers ₦40,000', 'Dunks sneakers ₦44,000']) }),
    ];
    steps[0] = step({ output: { users: [{ username: 'fair_kicks' }, { username: 'dear_kicks' }, { username: 'mid_kicks' }] } });
    const r = assemble(req, steps, 'done', NOW);
    expect(r.market).not.toBeNull();
    expect(r.market!.n).toBe(6); // only the sneaker prices, not the slides
    const fair = r.items.find((i) => i.handle === '@fair_kicks')!;
    const dear = r.items.find((i) => i.handle === '@dear_kicks')!;
    expect(fair.prices).toMatchObject({ currency: 'NGN', n: 2, matched: true });
    expect(dear.prices!.vsMarket?.kind).toBe('above');
    expect(fair.rating!.overall).toBeGreaterThan(dear.rating!.overall);
    expect(r.items[0].handle).toBe('@fair_kicks');
    expect(dear.negotiation?.offer).toMatch(/^₦/);
    expect(r.summary).toMatch(/Typical price: ₦/);
    expect(r.summary).toMatch(/\/5/);
  });

  it('mixed items that never name what was asked for are NOT compared: no market, no "above usual", no invented offer', () => {
    const steps: StepState[] = [
      step({ output: { users: [{ username: 'a_kicks' }, { username: 'b_kicks' }] } }),
      step({ role: 'xsearch', priceAtomic: 5000n, output: { results: [] } }),
      step({ role: 'vet', ref: 'a_kicks', priceAtomic: 5000n, output: profile('a_kicks', ['Air Force 1 ₦38,000', 'Slides #12,000']) }),
      step({ role: 'vet', ref: 'b_kicks', priceAtomic: 5000n, output: profile('b_kicks', ['Dunks ₦65,000', 'Slides #20,000']) }),
    ];
    const r = assemble({ ...req, what: 'trainers' }, steps, 'done', NOW);
    expect(r.market).toBeNull();
    for (const i of r.items) {
      expect(i.prices?.matched).toBe(false);
      expect(i.prices?.vsMarket).toBeNull();
      expect(i.rating?.price).toBeNull();
      expect(i.negotiation?.offer).toBeNull();
      expect(i.negotiation?.tip).toMatch(/across different items/);
    }
  });

  it('a seller who publishes no prices still gets a rating and a "ask for a quote" message', () => {
    const steps: StepState[] = [
      step({ output: { users: [{ username: 'quiet_kicks' }] } }),
      step({ role: 'xsearch', priceAtomic: 5000n, output: { results: [] } }),
      step({ role: 'vet', ref: 'quiet_kicks', priceAtomic: 5000n, output: profile('quiet_kicks', ['New drop 🔥', 'Restocked']) }),
    ];
    const r = assemble(req, steps, 'done', NOW);
    expect(r.market).toBeNull();
    expect(r.items[0].prices).toBeNull();
    expect(r.items[0].rating?.overall).toBeGreaterThan(0);
    expect(r.items[0].negotiation?.tip).toMatch(/No prices published/);
  });

  it('an unchecked account has no rating or negotiation', () => {
    const item = scoreInstagram({ username: 'x', fullName: null, verified: null, isPrivate: null, followers: null, bio: null }, null, NOW, 'Lagos', 'sneakers');
    expect(item).toMatchObject({ rating: null, prices: null, negotiation: null });
    expect(igProfile({ username: 'x', follower_count: 10, media_count: 1 })).not.toBeNull();
  });
});
