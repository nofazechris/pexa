import { describe, expect, it } from 'vitest';
import { assemble, type StepState } from './engine';
import { applyRadius, applyRatings, rankByRating } from './rate';
import { mergeSameBusiness } from './dedupe';
import { measure, row, type Expectation, type Metrics } from './metrics';
import type { ResearchRequest, ResearchResult } from './types';

/**
 * The scenario report. Each scenario is a realistic search with a known right answer; the numbers are the PRD's quality measures.
 * Run `npm run research:metrics` to print the table. The thresholds are the floor: if a scoring change drops below one, either
 * the change is wrong or the threshold deserves a deliberate update.
 */
const NOW = new Date('2026-10-18T12:00:00Z');
const day = 86400;
const at = Math.floor(NOW.getTime() / 1000);
const step = (over: Partial<StepState>): StepState => ({ role: 'search', ref: null, outcome: 'PAID', priceAtomic: 7000n, ...over });

const igAccount = (username: string, name: string, bio: string, followers: number, posts: number, opts: { verified?: boolean } = {}) => ({
  username,
  biography: bio,
  full_name: name,
  edge_followed_by: { count: followers },
  edge_follow: { count: 80 },
  is_verified: opts.verified ?? false,
  is_professional_account: true,
  edge_owner_to_timeline_media: {
    count: posts,
    edges: posts
      ? [3, 9, 17, 30].map((d, i) => ({
          node: { id: String(i), taken_at_timestamp: at - d * day, edge_liked_by: { count: 90 }, edge_media_to_comment: { count: 7 }, edge_media_to_caption: { edges: [{ node: { text: i === 0 ? 'Fresh stock. Air Force 1 sneakers 45,000 naira. DM to order' : '' } }] } },
        }))
      : [],
  },
});
const search = (accts: { username: string; full_name: string }[]) => ({ data: { count: accts.length, items: accts.map((a) => ({ username: a.username, full_name: a.full_name, is_private: false, is_verified: false })) } });
const vetStep = (u: string, output: object) => step({ role: 'vet', ref: u, priceAtomic: 5000n, output });

interface Scenario {
  name: string;
  req: ResearchRequest;
  steps: StepState[];
  expect: Expectation;
  /** Work done after assembling: distances, a radius, merging. */
  after?: (r: ResearchResult) => ResearchResult;
  floor: { precisionAt5: number; recall: number };
}

const lagos: ResearchRequest = { kind: 'vendors', platforms: ['instagram'], what: 'sneakers', place: 'Lagos' };

const good1 = igAccount('kicks_one', 'Kicks One', 'Sneakers store in Lagos. POD available. DM to order. 08011112222', 5200, 220, { verified: true });
const good2 = igAccount('step_two', 'Step Two', 'Authentic sneakers. Same day delivery in Lagos. Pay on delivery', 3100, 140);
const good3 = igAccount('sole_three', 'Sole Three', 'Sneakers for sale. Lagos delivery. Order via DM', 1800, 90);
const cleaner = igAccount('sparkle_clean', 'Sparkle Sneaker Cleaning', 'Sneaker cleaning and restoration service. Book a wash', 2500, 80);
const empty = igAccount('ghost_kicks', 'SNEAKERS PLUG IN LAGOS', 'Old account disabled @ghost_old', 68, 0);
const listed = (...a: { username: string; full_name: string }[]) => search(a);

const scenarios: Scenario[] = [
  {
    name: 'sneakers in Lagos (mixed results)',
    req: lagos,
    steps: [step({ output: listed(good1, good2, good3, cleaner, empty) }), ...[good1, good2, good3, cleaner, empty].map((a) => vetStep(a.username, a))],
    expect: { relevant: ['kicks_one', 'step_two', 'sole_three'], mustNotShow: ['sparkle_clean'], mustNotBeEstablished: ['ghost_kicks'] },
    floor: { precisionAt5: 0.75, recall: 1 },
  },
  {
    name: 'only an empty page found',
    req: lagos,
    steps: [step({ output: listed(empty) }), vetStep(empty.username, empty)],
    expect: { relevant: [], mustNotBeEstablished: ['ghost_kicks'] },
    // The page may be shown, but flagged: the real check here is that it is never called Established.
    floor: { precisionAt5: 0, recall: 1 },
  },
  {
    name: 'radius 5 km respected',
    req: { ...lagos, radiusKm: 5 },
    steps: [step({ output: listed(good1, good2, good3) }), ...[good1, good2, good3].map((a) => vetStep(a.username, a))],
    expect: { relevant: ['kicks_one', 'step_two'], radiusKm: 5 },
    after: (r) => {
      const dist: Record<string, number> = { '@kicks_one': 1.2, '@step_two': 4.1, '@sole_three': 22 };
      const items = r.items.map((i) => ({ ...i, distanceKm: dist[i.handle ?? ''] ?? null }));
      const within = applyRadius(applyRatings(items, { what: 'sneakers', place: 'Lagos', kind: 'vendors' }).items, 5);
      return { ...r, items: rankByRating(within.items) };
    },
    floor: { precisionAt5: 1, recall: 1 },
  },
  {
    name: 'same shop on two platforms',
    req: { ...lagos, platforms: ['instagram', 'tiktok'] },
    steps: [
      step({ output: listed(good1) }),
      vetStep(good1.username, good1),
      step({ role: 'tsearch', output: { data: { user_list: [{ user_info: { uid: '1', unique_id: 'kicks_one_tt', nickname: 'Kicks One', signature: 'Sneakers store in Lagos. 08011112222', follower_count: 9000, verified: false } }] } } }),
      step({
        role: 'tvet',
        ref: 'kicks_one_tt',
        priceAtomic: 5000n,
        output: { data: { userInfo: { user: { uniqueId: 'kicks_one_tt', nickname: 'Kicks One', signature: 'Sneakers store in Lagos. Call 08011112222. POD available', verified: false, createTime: at - 700 * day }, stats: { followerCount: 9000, followingCount: 40, heartCount: 50000, videoCount: 120 } } } },
      }),
    ],
    expect: { relevant: ['kicks_one', 'kicks_one_tt'] },
    after: (r) => ({ ...r, items: mergeSameBusiness(r.items) }),
    floor: { precisionAt5: 0.5, recall: 0.5 },
  },
];

const table: string[] = [];
describe('research quality scenarios', () => {
  for (const s of scenarios) {
    it(s.name, () => {
      let result = assemble(s.req, s.steps, 'done', NOW);
      if (s.after) result = s.after(result);
      const paid = s.steps.filter((x) => x.outcome === 'PAID');
      const m: Metrics = measure(result, s.expect, paid.length, paid.reduce((a, x) => a + x.priceAtomic, 0n));
      table.push(row(s.name, m));
      expect(m.precisionAt5).toBeGreaterThanOrEqual(s.floor.precisionAt5);
      expect(m.recall).toBeGreaterThanOrEqual(s.floor.recall);
      expect(m.leaked).toBe(0);
      expect(m.geoViolations).toBe(0);
      expect(m.unsupportedClaims).toBe(0);
      expect(m.duplicates).toBe(0);
    });
  }
  it('prints the report', () => {
    console.log('\nResearch quality report\n' + table.join('\n') + '\n');
    expect(table.length).toBe(scenarios.length);
  });
});
