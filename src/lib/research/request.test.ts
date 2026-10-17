import { describe, expect, it } from 'vitest';
import { normalizeRequest } from './request';

const source = (what: string, model?: string) => {
  const r = normalizeRequest({ kind: 'hire', what, place: 'Lagos', source: model });
  return r.ok ? r.request.source : 'rejected';
};

describe('a place that is not a place', () => {
  it.each(['me', 'near me', 'Near Me', 'closest to me', 'nearby', 'here', 'my area', 'around me', 'where I am'])('"%s" is not usable: the person is asked where they are', (place) => {
    const r = normalizeRequest({ kind: 'hire', what: 'designer', place });
    expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/city or area/i) });
  });
  it('real places still pass', () => {
    expect(normalizeRequest({ kind: 'hire', what: 'designer', place: 'Yaba, Lagos' })).toMatchObject({ ok: true });
    expect(normalizeRequest({ kind: 'hire', what: 'designer', place: 'near Yaba' })).toMatchObject({ ok: true });
  });
});

describe('where people to hire are looked up', () => {
  it.each(['tailor', 'a good seamstress', 'braider', 'makeup artist', 'photographer', 'caterer', 'barber', 'fashion designer', 'plumber', 'DJ', 'hair stylist'])('%s → Instagram, whatever the model says', (what) => {
    expect(source(what, 'linkedin')).toBe('instagram');
    expect(source(what)).toBe('instagram');
  });
  it.each(['software developer', 'accountant', 'marketing manager', 'virtual assistant', 'graphic designer'])('%s → the model’s choice, LinkedIn by default', (what) => {
    expect(source(what)).toBe('linkedin');
    expect(source(what, 'instagram')).toBe('instagram');
  });
});
