import { describe, expect, it } from 'vitest';
import { accountKeys, assemble, decideNext, foundTikTok, type StepState } from './engine';
import { tiktokCandidates, tiktokProfile } from './read';
import type { ResearchRequest, VendorMemoryView } from './types';

const NOW = new Date('2026-10-18T12:00:00Z');
const day = 86400;
const at = Math.floor(NOW.getTime() / 1000);
const step = (over: Partial<StepState>): StepState => ({ role: 'search', ref: null, outcome: 'PAID', priceAtomic: 7000n, ...over });

// ---- the memory box feeds scores ---------------------------------------------------------------------------------------------------

const IG: ResearchRequest = { kind: 'vendors', platforms: ['instagram'], what: 'sneakers', place: 'Lagos' };
const igSteps: StepState[] = [
  step({ output: { users: [{ username: 'solid_demo', full_name: 'Solid Kicks' }] } }),
  step({
    role: 'vet',
    ref: 'solid_demo',
    priceAtomic: 5000n,
    output: { username: 'solid_demo', biography: 'Sneakers store in Lagos. POD available. DM to order', edge_followed_by: { count: 5200 }, edge_follow: { count: 90 }, is_verified: true, edge_owner_to_timeline_media: { count: 220, edges: [2, 6, 11].map((d, i) => ({ node: { id: String(i), taken_at_timestamp: at - d * day, edge_liked_by: { count: 300 }, edge_media_to_comment: { count: 12 } } })) } },
  }),
];
const withMemory = (m?: VendorMemoryView) => assemble(IG, igSteps, 'done', NOW, m ? new Map([['instagram:solid_demo', m]]) : new Map());

describe('what Pexa has learned feeds a vendor’s score', () => {
  it('an account nobody has reported keeps its score', () => {
    const base = withMemory().items[0];
    expect(base.verdictLabel).toBe('Established');
    expect(base.memory).toBeNull();
  });
  it('two scam reports make an otherwise good-looking account High risk, with the reason on the card', () => {
    const item = withMemory({ seen: 4, good: 0, bad: 0, scam: 2 }).items[0];
    expect(item.verdictLabel).toBe('High risk');
    expect(item.rating!.trust).toBeLessThanOrEqual(20);
    expect(item.signals.map((s) => s.text).join(' | ')).toMatch(/2 Pexa users reported this account as a scam/);
    expect(item.memory).toMatchObject({ scam: 2 });
  });
  it('one scam report is enough to drop it below Established', () => {
    expect(withMemory({ seen: 2, good: 0, bad: 0, scam: 1 }).items[0].verdictLabel).toBe('High risk');
  });
  it('several good reports are shown as a plus', () => {
    const item = withMemory({ seen: 3, good: 3, bad: 0, scam: 0 }).items[0];
    expect(item.signals.map((s) => s.text).join(' | ')).toMatch(/3 Pexa users found this a good lead/);
    expect(item.verdictLabel).toBe('Established');
  });
  it('lists the accounts a run touched, so their memory can be loaded', () => {
    expect(accountKeys(IG, igSteps)).toEqual([{ platform: 'instagram', handle: 'solid_demo' }]);
    expect(accountKeys({ ...IG, platforms: ['tiktok'] }, igSteps)).toEqual([]);
  });
});

// ---- TikTok ---------------------------------------------------------------------------------------------------------------------------

const ttSearch = {
  data: {
    user_list: [
      { user_info: { uid: '1', unique_id: 'tt_kicks', nickname: 'TT Kicks', signature: 'Sneakers plug in Lagos. DM to order. Pay on delivery', follower_count: 12000, verified: false } },
      { user_info: { uid: '2', unique_id: 'tt_clean', nickname: 'Clean Kicks', signature: 'Sneaker cleaning and restoration', follower_count: 3000, verified: false } },
      { user_info: { uid: '3', unique_id: 'tt_new', nickname: 'New Kicks', signature: 'Sneakers for sale', follower_count: 40, verified: false } },
    ],
  },
};
const ttProfile = (user: string, over: { followers?: number; videos?: number; created?: number; bio?: string } = {}) => ({
  data: { userInfo: { user: { uniqueId: user, nickname: user.toUpperCase(), signature: over.bio ?? 'Sneakers plug in Lagos. DM to order. Pay on delivery', verified: false, createTime: over.created ?? at - 900 * day, bioLink: { link: 'https://wa.me/2348011112222' } }, stats: { followerCount: over.followers ?? 12000, followingCount: 30, heartCount: 80000, videoCount: over.videos ?? 210 } } },
});

describe('TikTok', () => {
  it('reads accounts from a user search, with their bios and follower counts', () => {
    const c = tiktokCandidates(ttSearch);
    expect(c.map((x) => x.username)).toEqual(['tt_kicks', 'tt_clean', 'tt_new']);
    expect(c[0]).toMatchObject({ fullName: 'TT Kicks', followers: 12000, bio: expect.stringMatching(/Sneakers plug/) });
  });
  it('reads a profile onto the same shape as Instagram’s, including when the account was created', () => {
    const p = tiktokProfile(ttProfile('tt_kicks'))!;
    expect(p).toMatchObject({ username: 'tt_kicks', followers: 12000, posts: 210, verified: false });
    expect(p.createdAt?.getUTCFullYear()).toBe(2024);
    expect(p.website).toBe('https://wa.me/2348011112222');
    expect(p.contact.whatsapp).toBe('https://wa.me/2348011112222');
  });
  it('says null when the reply holds no account', () => expect(tiktokProfile({ error: 'x' })).toBeNull());

  const TT: ResearchRequest = { kind: 'vendors', platforms: ['tiktok'], what: 'sneakers', place: 'Lagos' };
  it('searches, then looks inside the promising accounts one by one — skipping the cleaning page', () => {
    const steps: StepState[] = [step({ role: 'tsearch', output: ttSearch })];
    expect(foundTikTok(steps)).toHaveLength(3);
    const refs: string[] = [];
    for (let i = 0; i < 10; i++) {
      const n = decideNext(TT, steps);
      if (n.action === 'finish') break;
      expect(n).toMatchObject({ role: 'tvet' });
      refs.push(n.ref!);
      steps.push(step({ role: 'tvet', ref: n.ref, priceAtomic: 5000n, output: ttProfile(n.ref!) }));
    }
    expect(refs.sort()).toEqual(['tt_kicks', 'tt_new']);
  });
  it('an established TikTok seller is rated Established; a tiny new one is High risk', () => {
    const steps: StepState[] = [
      step({ role: 'tsearch', output: ttSearch }),
      step({ role: 'tvet', ref: 'tt_kicks', priceAtomic: 5000n, output: ttProfile('tt_kicks') }),
      step({ role: 'tvet', ref: 'tt_new', priceAtomic: 5000n, output: ttProfile('tt_new', { followers: 40, videos: 2, created: at - 20 * day, bio: 'Sneakers for sale' }) }),
    ];
    const r = assemble(TT, steps, 'done', NOW);
    const good = r.items.find((i) => i.handle === '@tt_kicks')!;
    const bad = r.items.find((i) => i.handle === '@tt_new')!;
    expect(good).toMatchObject({ platform: 'tiktok', url: 'https://www.tiktok.com/@tt_kicks', verdictLabel: 'Established' });
    expect(good.signals.map((s) => s.text).join(' | ')).toMatch(/pay on delivery/i);
    expect(bad.verdictLabel).toBe('High risk');
    expect(bad.signals.map((s) => s.text).join(' | ')).toMatch(/Fewer than 100 followers|Only 2 videos|less than 3 months/);
    expect(r.items[0].handle).toBe('@tt_kicks');
    expect(r.skipped).toEqual([]);
  });
});
