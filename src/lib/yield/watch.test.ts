import { describe, expect, it } from 'vitest';
import { ALERT_COOLDOWN_MS, detectChanges, sinceText, withoutRecent, type Snapshot } from './watch';

const REF: Snapshot = { apyBase: 0.24, apyReward: 5.84, tvlUsd: 1_600_000 };
const label = 'USD₮ on aave-v3 (Celo)';
const run = (now: Snapshot | null, targetApy: number | null = null, ref = REF) => detectChanges(ref, now, { label, targetApy });
const kinds = (a: ReturnType<typeof run>) => a.map((x) => x.kind);

describe('what is worth telling the person', () => {
  it('nothing for a quiet pool', () => {
    expect(run({ apyBase: 0.3, apyReward: 5.5, tvlUsd: 1_550_000 })).toEqual([]);
  });
  it('a big move in what it pays steadily, up or down', () => {
    expect(kinds(run({ apyBase: 2.4, apyReward: 5.84, tvlUsd: 1_600_000 }))).toEqual(['rate_up']);
    expect(kinds(run({ apyBase: 0.5, apyReward: 5.84, tvlUsd: 1_600_000 }, null, { ...REF, apyBase: 2 }))).toEqual(['rate_down']);
  });
  it('a small wobble on a tiny rate is not worth a message', () => {
    expect(run({ apyBase: 0.9, apyReward: 5.84, tvlUsd: 1_600_000 })).toEqual([]);
  });
  it('rewards ending, with what it does to the headline', () => {
    const a = run({ apyBase: 0.24, apyReward: 0, tvlUsd: 1_600_000 });
    expect(kinds(a)).toEqual(['rewards_ended']);
    expect(a[0].detail).toMatch(/from about 6\.08% to 0\.24%/);
    expect(a[0].title).toMatch(/ended/);
  });
  it('new rewards starting', () => {
    expect(kinds(run({ apyBase: 0.5, apyReward: 3, tvlUsd: 1_000_000 }, null, { apyBase: 0.5, apyReward: 0, tvlUsd: 1_000_000 }))).toEqual(['rewards_started']);
  });
  it('money leaving the pool', () => {
    const a = run({ apyBase: 0.24, apyReward: 5.84, tvlUsd: 900_000 });
    expect(kinds(a)).toEqual(['tvl_drop']);
    expect(a[0].title).toMatch(/fell 44%/);
  });
  it('reaching the rate the person asked for, only when it crosses', () => {
    expect(kinds(run({ apyBase: 3.2, apyReward: 5.84, tvlUsd: 1_600_000 }, 3))).toEqual(expect.arrayContaining(['target_hit']));
    expect(kinds(run({ apyBase: 3.2, apyReward: 5.84, tvlUsd: 1_600_000 }, 3, { ...REF, apyBase: 3.1 }))).not.toContain('target_hit');
  });
  it('the pool vanishing from the data', () => {
    expect(kinds(run(null))).toEqual(['gone']);
  });
});

describe('plain-words comparison since adding', () => {
  it('says unchanged, up or down', () => {
    expect(sinceText(REF, { apyBase: 0.25, apyReward: 5, tvlUsd: 1_620_000 })).toBe('steady rate unchanged at 0.25%; deposits about the same');
    expect(sinceText(REF, { apyBase: 1.4, apyReward: 0, tvlUsd: 800_000 })).toBe('steady rate up from 0.24% to 1.40%; deposits down 50%');
    expect(sinceText(REF, null)).toBe('no longer in the data');
  });
});

describe('not repeating itself', () => {
  const NOW = new Date('2026-10-21T12:00:00Z');
  it('drops a kind already sent inside the cooldown, keeps it after', () => {
    const a = detectChanges(REF, { apyBase: 0.24, apyReward: 0, tvlUsd: 900_000 }, { label });
    const recent = [{ kind: 'rewards_ended', at: new Date(NOW.getTime() - 3600_000) }];
    expect(withoutRecent(a, recent, NOW).map((x) => x.kind)).toEqual(['tvl_drop']);
    const old = [{ kind: 'rewards_ended', at: new Date(NOW.getTime() - ALERT_COOLDOWN_MS - 1000) }];
    expect(withoutRecent(a, old, NOW)).toHaveLength(2);
  });
});
