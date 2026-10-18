import { describe, expect, it } from 'vitest';
import { advise, memoryEffect, platformYield, statDelta, type PlatformStat } from './learn';

describe('what earlier searches and feedback add to a vendor', () => {
  it('nothing known adds nothing', () => {
    expect(memoryEffect(null)).toEqual({ signals: [], flags: [] });
    expect(memoryEffect({ seen: 0, good: 0, bad: 0, scam: 0 })).toEqual({ signals: [], flags: [] });
  });
  it('a scam report caps the score hard; two cap it harder', () => {
    expect(memoryEffect({ seen: 3, good: 0, bad: 0, scam: 1 }).flags).toEqual([{ text: 'A Pexa user reported this account as a scam.', cap: 45 }]);
    expect(memoryEffect({ seen: 3, good: 1, bad: 0, scam: 2 }).flags).toEqual([{ text: '2 Pexa users reported this account as a scam.', cap: 20 }]);
  });
  it('repeated bad leads cost something, but only when they outnumber good ones', () => {
    expect(memoryEffect({ seen: 4, good: 0, bad: 2, scam: 0 }).flags[0]?.cap).toBe(60);
    expect(memoryEffect({ seen: 4, good: 3, bad: 2, scam: 0 }).flags).toEqual([]);
  });
  it('several good reports are a plus, a single one is not enough to say anything', () => {
    expect(memoryEffect({ seen: 2, good: 3, bad: 0, scam: 0 }).signals.map((s) => s.text)).toEqual(['3 Pexa users found this a good lead.', 'Came up in 2 earlier Pexa searches.']);
    expect(memoryEffect({ seen: 1, good: 1, bad: 0, scam: 0 }).signals).toEqual([]);
  });
});

const stat = (platform: string, shown: number, avg: number, over: Partial<PlatformStat> = {}): PlatformStat => ({ platform, runs: Math.ceil(shown / 4), shown, established: 0, risky: 0, ratingSum: shown * avg, ...over });

describe('what a finished search teaches about a platform', () => {
  it('counts only the accounts shown from that platform', () => {
    const items = [
      { platform: 'instagram', verdict: 'solid', rating: { overall: 90 } },
      { platform: 'instagram', verdict: 'careful', rating: { overall: 30 } },
      { platform: 'x', verdict: 'mixed', rating: { overall: 60 } },
    ];
    expect(statDelta('instagram', items)).toEqual({ platform: 'instagram', runs: 1, shown: 2, established: 1, risky: 1, ratingSum: 120 });
    expect(statDelta('tiktok', items)).toMatchObject({ runs: 1, shown: 0, ratingSum: 0 });
  });
  it('a platform with no data has no yield; a little data is pulled toward the middle', () => {
    expect(platformYield(undefined)).toBeNull();
    expect(platformYield(stat('instagram', 0, 0))).toBeNull();
    expect(platformYield(stat('instagram', 1, 100))).toBe(60); // one great seller is not proof
    expect(platformYield(stat('instagram', 40, 80))).toBe(77); // plenty of evidence counts
  });
});

describe('advising which platform to try first', () => {
  it('says nothing until a platform has enough sellers behind it', () => {
    const a = advise([stat('instagram', 3, 90)]);
    expect(a.every((x) => !x.recommended)).toBe(true);
    expect(a.find((x) => x.platform === 'instagram')?.hint).toMatch(/Averaged 4\.\d\/5 across 3 sellers/);
    expect(a.find((x) => x.platform === 'tiktok')?.hint).toBeNull();
  });
  it('recommends the platform that has clearly done best, with real numbers', () => {
    const a = advise([stat('instagram', 12, 82), stat('x', 10, 55), stat('tiktok', 6, 58)]);
    expect(a.find((x) => x.recommended)?.platform).toBe('instagram');
    expect(a.filter((x) => x.recommended)).toHaveLength(1);
  });
  it('does not pick a winner when the platforms are close', () => {
    expect(advise([stat('instagram', 12, 70), stat('tiktok', 12, 68)]).some((x) => x.recommended)).toBe(false);
  });
  it('does not recommend a platform that has only turned up weak sellers', () => {
    expect(advise([stat('instagram', 12, 45), stat('x', 12, 30)]).some((x) => x.recommended)).toBe(false);
  });
});
