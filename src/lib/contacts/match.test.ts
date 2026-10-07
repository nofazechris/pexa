import { describe, expect, it } from 'vitest';
import { label, lastSeen, resolvePerson, sortPeople, type Person } from './match';

const p = (username: string, over: Partial<Person> = {}): Person => ({ username, displayName: null, uid: null, relation: 'user', saved: false, lastAt: null, direction: null, ...over });
const NOW = Date.parse('2026-10-07T12:00:00Z');

describe('resolvePerson', () => {
  const joyful = p('joyful', { uid: 'PX3STC3A', relation: 'recent', lastAt: '2026-10-04T10:00:00Z', direction: 'sent' });
  const chris = p('chris', { uid: 'PXAY2KWJ', relation: 'recent', saved: true, lastAt: '2026-10-06T10:00:00Z', direction: 'received' });
  const chris2 = p('chris_ng', { uid: 'PXZZ7K2M', relation: 'recent', lastAt: '2026-09-01T10:00:00Z', direction: 'sent' });

  it('takes an exact username as written, with or without @', () => {
    for (const q of ['joyful', '@joyful', ' @JOYFUL ']) expect(resolvePerson(q, [joyful], [])).toMatchObject({ kind: 'one', how: 'exact', person: { username: 'joyful' } });
  });

  it('finds someone by UID, case-insensitively', () => {
    expect(resolvePerson('px3stc3a', [joyful], [])).toMatchObject({ kind: 'one', how: 'uid', person: { username: 'joyful' } });
    expect(resolvePerson('PXAAAAAA', [joyful], [])).toEqual({ kind: 'none', similar: [] });
  });

  it('an exact username wins even when others merely resemble it', () => {
    expect(resolvePerson('chris', [chris, chris2], [])).toMatchObject({ kind: 'one', how: 'exact', person: { username: 'chris' } });
  });

  it('a partial name that fits exactly one person you know → that person (flagged as "known", so the card can say so)', () => {
    expect(resolvePerson('joy', [joyful, chris], [])).toMatchObject({ kind: 'one', how: 'known', person: { username: 'joyful' } });
  });

  it('matches a display name too', () => {
    const amaka = p('amk_77', { displayName: 'Amaka Obi', relation: 'recent' });
    expect(resolvePerson('amaka', [amaka], [])).toMatchObject({ kind: 'one', how: 'known', person: { username: 'amk_77' } });
  });

  it('two people you know both fit → never guesses, returns both (saved first)', () => {
    const r = resolvePerson('chr', [chris2, chris], []);
    expect(r.kind).toBe('many');
    if (r.kind === 'many') expect(r.people.map((x) => x.username)).toEqual(['chris', 'chris_ng']);
  });

  it('a stranger who only looks similar is OFFERED, never assumed', () => {
    const r = resolvePerson('joyfu', [], [p('joyful', { uid: 'PX3STC3A' })]);
    expect(r).toEqual({ kind: 'none', similar: [expect.objectContaining({ username: 'joyful' })] });
  });

  it('someone you know beats a stranger with a similar name', () => {
    expect(resolvePerson('joy', [joyful], [p('joyce'), p('joystick')])).toMatchObject({ kind: 'one', person: { username: 'joyful' } });
  });

  it('nothing matches → nothing, and a one-letter query matches nothing', () => {
    expect(resolvePerson('zzzz', [joyful], [])).toEqual({ kind: 'none', similar: [] });
    expect(resolvePerson('j', [joyful], [])).toEqual({ kind: 'none', similar: [] });
    expect(resolvePerson('', [joyful], [])).toMatchObject({ kind: 'none' });
  });

  it('the same person from two sources is one person (saved info is kept)', () => {
    const savedJoy = p('joyful', { uid: 'PX3STC3A', saved: true, relation: 'saved' });
    const r = resolvePerson('joyful', [joyful, savedJoy], [p('joyful')]);
    expect(r).toMatchObject({ kind: 'one', person: { saved: true } });
  });
});

describe('sorting and wording', () => {
  it('saved first, then most recent, then alphabetical', () => {
    const order = sortPeople([p('zed', { lastAt: '2026-10-06T00:00:00Z' }), p('amy', { lastAt: '2026-10-01T00:00:00Z' }), p('bob', { saved: true }), p('cat')]).map((x) => x.username);
    expect(order).toEqual(['bob', 'zed', 'amy', 'cat']);
  });
  it('label shows the UID that tells similar names apart', () => {
    expect(label({ username: 'chris', uid: 'PXAY2KWJ' })).toBe('@chris (PXAY2KWJ)');
    expect(label({ username: 'chris', uid: null })).toBe('@chris');
  });
  it('lastSeen reads like a person would say it', () => {
    expect(lastSeen({ lastAt: '2026-10-07T01:00:00Z', direction: 'sent' }, NOW)).toBe('you paid them today');
    expect(lastSeen({ lastAt: '2026-10-06T08:00:00Z', direction: 'received' }, NOW)).toBe('they paid you yesterday');
    expect(lastSeen({ lastAt: '2026-10-03T08:00:00Z', direction: 'sent' }, NOW)).toBe('you paid them 4 days ago');
    expect(lastSeen({ lastAt: null, direction: null }, NOW)).toBe('');
  });
});
