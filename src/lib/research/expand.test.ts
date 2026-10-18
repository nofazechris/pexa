import { describe, expect, it } from 'vitest';
import { expandOptions } from './expand';
import type { ResearchRequest } from './types';

const req = (over: Partial<ResearchRequest> = {}): ResearchRequest => ({ kind: 'vendors', platforms: ['instagram'], what: 'sneakers', place: 'Yaba, Lagos', ...over });

describe('offers to widen a search', () => {
  it('offers the next radius when sellers were left out for being too far', () => {
    expect(expandOptions(req({ radiusKm: 5 }), { shown: 4, outsideRadius: 3 })).toEqual([{ label: 'Widen to 10 km', text: 'Same search, but within 10 km' }]);
  });
  it('offers nothing when nothing was left out and enough was found', () => {
    expect(expandOptions(req({ radiusKm: 5 }), { shown: 4, outsideRadius: 0 })).toEqual([]);
    expect(expandOptions(req(), { shown: 5, outsideRadius: 0 })).toEqual([]);
  });
  it('has no bigger radius to offer past 100 km', () => {
    expect(expandOptions(req({ radiusKm: 100 }), { shown: 4, outsideRadius: 2 })).toEqual([]);
  });
  it('suggests platforms not yet searched when very few sellers turned up', () => {
    const o = expandOptions(req(), { shown: 1, outsideRadius: 0 });
    expect(o.map((x) => x.text)).toEqual(['Search TikTok', 'Search X']);
  });
  it('never offers platforms for hiring', () => {
    expect(expandOptions(req({ kind: 'hire', platforms: ['linkedin'] }), { shown: 0, outsideRadius: 0 })).toEqual([]);
  });
});
