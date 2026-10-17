import { describe, expect, it } from 'vitest';
import { distanceText, haversineKm, nearness, placeLabel, placeParts, roundedPoint } from '@/lib/geo/place';
import { contactFrom, igProfile, placeFrom, xPeople } from './read';
import { rankItems, scoreInstagram, scoreX, whereIs } from './score';
import { assemble, decideNext, foundXPeople, rankXPeople, SERVICE, type StepState } from './engine';
import type { ResearchItem, ResearchRequest } from './types';

const NOW = new Date('2026-10-17T12:00:00Z');

describe('place names', () => {
  it('labels an OpenStreetMap address with the area, town and state', () => {
    expect(placeLabel({ suburb: 'Igbobi', town: 'Bariga', county: 'Shomolu', state: 'Lagos State', country: 'Nigeria' })).toBe('Igbobi, Bariga, Lagos');
    expect(placeLabel({ suburb: 'Yaba', city: 'Lagos', state: 'Lagos State' })).toBe('Yaba, Lagos');
    expect(placeLabel({ city: 'Nairobi', state: 'Nairobi County' })).toBe('Nairobi, Nairobi County');
    expect(placeLabel({ suburb: 'Karum', state: 'Federal Capital Territory' })).toBe('Karum, Abuja');
    expect(placeLabel({})).toBeNull();
  });
  it('splits a place into names', () => expect(placeParts('Yaba, Lagos')).toEqual(['Yaba', 'Lagos']));

  it('compares places by name: same neighbourhood, same city, elsewhere, or not stated', () => {
    expect(nearness('Yaba, Lagos', 'Yaba, Lagos')).toBe('area');
    expect(nearness('📍 Yaba', 'Yaba, Lagos')).toBe('area');
    expect(nearness('Surulere, Lagos', 'Yaba, Lagos')).toBe('city');
    expect(nearness('Lagos', 'Yaba, Lagos')).toBe('city');
    expect(nearness('Abuja', 'Yaba, Lagos')).toBe('other');
    expect(nearness(null, 'Yaba, Lagos')).toBe('unknown');
    expect(nearness('', 'Lagos')).toBe('unknown');
  });
  it('does not match a name inside a longer word', () => expect(nearness('Lagosta restaurant', 'Lagos')).toBe('other'));
  it('ignores accents', () => expect(nearness('São Paulo', 'Sao Paulo')).toBe('city'));

  it('measures distance and says it in words', () => {
    const yaba = { lat: 6.5068, lon: 3.3755 };
    const surulere = { lat: 6.4856, lon: 3.354 };
    expect(haversineKm(yaba, surulere)).toBeGreaterThan(2.5);
    expect(haversineKm(yaba, surulere)).toBeLessThan(4);
    expect(distanceText(0.4)).toBe('under 1 km away');
    expect(distanceText(4.2)).toBe('about 4 km away');
    expect(distanceText(123)).toBe('about 125 km away');
  });
  it('keeps a shared position to a neighbourhood and rejects nonsense', () => {
    expect(roundedPoint(6.523456, 3.378912)).toEqual({ lat: 6.52, lon: 3.38 });
    expect(roundedPoint('6.5', '3.4')).toEqual({ lat: 6.5, lon: 3.4 });
    expect(roundedPoint(999, 3)).toBeNull();
    expect(roundedPoint('x', 3)).toBeNull();
    expect(roundedPoint(null, null)).toBeNull();
  });
});

describe('contact details an account published', () => {
  it('reads a business account phone field, with its country code', () => {
    const c = contactFrom({ public_phone_number: '8012345678', public_phone_country_code: '234', public_email: 'hello@kicks.ng' }, null, null);
    expect(c).toMatchObject({ phone: '+234 8012345678', tel: '+2348012345678', whatsapp: 'https://wa.me/2348012345678', email: 'hello@kicks.ng' });
  });
  it('finds a number in a bio, and only offers WhatsApp when the number is international', () => {
    expect(contactFrom({}, 'Sneakers 👟 Order: +234 801 234 5678', null)).toMatchObject({ phone: '+234 801 234 5678', whatsapp: 'https://wa.me/2348012345678' });
    const local = contactFrom({}, 'Call 0801 234 5678 to order', null);
    expect(local).toMatchObject({ phone: '0801 234 5678', tel: '08012345678', whatsapp: null });
  });
  it('uses a wa.me link when the account gives one', () => {
    expect(contactFrom({}, null, 'https://wa.me/2348099998888').whatsapp).toBe('https://wa.me/2348099998888');
    expect(contactFrom({}, null, 'https://wa.me/2348099998888').website).toBeNull();
    expect(contactFrom({}, null, 'https://linktr.ee/kicks').website).toBe('https://linktr.ee/kicks');
  });
  it('does not mistake dates, counts or repeated digits for phone numbers', () => {
    expect(contactFrom({}, 'Since 2019-10-12 · 12,000 happy customers · 00000000000', null).phone).toBeNull();
    expect(contactFrom({}, 'est. 2015', null).phone).toBeNull();
  });
  it('finds an email in a bio and rejects a bad one', () => {
    expect(contactFrom({}, 'orders: shop@lagoskicks.com', null).email).toBe('shop@lagoskicks.com');
    expect(contactFrom({ public_email: 'not an email' }, null, null).email).toBeNull();
  });
  it('builds tel and WhatsApp only from digits, whatever the text said', () => {
    const c = contactFrom({}, 'call +234 801 234 5678"><script>', null);
    expect(c.tel).toBe('+2348012345678');
    expect(c.whatsapp).toBe('https://wa.me/2348012345678');
  });
});

describe('where an account says it is', () => {
  it('reads a business address or city field', () => {
    expect(placeFrom({ city_name: 'Surulere', address_street: '12 Adeniran Ogunsanya St' }, null)).toBe('12 Adeniran Ogunsanya St, Surulere');
  });
  it('reads a pin line in the bio', () => {
    expect(placeFrom({}, 'Sneakers\n📍 Ikeja, Lagos\nDM to order')).toBe('Ikeja, Lagos');
    expect(placeFrom({}, 'Based in Yaba | worldwide shipping')).toBe('Yaba');
  });
  it('says null when nothing is stated', () => expect(placeFrom({}, 'Best sneakers in town')).toBeNull());
  it('is read into a profile with its contact details', () => {
    const p = igProfile({ username: 'lagos_kicks', follower_count: 900, media_count: 40, biography: '📍 Yaba, Lagos\nCall +234 801 234 5678' })!;
    expect(p.location).toBe('Yaba, Lagos');
    expect(p.contact.phone).toBe('+234 801 234 5678');
  });
});

describe('what a bio or place field means for "near me"', () => {
  it('a stated place is compared to the person’s area', () => {
    expect(whereIs('Ikeja, Lagos', null, 'Yaba, Lagos')).toMatchObject({ location: 'Ikeja, Lagos', nearness: 'city' });
    expect(whereIs('Yaba', null, 'Yaba, Lagos')).toMatchObject({ nearness: 'area' });
    expect(whereIs('Abuja', null, 'Yaba, Lagos')).toMatchObject({ nearness: 'other' });
  });
  it('a bio that only mentions the city counts as the city, with no invented address', () => {
    expect(whereIs(null, 'Best sneakers in Lagos', 'Yaba, Lagos')).toMatchObject({ location: null, nearness: 'city' });
    expect(whereIs(null, 'Best sneakers', 'Yaba, Lagos')).toMatchObject({ location: null, nearness: 'unknown' });
  });
});

const xOut = {
  results: [
    { screen_name: 'ada_designs', name: 'Ada Obi', description: 'Graphic designer & brand identity. Lagos. DM or +234 802 111 2222', location: 'Lagos, Nigeria', followers_count: 5200, friends_count: 300, statuses_count: 1800, created_at: 'Wed Oct 10 20:19:24 +0000 2018', verified: false },
    { screen_name: 'newbie1', name: 'Nobody', description: '', location: '', followers_count: 3, friends_count: 900, statuses_count: 2, created_at: 'Fri Sep 25 10:00:00 +0000 2026' },
  ],
};

describe('X people', () => {
  it('reads people from a search', () => {
    const p = xPeople(xOut);
    expect(p.map((x) => x.username)).toEqual(['ada_designs', 'newbie1']);
    expect(p[0]).toMatchObject({ followers: 5200, posts: 1800, location: 'Lagos, Nigeria' });
    expect(p[0].joined?.getUTCFullYear()).toBe(2018);
    expect(p[0].contact.phone).toBe('+234 802 111 2222');
  });
  it('scores an established relevant account well and a brand-new empty one badly', () => {
    const [ada, newbie] = xPeople(xOut);
    const ask = { what: 'graphic designer', place: 'Yaba, Lagos' };
    const a = scoreX(ada, ask, 'hire', NOW);
    expect(a).toMatchObject({ platform: 'x', handle: '@ada_designs', url: 'https://x.com/ada_designs', verdict: 'solid', nearness: 'city', location: 'Lagos, Nigeria' });
    expect(scoreX(newbie, ask, 'hire', NOW).verdict).toBe('careful');
  });
  it('ranks the account that matches the request and is nearby first', () => {
    const req: ResearchRequest = { kind: 'hire', source: 'instagram', what: 'graphic designer', place: 'Yaba, Lagos' };
    const people = xPeople({ results: [{ screen_name: 'far_away', description: 'graphic designer in Oslo', location: 'Oslo', followers_count: 90000 }, { screen_name: 'close_by', description: 'Graphic designer', location: 'Yaba, Lagos', followers_count: 100 }] });
    expect(rankXPeople(people, req).map((p) => p.username)).toEqual(['close_by', 'far_away']);
  });
});

const REQ: ResearchRequest = { kind: 'hire', source: 'instagram', what: 'graphic designer', place: 'Yaba, Lagos' };
const step = (over: Partial<StepState>): StepState => ({ role: 'search', ref: null, outcome: 'PAID', priceAtomic: 7000n, ...over });

describe('the shortlist across Instagram and X', () => {
  it('buys an X people search before looking inside Instagram accounts', () => {
    const n = decideNext(REQ, [step({ output: { users: [{ username: 'a_design' }] } })]);
    expect(n).toMatchObject({ role: 'xsearch', capabilityId: SERVICE.xSearch });
  });
  it('X results alone are enough: no wider search is bought when X found people', () => {
    const steps = [step({ output: { users: [] } }), step({ role: 'xsearch', priceAtomic: 5000n, output: xOut })];
    expect(foundXPeople(steps)).toHaveLength(2);
    expect(decideNext(REQ, steps)).toEqual({ action: 'finish', reason: 'done' });
  });
  it('merges both platforms, ranks them, and shows contact details and places', () => {
    const day = 86400;
    const at = Math.floor(NOW.getTime() / 1000);
    const steps = [
      step({ output: { users: [{ username: 'ig_designer', full_name: 'IG Designer' }] } }),
      step({ role: 'xsearch', priceAtomic: 5000n, output: xOut }),
      step({ role: 'vet', ref: 'ig_designer', priceAtomic: 5000n, output: { username: 'ig_designer', biography: '📍 Surulere, Lagos\nGraphic designer · call +234 803 555 0000', follower_count: 4000, media_count: 150, is_business: true, recent_media: [{ taken_at: at - day * 2, like_count: 200, comment_count: 20 }, { taken_at: at - day * 6, like_count: 190, comment_count: 11 }, { taken_at: at - day * 9, like_count: 210, comment_count: 14 }] } }),
    ];
    const r = assemble(REQ, steps, 'done', NOW);
    expect(r.items.map((i) => i.platform).sort()).toEqual(['instagram', 'x', 'x']);
    const ig = r.items.find((i) => i.platform === 'instagram')!;
    expect(ig).toMatchObject({ location: 'Surulere, Lagos', nearness: 'city', contact: { phone: '+234 803 555 0000' } });
    expect(r.notes.join(' ')).toMatch(/only what each person published/);
    expect(r.spent).toBe('$0.017');
  });
});

describe('ranking: decent and close first', () => {
  const item = (over: Partial<ResearchItem>): ResearchItem => ({
    platform: 'instagram',
    name: 'x',
    handle: '@x',
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
    rating: null,
    prices: null,
    negotiation: null,
    ...over,
  });
  it('a nearby decent account beats a far solid one; worrying accounts come after decent ones', () => {
    const far = item({ handle: '@far', verdict: 'solid', distanceKm: 120 });
    const near = item({ handle: '@near', verdict: 'mixed', distanceKm: 2 });
    const sketchyNear = item({ handle: '@sketchy', verdict: 'careful', distanceKm: 1 });
    const unchecked = item({ handle: '@unchecked', verdict: 'unknown', nearness: 'area' });
    expect(rankItems([unchecked, sketchyNear, far, near]).map((i) => i.handle)).toEqual(['@near', '@far', '@sketchy', '@unchecked']);
  });
  it('among equally close ones the stronger verdict wins; unknown places go last', () => {
    const a = item({ handle: '@a', verdict: 'mixed', distanceKm: 3 });
    const b = item({ handle: '@b', verdict: 'solid', distanceKm: 4 });
    const c = item({ handle: '@c', verdict: 'solid', nearness: 'unknown' });
    expect(rankItems([c, a, b]).map((i) => i.handle)).toEqual(['@b', '@a', '@c']);
  });
  it('an instagram item records where it is and how it was scored', () => {
    const p = igProfile({ username: 'a', follower_count: 50, media_count: 3 })!;
    const it = scoreInstagram({ username: 'a', fullName: null, verified: null, isPrivate: null, followers: null, bio: null }, p, NOW, 'Yaba, Lagos');
    expect(it).toMatchObject({ platform: 'instagram', nearness: 'unknown', distanceKm: null });
  });
});
