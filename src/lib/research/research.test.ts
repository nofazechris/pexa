import { describe, expect, it } from 'vitest';
import { asNumber, findKey, igCandidates, igProfile, liPeople } from './read';
import { agoText, compact, scoreLinkedIn } from './score';
import { scoreInstagram } from './vendor';
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
  const media = (...days: number[]) => days.map((d) => ({ taken_at: daysAgo(d), like_count: 400, comment_count: 20 }));
  it('a busy, established, engaged shop that says what it sells looks established', () => {
    const p = igProfile({ username: 'lagos_kicks', biography: 'Sneakers in Lagos. DM to order', follower_count: 12400, media_count: 210, is_business: true, recent_media: media(2, 6, 9) })!;
    const item = scoreInstagram(cand, p, NOW, 'Lagos', 'sneakers');
    expect(item).toMatchObject({ verdict: 'solid', verdictLabel: 'Established', relevance: 'match' });
    expect(item.stats).toContain('12K followers');
    expect(item.signals.some((s) => s.tone === 'warn')).toBe(false);
  });
  it('a big page with nothing proving it is a shop does not read as established without real proof', () => {
    const p = igProfile({ username: 'x', biography: 'Sneakers', follower_count: 500, media_count: 12, recent_media: media(3, 8) })!;
    expect(scoreInstagram(cand, p, NOW, 'Lagos', 'sneakers').verdict).not.toBe('solid');
  });
  it('a dormant page with inflated followers is a risk', () => {
    const p = igProfile({ username: 'x', biography: 'Sneakers', follower_count: 50000, media_count: 4, recent_media: [{ taken_at: daysAgo(200), like_count: 12, comment_count: 0 }, { taken_at: daysAgo(210), like_count: 9, comment_count: 1 }, { taken_at: daysAgo(220), like_count: 15, comment_count: 0 }] })!;
    const item = scoreInstagram(cand, p, NOW, 'Lagos', 'sneakers');
    expect(item.verdict).toBe('careful');
    expect(item.signals.filter((s) => s.tone === 'warn').length).toBeGreaterThanOrEqual(2);
  });
  it('a private account can never read as established', () => {
    const p = igProfile({ username: 'x', biography: 'Sneakers, dm', follower_count: 9000, media_count: 80, is_private: true, is_verified: true, is_business: true, recent_media: [] })!;
    expect(scoreInstagram(cand, p, NOW, 'Lagos', 'sneakers').verdict).not.toBe('solid');
  });
  it('an account that was not looked inside is "not checked", never a verdict', () => {
    expect(scoreInstagram(cand, null, NOW, 'Lagos', 'sneakers')).toMatchObject({ verdict: 'unknown', checked: false });
  });
  it('a page that does not mention what was asked for is not a match', () => {
    const p = igProfile({ username: 'x', biography: 'Wedding photographer, Lagos', follower_count: 9000, media_count: 300 })!;
    expect(scoreInstagram({ ...cand, fullName: 'Studio X' }, p, NOW, 'Lagos', 'sneakers')).toMatchObject({ relevance: 'unrelated', skipReason: expect.stringMatching(/Doesn’t mention sneakers/) });
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
/** An X search that was paid for and found nothing. */
const X0 = step({ role: 'xsearch', priceAtomic: 5000n, output: { timeline: [] } });
const searchOut = { users: ['a', 'b', 'c', 'd', 'e'].map((u) => ({ username: u + '_kicks', full_name: u + ' kicks' })) };

describe('the plan', () => {
  it('quotes honest numbers', () => {
    expect(dollars(22000n)).toBe('$0.022');
    expect(dollars(60000n)).toBe('$0.06');
    expect(dollars(103000n)).toBe('$0.103');
    expect(describePlan(REQ)).toMatchObject({ estimate: '$0.032', cap: '$0.10' });
    expect(describePlan({ ...REQ, kind: 'hire', source: 'linkedin', what: 'graphic designer' })).toMatchObject({ estimate: '$0.108', cap: '$0.15' });
    expect(capFor(REQ)).toBeLessThanOrEqual(250_000n);
  });
  it('can only ever spend on its own services', () => {
    expect([...ALLOWED_SERVICES].sort()).toEqual(Object.values(SERVICE).sort());
  });
});

describe('deciding what to buy next', () => {
  it('starts with an Instagram search for the item and the CITY', () => {
    expect(decideNext(REQ, [])).toMatchObject({ action: 'buy', role: 'search', capabilityId: SERVICE.igSearch, input: { queryParams: { keyword: 'sneakers Lagos' } } });
    expect(decideNext({ ...REQ, place: 'Yaba, Lagos' }, [])).toMatchObject({ input: { queryParams: { keyword: 'sneakers Lagos' } } });
  });
  it('then an X search for selling posts, newest first', () => {
    expect(decideNext(REQ, [step({ output: searchOut })])).toMatchObject({ action: 'buy', role: 'xsearch', capabilityId: SERVICE.xSearch, input: { type: 'latest' } });
  });
  it('with enough accounts, looks inside the best few one by one, then stops', () => {
    const steps: StepState[] = [step({ output: searchOut }), X0];
    const seen: string[] = [];
    for (let i = 0; i < 12; i++) {
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
  it('with few accounts, searches once more under the name sellers use — but not a third time', () => {
    const few = step({ output: { users: [{ username: 'a_kicks' }] } });
    expect(decideNext(REQ, [few, X0])).toMatchObject({ role: 'fallback', input: { queryParams: { keyword: 'sneakers plug Lagos' } } });
    const next = decideNext(REQ, [few, X0, step({ role: 'fallback', output: { users: [{ username: 'b_kicks' }] } })]);
    expect(next).toMatchObject({ role: 'vet' });
  });
  it('does not spend a lookup on a page whose name says it is a cleaning or repair service', () => {
    const out = { users: [{ username: 'sneaker_laundry', full_name: 'Sneaker Laundry Lagos' }, { username: 'kicks_store', full_name: 'Kicks Store' }, { username: 'solemate', full_name: 'Sole Mate' }, { username: 'airkicks', full_name: 'Air Kicks' }] };
    const refs: string[] = [];
    const steps: StepState[] = [step({ output: out }), X0];
    for (let i = 0; i < 8; i++) {
      const n = decideNext(REQ, steps);
      if (n.action === 'finish') break;
      refs.push(n.ref!);
      steps.push(step({ role: 'vet', ref: n.ref, priceAtomic: 5000n, output: { username: n.ref } }));
    }
    expect(refs).not.toContain('sneaker_laundry');
    expect(refs).toContain('kicks_store');
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
    expect(decideNext(REQ, Array.from({ length: 8 }, () => step({})))).toEqual({ action: 'finish', reason: 'limit' });
  });
  it('LinkedIn is one search plus an X search, then done', () => {
    const li: ResearchRequest = { kind: 'hire', source: 'linkedin', what: 'graphic designer', place: 'Lagos' };
    expect(decideNext(li, [])).toMatchObject({ action: 'buy', capabilityId: SERVICE.liSearch, input: { maxResults: 5, body: { search: 'graphic designer', locations: ['Lagos'] } } });
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
  const day = 86400;
  const at = Math.floor(NOW.getTime() / 1000);
  const profile = (user: string, over: Record<string, unknown> = {}) => ({
    username: user,
    biography: 'Sneakers in Lagos. DM to order',
    follower_count: 3000,
    media_count: 120,
    is_business: true,
    recent_media: [1, 4, 8].map((d) => ({ taken_at: at - d * day, like_count: 150, comment_count: 10 })),
    ...over,
  });

  it('ranks checked accounts, says what was not checked, and totals the cost', () => {
    const steps: StepState[] = [
      step({ output: searchOut }),
      X0,
      step({ role: 'vet', ref: 'a_kicks', priceAtomic: 5000n, output: profile('a_kicks', { follower_count: 50000, media_count: 4, recent_media: [{ taken_at: at - 300 * day, like_count: 5 }, { taken_at: at - 310 * day, like_count: 4 }, { taken_at: at - 320 * day, like_count: 6 }] }) }),
      step({ role: 'vet', ref: 'b_kicks', priceAtomic: 5000n, output: profile('b_kicks') }),
    ];
    const r = assemble(REQ, steps, 'done', NOW);
    expect(r.items.map((i) => i.handle)).toEqual(['@b_kicks', '@a_kicks']);
    expect(r.items[0].verdict).toBe('solid');
    expect(r.items[1].verdict).toBe('careful');
    expect(r.spent).toBe('$0.022');
    expect(r.notes.join(' ')).toMatch(/3 more Instagram accounts/);
    expect(r.notes.join(' ')).toMatch(/Ask for proof first/);
    expect(r.summary).toMatch(/@b_kicks/);
  });
  it('never shows an account it did not look inside', () => {
    expect(assemble(REQ, [step({ output: searchOut }), X0], 'done', NOW).items).toHaveLength(0);
  });
  it('says plainly when nothing was found, when only non-sellers came up, or when a search failed', () => {
    expect(assemble(REQ, [step({ output: { users: [] } }), X0], 'done', NOW).summary).toMatch(/didn’t find anyone/);
    const notSelling = [step({ output: searchOut }), X0, step({ role: 'vet', ref: 'a_kicks', priceAtomic: 5000n, output: profile('a_kicks', { biography: 'Wedding photographer' }) })];
    expect(assemble(REQ, notSelling, 'done', NOW).summary).toMatch(/none of them actually sells it/);
    expect(assemble(REQ, [step({ outcome: 'FAILED', priceAtomic: 0n })], 'search_failed', NOW).summary).toMatch(/weren’t charged/);
  });
  it('flags an uncertain payment first', () => {
    expect(assemble(REQ, [step({ outcome: 'UNCERTAIN', output: searchOut })], 'uncertain', NOW).notes[0]).toMatch(/didn’t confirm/);
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
  it('stops instead of paying again for more searches', () => {
    expect(decideNext(REQ, [step({ output: big }), X0, step({ role: 'fallback', output: big })])).toEqual({ action: 'finish', reason: 'unreadable' });
    const li: ResearchRequest = { kind: 'hire', source: 'linkedin', what: 'graphic designer', place: 'Lagos' };
    expect(decideNext(li, [step({ output: big }), X0])).toEqual({ action: 'finish', reason: 'unreadable' });
  });
  it('says so plainly', () => {
    const r = assemble(REQ, [step({ output: big })], 'unreadable', NOW);
    expect(r.summary).toMatch(/couldn’t read it/);
    expect(r.notes[0]).toMatch(/saved under Purchases/);
  });
});
