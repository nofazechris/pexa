import { describe, expect, it } from 'vitest';
import { describePlan } from './engine';
import { applyRadius, applyRatings, overall, rankByRating, WEIGHTS } from './rate';
import { normalizeRequest, priorityFrom, radiusFrom } from './request';
import type { ResearchItem } from './types';

const item = (name: string, parts: { trust: number; fit?: number; nearby?: number | null; price?: number | null }, distanceKm: number | null = null): ResearchItem => ({
  platform: 'instagram',
  name,
  handle: '@' + name,
  url: null,
  headline: null,
  verdict: 'solid',
  verdictLabel: 'Looks solid',
  location: null,
  nearness: 'unknown',
  distanceKm,
  contact: { phone: null, tel: null, whatsapp: null, email: null, website: null },
  stats: [],
  signals: [],
  checked: true,
  rating: { overall: 0, trust: parts.trust, fit: parts.fit ?? 80, nearby: parts.nearby ?? null, price: parts.price ?? null },
  prices: null,
  negotiation: null,
  memory: null,
  relevance: 'match',
  skipReason: null,
});

describe('what matters most shifts the rating', () => {
  it('every weighting adds up to one', () => {
    for (const w of Object.values(WEIGHTS)) expect(w.trust + w.fit + w.nearby + w.price).toBeCloseTo(1, 5);
  });
  it('a close but shakier seller wins when the person wants the closest', () => {
    const parts = [{ trust: 90, fit: 80, nearby: 40 }, { trust: 60, fit: 80, nearby: 98 }];
    expect(overall({ ...parts[0], price: null }, 'balanced')!).toBeGreaterThan(overall({ ...parts[1], price: null }, 'balanced')!);
    expect(overall({ ...parts[1], price: null }, 'closest')!).toBeGreaterThan(overall({ ...parts[0], price: null }, 'closest')!);
  });
  it('a cheaper seller wins when the person wants the cheapest, a safer one when they want the most trusted', () => {
    const cheap = { trust: 70, fit: 80, nearby: 80, price: 90 };
    const safe = { trust: 92, fit: 80, nearby: 80, price: 40 };
    expect(overall(cheap, 'cheapest')!).toBeGreaterThan(overall(safe, 'cheapest')!);
    expect(overall(safe, 'trusted')!).toBeGreaterThan(overall(cheap, 'trusted')!);
  });
  it('an unchecked account still has no rating whatever the priority', () => {
    expect(overall({ trust: null, fit: 90, nearby: 90, price: 90 }, 'closest')).toBeNull();
  });
  it('the priority reaches the shortlist ranking', () => {
    const items = [item('far_safe', { trust: 90 }, 30), item('near_ok', { trust: 70 }, 1)];
    const ctx = { what: 'sneakers', place: 'Yaba, Lagos', kind: 'vendors' as const };
    expect(rankByRating(applyRatings(items, { ...ctx, priority: 'closest' }).items)[0].name).toBe('near_ok');
    expect(rankByRating(applyRatings(items, { ...ctx, priority: 'trusted' }).items)[0].name).toBe('far_safe');
  });
});

describe('a radius is a hard limit once a distance is measured', () => {
  const items = [item('a', { trust: 80 }, 2), item('b', { trust: 80 }, 9), item('c', { trust: 80 }, null)];
  it('drops sellers measured farther away and counts them', () => {
    const r = applyRadius(items, 5);
    expect(r.items.map((i) => i.name)).toEqual(['a', 'c']);
    expect(r.outside).toBe(1);
  });
  it('keeps a seller whose distance is unknown but says so', () => expect(applyRadius(items, 5).unverified).toBe(1));
  it('does nothing without a radius', () => {
    expect(applyRadius(items, null).items).toHaveLength(3);
    expect(applyRadius(items, undefined).outside).toBe(0);
  });
});

describe('reading the request', () => {
  it('accepts a sensible radius and rejects nonsense instead of guessing', () => {
    expect(radiusFrom(5)).toBe(5);
    expect(radiusFrom('7.5')).toBe(7.5);
    for (const bad of [0, -3, 500, 'far', null, undefined, NaN]) expect(radiusFrom(bad)).toBeNull();
  });
  it('falls back to balanced for an unknown priority', () => {
    expect(priorityFrom('closest')).toBe('closest');
    expect(priorityFrom('best')).toBe('balanced');
    expect(priorityFrom(undefined)).toBe('balanced');
  });
  it('carries both onto the request and shows them on the plan', () => {
    const n = normalizeRequest({ kind: 'vendors', what: 'sneakers', place: 'Yaba, Lagos', platforms: ['instagram'], priority: 'closest', radiusKm: 5 });
    if (!n.ok) throw new Error('expected ok');
    expect(n.request).toMatchObject({ priority: 'closest', radiusKm: 5 });
    const text = describePlan(n.request).steps.join(' | ');
    expect(text).toMatch(/weighing how close they are most/);
    expect(text).toContain('within 5 km (straight-line)');
  });
  it('leaves the plan unchanged when nothing special was asked', () => {
    const n = normalizeRequest({ kind: 'vendors', what: 'sneakers', place: 'Lagos', platforms: ['instagram'] });
    if (!n.ok) throw new Error('expected ok');
    expect(n.request).toEqual({ kind: 'vendors', platforms: ['instagram'], what: 'sneakers', place: 'Lagos' });
    expect(describePlan(n.request).steps.join(' ')).not.toMatch(/weighing|within/);
  });
});
