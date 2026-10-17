import { describe, expect, it } from 'vitest';
import { asNumber, findKey, igCandidates, igProfile, liPeople } from './read';
import { agoText, compact, scoreInstagram, scoreLinkedIn } from './score';
import { ALLOWED_SERVICES, MAX_CHECKS, SERVICE, assemble, capFor, decideNext, describePlan, dollars, rankCandidates, type StepState } from './engine';
import type { ResearchRequest } from './types';

const NOW = new Date('2026-10-16T12:00:00Z');
const daysAgo = (n: number) => Math.floor((NOW.getTime() - n * 86_400_000) / 1000);

describe('readers', () => {
  it('finds a field under different spellings and nesting', () => {
    expect(findKey({ data: { user: { follower_count: 5 } } }, ['followerCount'])).toBe(5);
    expect(findKey({ a: [{ followerCount: 9 }] }, ['followerCount'])).toBeUndefined(); // arrays are not entered
  });
  it.each([[1234, 1234], ['12.5K', 12500], ['3M', 3_000_000], ['1,204', 1204], [{ count: 77 }, 77], ['n/a', null], [null, null]])('asNumber(%j) → %j', (v, want) => expect(asNumber(v)).toBe(want));

  it('reads candidates from a search whose items are wrapped, without duplicates', () => {
    const out = { data: { users: [{ user: { username: 'Lagos_Kicks', full_name: 'Lagos Kicks', is_verified: false, is_private: false } }, { user: { username: 'kicks_ng', full_name: 'Kicks NG', is_private: true } }, { user: { username: 'lagos_kicks' } }] } };
    const c = igCandidates(out);
    expect(c.map((x) => x.username)).toEqual(['lagos_kicks', 'kicks_ng']);
    expect(c[1].isPrivate).toBe(true);
  });
  it('reads no candidates from a reply with no accounts', () => {
    expect(igCandidates({ message: 'nothing' })).toEqual([]);
    expect(igCandidates(null)).toEqual([]);
  });

  it('reads a profile in the common field names', () => {
    const p = igProfile({ data: { user: { username: 'lagos_kicks', full_name: 'Lagos Kicks', biography: 'Sneakers. Order via WhatsApp +234 801 234 5678', follower_count: 12400, following_count: 300, media_count: 210, is_verified: false, is_business: true, category: 'Shoe store', recent_media: [{ taken_at: daysAgo(3), like_count: 400, comment_count: 20 }, { taken_at: daysAgo(10), like_count: 380, comment_count: 14 }] } } });
    expect(p).toMatchObject({ username: 'lagos_kicks', followers: 12400, posts: 210, business: true, category: 'Shoe store' });
    expect(p?.recent).toHaveLength(2);
    expect(p?.recent[0].at).toBeInstanceOf(Date);
  });
  it('reads GraphQL-style counts', () => {
    const p = igProfile({ username: 'a', edge_followed_by: { count: 5000 }, edge_owner_to_timeline_media: { count: 40 } });
    expect(p).toMatchObject({ followers: 5000, posts: 40 });
  });
  it('says null when the reply is not a profile', () => expect(igProfile({ error: 'not found' })).toBeNull());

  it('reads LinkedIn people', () => {
    const p = liPeople({ items: [{ firstName: 'Ada', lastName: 'Obi', headline: 'Graphic Designer · Brand identity', location: { linkedinText: 'Lagos, Nigeria' }, linkedinUrl: 'https://www.linkedin.com/in/adaobi', connectionsCount: 612, about: 'I design logos and brand systems for small businesses across West Africa.', experience: [{}, {}, {}] }, { name: 'No Link', headline: 'x' }] });
    expect(p[0]).toMatchObject({ name: 'Ada Obi', location: 'Lagos, Nigeria', connections: 612, experienceCount: 3, url: 'https://www.linkedin.com/in/adaobi' });
    expect(p).toHaveLength(2);
  });
  it('ignores a non-LinkedIn url', () => {
    expect(liPeople([{ name: 'Z', headline: 'h', url: 'https://evil.example/in/z' }])[0].url).toBeNull();
  });
});

describe('scoring', () => {
  it('formats counts and time', () => {
    expect([compact(950), compact(1200), compact(12400), compact(1_500_000)]).toEqual(['950', '1.2K', '12K', '1.5M']);
    expect(agoText(new Date(NOW.getTime() - 3 * 86_400_000), NOW)).toBe('3 days ago');
    expect(agoText(new Date(NOW.getTime() - 100 * 86_400_000), NOW)).toBe('3 months ago');
  });

  const cand = { username: 'lagos_kicks', fullName: 'Lagos Kicks', verified: null, isPrivate: null, followers: null, bio: null };
  it('a busy, established, engaged business looks solid', () => {
    const p = igProfile({ username: 'lagos_kicks', biography: 'DM to order', follower_count: 12400, media_count: 210, is_business: true, recent_media: [{ taken_at: daysAgo(2), like_count: 400, comment_count: 20 }, { taken_at: daysAgo(6), like_count: 380, comment_count: 14 }, { taken_at: daysAgo(9), like_count: 420, comment_count: 30 }] })!;
    const item = scoreInstagram(cand, p, NOW);
    expect(item.verdict).toBe('solid');
    expect(item.stats).toContain('12K followers');
    expect(item.signals.some((s) => s.tone === 'warn')).toBe(false);
  });
  it('a dormant page with inflated followers is flagged', () => {
    const p = igProfile({ username: 'x', follower_count: 50000, media_count: 4, recent_media: [{ taken_at: daysAgo(200), like_count: 12, comment_count: 0 }, { taken_at: daysAgo(210), like_count: 9, comment_count: 1 }, { taken_at: daysAgo(220), like_count: 15, comment_count: 0 }] })!;
    const item = scoreInstagram(cand, p, NOW);
    expect(item.verdict).toBe('careful');
    expect(item.signals.filter((s) => s.tone === 'warn').length).toBeGreaterThanOrEqual(2);
  });
  it('a private account can never read as solid', () => {
    const p = igProfile({ username: 'x', follower_count: 9000, media_count: 80, is_private: true, is_verified: true, is_business: true, biography: 'dm', recent_media: [] })!;
    expect(scoreInstagram(cand, p, NOW).verdict).not.toBe('solid');
  });
  it('an account that was not looked inside is "not checked", never a verdict', () => {
    const item = scoreInstagram(cand, null, NOW);
    expect(item).toMatchObject({ verdict: 'unknown', checked: false });
  });

  it('LinkedIn: a relevant local profile is a strong match; an off-topic one is weak', () => {
    const [good, off] = liPeople([
      { name: 'Ada Obi', headline: 'Graphic Designer', location: 'Lagos, Nigeria', url: 'https://linkedin.com/in/a', connectionsCount: 800, about: 'I design logos and brand identity for small businesses across the region.', experience: [{}, {}] },
      { name: 'Bo', headline: 'Accountant', location: 'Oslo', url: 'https://linkedin.com/in/b', connectionsCount: 10, experience: [] },
    ]);
    const ask = { what: 'graphic designer', place: 'Lagos' };
    expect(scoreLinkedIn(good, ask).verdict).toBe('solid');
    expect(scoreLinkedIn(off, ask).verdict).toBe('careful');
  });
});

const REQ: ResearchRequest = { kind: 'vendors', source: 'instagram', what: 'sneakers', place: 'Lagos' };
const step = (over: Partial<StepState>): StepState => ({ role: 'search', ref: null, outcome: 'PAID', priceAtomic: 7000n, ...over });
/** An X people search that was paid for and found nobody. */
const X0 = step({ role: 'xsearch', priceAtomic: 5000n, output: { results: [] } });
const searchOut = { users: ['a', 'b', 'c', 'd'].map((u) => ({ username: u + '_kicks', full_name: u + ' kicks' })) };

describe('the plan', () => {
  it('quotes honest numbers', () => {
    expect(dollars(22000n)).toBe('$0.022');
    expect(dollars(60000n)).toBe('$0.06');
    expect(dollars(103000n)).toBe('$0.103');
    const p = describePlan(REQ);
    expect(p).toMatchObject({ estimate: '$0.027', cap: '$0.08' });
    expect(describePlan({ ...REQ, kind: 'hire', source: 'linkedin', what: 'graphic designer' })).toMatchObject({ estimate: '$0.108', cap: '$0.15' });
    expect(capFor(REQ)).toBeLessThanOrEqual(250_000n);
  });
  it('can only ever spend on its own services', () => {
    expect([...ALLOWED_SERVICES].sort()).toEqual(Object.values(SERVICE).sort());
  });
});

describe('deciding what to buy next', () => {
  it('starts with a search that names the place', () => {
    const n = decideNext(REQ, []);
    expect(n).toMatchObject({ action: 'buy', role: 'search', capabilityId: SERVICE.igSearch, input: { queryParams: { keyword: 'sneakers Lagos' } } });
  });
  it('after the Instagram search comes an X people search for the same words', () => {
    const n = decideNext(REQ, [step({ output: searchOut })]);
    expect(n).toMatchObject({ action: 'buy', role: 'xsearch', capabilityId: SERVICE.xSearch, input: { query: 'sneakers Lagos', type: 'people' } });
  });
  it('the place is searched as written, commas removed', () => {
    const n = decideNext({ ...REQ, place: 'Yaba, Lagos' }, []);
    expect(n).toMatchObject({ input: { queryParams: { keyword: 'sneakers Yaba Lagos' } } });
  });
  it('then looks inside the best few accounts one by one, then stops', () => {
    const steps: StepState[] = [step({ output: searchOut }), X0];
    const seen: string[] = [];
    for (let i = 0; i < 10; i++) {
      const n = decideNext(REQ, steps);
      if (n.action === 'finish') {
        expect(n.reason).toBe('done');
        break;
      }
      expect(n).toMatchObject({ role: 'vet', capabilityId: SERVICE.igProfile });
      seen.push(n.ref!);
      steps.push(step({ role: 'vet', ref: n.ref, priceAtomic: 5000n, output: { username: n.ref, follower_count: 100 } }));
    }
    expect(seen).toHaveLength(MAX_CHECKS);
    expect(new Set(seen).size).toBe(MAX_CHECKS);
  });
  it('tries one wider search if the first found nobody, but not a third', () => {
    const empty = step({ output: { users: [] } });
    const n = decideNext(REQ, [empty, X0]);
    expect(n).toMatchObject({ role: 'fallback', capabilityId: SERVICE.igGeneral });
    expect(decideNext(REQ, [empty, X0, step({ role: 'fallback', output: { users: [] } })])).toEqual({ action: 'finish', reason: 'done' });
  });
  it('gives up cleanly when searches failed', () => {
    const f = step({ outcome: 'FAILED', priceAtomic: 0n });
    expect(decideNext(REQ, [f, X0, { ...f, role: 'fallback' }])).toEqual({ action: 'finish', reason: 'search_failed' });
  });
  it('a vet that failed is skipped, not retried', () => {
    const steps: StepState[] = [step({ output: searchOut }), X0, step({ role: 'vet', ref: 'a_kicks', outcome: 'FAILED', priceAtomic: 0n })];
    const n = decideNext(REQ, steps);
    expect(n).toMatchObject({ role: 'vet' });
    expect((n as { ref: string }).ref).not.toBe('a_kicks');
  });
  it('stops at once if any payment is uncertain, and at the purchase limit', () => {
    expect(decideNext(REQ, [step({ outcome: 'UNCERTAIN' })])).toEqual({ action: 'finish', reason: 'uncertain' });
    expect(decideNext(REQ, Array.from({ length: 7 }, () => step({})))).toEqual({ action: 'finish', reason: 'limit' });
  });
  it('LinkedIn is one search plus an X people search, then done', () => {
    const li: ResearchRequest = { kind: 'hire', source: 'linkedin', what: 'graphic designer', place: 'Lagos' };
    const n = decideNext(li, []);
    expect(n).toMatchObject({ action: 'buy', capabilityId: SERVICE.liSearch, input: { maxResults: 5, body: { search: 'graphic designer', locations: ['Lagos'] } } });
    expect(decideNext(li, [step({})])).toMatchObject({ action: 'buy', role: 'xsearch' });
    expect(decideNext(li, [step({}), X0])).toEqual({ action: 'finish', reason: 'done' });
  });
  it('ranks public, relevant, verified accounts first', () => {
    const r = rankCandidates(
      [
        { username: 'private_one', fullName: 'sneakers', verified: null, isPrivate: true, followers: null, bio: null },
        { username: 'random', fullName: 'Random', verified: null, isPrivate: false, followers: null, bio: null },
        { username: 'sneaker_plug', fullName: 'Sneaker Plug', verified: null, isPrivate: false, followers: null, bio: null },
      ],
      'sneakers',
    );
    expect(r.map((c) => c.username)).toEqual(['sneaker_plug', 'random', 'private_one']);
  });
});

describe('the answer', () => {
  it('ranks checked accounts, says what was not checked, and totals the cost', () => {
    const steps: StepState[] = [
      step({ output: searchOut }),
      X0,
      step({ role: 'vet', ref: 'a_kicks', priceAtomic: 5000n, output: { username: 'a_kicks', follower_count: 50000, media_count: 3, recent_media: [{ taken_at: daysAgo(300), like_count: 5 }, { taken_at: daysAgo(310), like_count: 4 }, { taken_at: daysAgo(320), like_count: 6 }] } }),
      step({ role: 'vet', ref: 'b_kicks', priceAtomic: 5000n, output: { username: 'b_kicks', biography: 'DM to order', follower_count: 3000, media_count: 120, is_business: true, recent_media: [{ taken_at: daysAgo(1), like_count: 150, comment_count: 12 }, { taken_at: daysAgo(4), like_count: 160, comment_count: 9 }, { taken_at: daysAgo(8), like_count: 140, comment_count: 8 }] } }),
    ];
    const r = assemble(REQ, steps, 'done', NOW);
    expect(r.items.map((i) => i.handle)).toEqual(['@b_kicks', '@a_kicks']);
    expect(r.items[0].verdict).toBe('solid');
    expect(r.items[1].verdict).toBe('careful');
    expect(r.spent).toBe('$0.022');
    expect(r.notes.join(' ')).toMatch(/2 more Instagram accounts/);
    expect(r.notes.join(' ')).toMatch(/Ask for proof first/);
    expect(r.summary).toMatch(/@b_kicks/);
  });
  it('never claims a verdict for an account it did not look inside', () => {
    const r = assemble(REQ, [step({ output: searchOut })], 'done', NOW);
    expect(r.items).toHaveLength(0);
  });
  it('says plainly when nothing was found or a search failed', () => {
    expect(assemble(REQ, [step({ output: { users: [] } })], 'done', NOW).summary).toMatch(/didn’t find anyone/);
    expect(assemble(REQ, [step({ outcome: 'FAILED', priceAtomic: 0n })], 'search_failed', NOW).summary).toMatch(/weren’t charged/);
  });
  it('flags an uncertain payment first', () => {
    const r = assemble(REQ, [step({ outcome: 'UNCERTAIN', output: searchOut })], 'uncertain', NOW);
    expect(r.notes[0]).toMatch(/didn’t confirm/);
  });
  it('LinkedIn results are matched to what was asked', () => {
    const li: ResearchRequest = { kind: 'hire', source: 'linkedin', what: 'graphic designer', place: 'Lagos' };
    const out = [{ name: 'Ada Obi', headline: 'Graphic Designer', location: 'Lagos, Nigeria', url: 'https://linkedin.com/in/a', connectionsCount: 800, about: 'I design logos and brand identity for small businesses across the region.', experience: [{}, {}] }];
    const r = assemble(li, [step({ priceAtomic: 103000n, output: out })], 'done', NOW);
    expect(r.items[0]).toMatchObject({ name: 'Ada Obi', verdict: 'solid', verdictLabel: 'Strong match' });
    expect(r.spent).toBe('$0.103');
  });
});

import { normalizeRequest } from './request';

describe('normalizeRequest', () => {
  it('tidies the place and picks the source', () => {
    expect(normalizeRequest({ kind: 'vendors', what: ' sneakers ', place: 'lagos' })).toEqual({ ok: true, request: { kind: 'vendors', source: 'instagram', what: 'sneakers', place: 'Lagos' } });
    expect(normalizeRequest({ kind: 'hire', what: 'graphic designer', place: 'abuja nigeria' })).toEqual({ ok: true, request: { kind: 'hire', source: 'linkedin', what: 'graphic designer', place: 'Abuja Nigeria' } });
    expect(normalizeRequest({ kind: 'hire', source: 'instagram', what: 'tailor', place: 'Yaba' })).toMatchObject({ ok: true, request: { source: 'instagram' } });
  });
  it('sellers are always looked up on Instagram, whatever the model says', () => {
    expect(normalizeRequest({ kind: 'vendors', source: 'linkedin', what: 'phones', place: 'Lagos' })).toMatchObject({ ok: true, request: { source: 'instagram' } });
  });
  it('asks for what is missing instead of guessing', () => {
    expect(normalizeRequest({ kind: 'hire', what: 'designer', place: '  ' })).toMatchObject({ ok: false, message: expect.stringMatching(/city/i) });
    expect(normalizeRequest({ kind: 'vendors', what: '', place: 'Lagos' })).toMatchObject({ ok: false });
  });
  it('strips control characters and clips length', () => {
    const r = normalizeRequest({ kind: 'vendors', what: 'sneakers\u0007\nplease', place: 'Lagos' });
    expect(r.ok && r.request.what).toBe('sneakers please');
    expect(normalizeRequest({ kind: 'vendors', what: 'x'.repeat(300), place: 'Lagos' })).toMatchObject({ ok: true });
  });
});

describe('an answer that cannot be read', () => {
  const big = { data: { something: 'x'.repeat(400) } };
  it('stops instead of paying again for a wider search', () => {
    expect(decideNext(REQ, [step({ output: big }), X0])).toEqual({ action: 'finish', reason: 'unreadable' });
    const li: ResearchRequest = { kind: 'hire', source: 'linkedin', what: 'graphic designer', place: 'Lagos' };
    expect(decideNext(li, [step({ output: big }), X0])).toEqual({ action: 'finish', reason: 'unreadable' });
  });
  it('but a genuinely empty answer still gets the one wider search', () => {
    expect(decideNext(REQ, [step({ output: { users: [] } }), X0])).toMatchObject({ action: 'buy', role: 'fallback' });
  });
  it('says so plainly', () => {
    const r = assemble(REQ, [step({ output: big })], 'unreadable', NOW);
    expect(r.summary).toMatch(/couldn’t read it/);
    expect(r.notes[0]).toMatch(/saved under Purchases/);
  });
});
