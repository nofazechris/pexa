import { describe, expect, it } from 'vitest';
import { normalizeRequest } from './request';

const platforms = (what: string, given?: string[]) => {
  const r = normalizeRequest({ kind: 'hire', what, place: 'Lagos', platforms: given });
  return r.ok ? r.request.platforms : 'rejected';
};

describe('where people to hire are looked up', () => {
  it.each(['tailor', 'a good seamstress', 'braider', 'makeup artist', 'photographer', 'caterer', 'barber', 'fashion designer', 'plumber', 'DJ', 'hair stylist'])('%s → Instagram, never LinkedIn, whatever the model says', (what) => {
    expect(platforms(what, ['linkedin'])).toEqual(['instagram']);
    expect(platforms(what)).toEqual(['instagram']);
  });
  it.each(['software developer', 'accountant', 'marketing manager', 'virtual assistant', 'graphic designer'])('%s → LinkedIn by default, or what the person named', (what) => {
    expect(platforms(what)).toEqual(['linkedin']);
    expect(platforms(what, ['instagram'])).toEqual(['instagram']);
  });
});

describe('a place that is not a place', () => {
  it.each(['me', 'near me', 'Near Me', 'closest to me', 'nearby', 'here', 'my area', 'around me', 'where I am'])('"%s" is not usable: the person is asked where they are', (place) => {
    expect(normalizeRequest({ kind: 'hire', what: 'designer', place })).toMatchObject({ ok: false, missing: 'place', message: expect.stringMatching(/city or area/i) });
  });
  it('real places still pass', () => {
    expect(normalizeRequest({ kind: 'hire', what: 'designer', place: 'Yaba, Lagos' })).toMatchObject({ ok: true });
    expect(normalizeRequest({ kind: 'hire', what: 'designer', place: 'near Yaba' })).toMatchObject({ ok: true });
  });
});
