import { describe, expect, it } from 'vitest';
import { mergeSameBusiness, ownerKeys } from './dedupe';
import type { ResearchItem } from './types';

const item = (platform: ResearchItem['platform'], handle: string, overall: number, contact: Partial<ResearchItem['contact']> = {}): ResearchItem => ({
  platform,
  name: 'Lagos Kicks',
  handle,
  url: null,
  headline: null,
  verdict: 'solid',
  verdictLabel: 'Looks solid',
  location: null,
  nearness: 'unknown',
  distanceKm: null,
  contact: { phone: null, tel: null, whatsapp: null, email: null, website: null, ...contact },
  stats: [],
  signals: [],
  checked: true,
  rating: { overall, trust: overall, fit: 80, nearby: null, price: null },
  prices: null,
  negotiation: null,
  memory: null,
  relevance: 'match',
  skipReason: null,
});

describe('the same business on two platforms', () => {
  it('matches a phone written two ways', () => {
    const a = ownerKeys(item('instagram', '@a', 70, { tel: '08011112222' }));
    const b = ownerKeys(item('tiktok', '@b', 70, { tel: '+2348011112222' }));
    expect(a.filter((k) => b.includes(k))).toHaveLength(1);
  });
  it('shows it once, keeps the better-rated page and names the other', () => {
    const merged = mergeSameBusiness([item('instagram', '@ig', 70, { tel: '+2348011112222' }), item('tiktok', '@tt', 85, { whatsapp: 'https://wa.me/2348011112222' })]);
    expect(merged).toHaveLength(1);
    expect(merged[0].handle).toBe('@tt');
    expect(merged[0].signals.map((s) => s.text).join(' ')).toMatch(/also found on Instagram \(@ig\)/);
  });
  it('never merges on a shared name alone', () => {
    expect(mergeSameBusiness([item('instagram', '@ig', 70), item('tiktok', '@tt', 80)])).toHaveLength(2);
  });
  it('ignores link-in-bio and social hosts that many unrelated shops share', () => {
    const merged = mergeSameBusiness([item('instagram', '@ig', 70, { website: 'https://linktr.ee/one' }), item('tiktok', '@tt', 80, { website: 'https://linktr.ee/two' })]);
    expect(merged).toHaveLength(2);
    expect(ownerKeys(item('x', '@x', 50, { website: 'https://www.lagoskicks.ng/shop' }))).toEqual(['site:lagoskicks.ng']);
  });
  it('does not merge two pages on the same platform', () => {
    expect(mergeSameBusiness([item('instagram', '@a', 70, { tel: '08011112222' }), item('instagram', '@b', 60, { tel: '08011112222' })])).toHaveLength(2);
  });
  it('an unrated page never beats a rated one', () => {
    const unrated = { ...item('tiktok', '@tt', 0, { email: 'hi@lagoskicks.ng' }), rating: null };
    const merged = mergeSameBusiness([unrated, item('instagram', '@ig', 55, { email: 'HI@lagoskicks.ng' })]);
    expect(merged.map((i) => i.handle)).toEqual(['@ig']);
  });
});
