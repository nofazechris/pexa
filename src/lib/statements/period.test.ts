import { describe, expect, it } from 'vitest';
import { parsePeriod, parseStatementIntent } from './period';

const NOW = new Date(Date.UTC(2026, 9, 14, 12, 0, 0)); // Wed 14 Oct 2026
const DAY = 86_400_000;

describe('parsePeriod', () => {
  it('rolling windows: "last 30 days", "past 2 weeks", "last 3 months", "last ten days"', () => {
    expect(parsePeriod('last 30 days', NOW)).toMatchObject({ days: 30, label: 'the last 30 days' });
    expect(parsePeriod('the past 2 weeks', NOW)).toMatchObject({ days: 14, label: 'the last 2 weeks' });
    expect(parsePeriod('last 3 months', NOW)).toMatchObject({ days: 90, label: 'the last 3 months' });
    expect(parsePeriod('last ten days', NOW)).toMatchObject({ days: 10 });
    expect(parsePeriod('last 1 week', NOW)?.label).toBe('the last 1 week');
    const p = parsePeriod('last 30 days', NOW)!;
    expect(NOW.getTime() - p.start.getTime()).toBe(30 * DAY);
    expect(p.end.getTime()).toBe(NOW.getTime());
  });

  it('calendar words', () => {
    const lastMonth = parsePeriod('last month', NOW)!;
    expect(lastMonth.label).toBe('September 2026');
    expect(lastMonth.start.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(lastMonth.end.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    const thisMonth = parsePeriod('this month', NOW)!;
    expect(thisMonth.start.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(parsePeriod('this week', NOW)!.start.toISOString()).toBe('2026-10-12T00:00:00.000Z'); // Monday
    expect(parsePeriod('today', NOW)!.start.toISOString()).toBe('2026-10-14T00:00:00.000Z');
    const y = parsePeriod('yesterday', NOW)!;
    expect(y.start.toISOString()).toBe('2026-10-13T00:00:00.000Z');
    expect(y.end.toISOString()).toBe('2026-10-14T00:00:00.000Z');
    expect(parsePeriod('this year', NOW)!.start.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('never longer than a year, and "all time" is capped', () => {
    expect(parsePeriod('last 5 years', NOW)!.days).toBe(366);
    expect(parsePeriod('everything', NOW)!.days).toBe(366);
  });

  it('no period named → null', () => {
    expect(parsePeriod('show my statement', NOW)).toBeNull();
    expect(parsePeriod('what is my balance', NOW)).toBeNull();
  });
});

describe('parseStatementIntent', () => {
  it.each([
    ['I want a statement of the last 30 days', 'the last 30 days', true],
    ['print my statement', 'the last 30 days', false],
    ['can I get my receipts for the last 30 days', 'the last 30 days', true],
    ['show my transaction history for last month', 'September 2026', true],
    ['download my payments for this month', 'October 2026 so far', true],
    ['export my transactions', 'the last 30 days', false],
    ['what did I spend last week?', 'the last 7 days', true],
    ['payment history last 2 weeks', 'the last 2 weeks', true],
    ['give me an account statement', 'the last 30 days', false],
    ['my receipts', 'the last 30 days', false],
    ['can I see my receipts', 'the last 30 days', false],
  ])('yes: %s', (text, label, named) => {
    const i = parseStatementIntent(text, NOW);
    expect(i?.period.label).toBe(label);
    expect(i?.named).toBe(named);
  });

  it.each([
    'what is my balance?',
    'show my recent payments',
    'send 5 to @joyful',
    'receipt for that purchase',
    'what did it find?',
    'give me the receipt for my last purchase',
    'hello',
    '',
  ])('no: %s', (text) => expect(parseStatementIntent(text, NOW)).toBeNull());
});

import { mentionsTime, periodFromArgs } from './period';

describe('flexible phrasings (the bug: "past four days" must not become 30 days)', () => {
  it.each([
    ['I need my statement for the past four days', 4],
    ['statement for the past 4 days', 4],
    ['my receipts for the last seven days', 7],
    ['I need my transaction history for the past eight days', 8],
    ['receipts for 8 days', 8],
    ['statement over the last 2 weeks', 14],
    ['payment history in the last 3 months', 90],
    ['my statement for the last twelve days', 12],
    ['statement of the past 45 days', 45],
    ['statement 10 days', 10],
  ])('%s → %s days', (text, days) => {
    const i = parseStatementIntent(text, NOW);
    expect(i?.period.days, text).toBe(days);
    expect(i?.named).toBe(true);
  });

  it('"since <date>"', () => {
    const p = parsePeriod('statement since October 1st', NOW)!;
    expect(p.start.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(p.label).toBe('since Oct 1');
    expect(parsePeriod('my receipts from 5 oct', NOW)!.start.toISOString()).toBe('2026-10-05T00:00:00.000Z');
    // a date later in the year means last year's
    expect(parsePeriod('since december 25', NOW)!.start.toISOString()).toBe('2025-12-25T00:00:00.000Z');
  });

  it('a period it cannot read is left to the agent instead of silently becoming 30 days', () => {
    expect(parseStatementIntent('my statement for the weekend before last', NOW)).toBeNull();
    expect(parseStatementIntent('receipts between the 3rd and the 9th', NOW)).toBeNull();
  });

  it('no time words at all still defaults to 30 days, and says so via named=false', () => {
    const i = parseStatementIntent('print my statement', NOW)!;
    expect(i.period.days).toBe(30);
    expect(i.named).toBe(false);
  });

  it('mentionsTime', () => {
    expect(mentionsTime('for the weekend')).toBe(true);
    expect(mentionsTime('print my statement')).toBe(false);
  });
});

describe('periodFromArgs — what the agent asks for', () => {
  it('days is a rolling window ending now', () => {
    const r = periodFromArgs({ days: 4 }, NOW);
    expect(r.ok && r.period.days).toBe(4);
    expect(r.ok && NOW.getTime() - r.period.start.getTime()).toBe(4 * DAY);
    expect(r.ok && r.period.label).toBe('the last 4 days');
  });
  it('nothing given → 30 days; 1 day reads as 24 hours; huge is capped', () => {
    expect(periodFromArgs({}, NOW).ok && (periodFromArgs({}, NOW) as { period: { days: number } }).period.days).toBe(30);
    const one = periodFromArgs({ days: 1 }, NOW);
    expect(one.ok && one.period.label).toBe('the last 24 hours');
    const big = periodFromArgs({ days: 9999 }, NOW);
    expect(big.ok && big.period.days).toBe(366);
  });
  it('an explicit date range (to is inclusive)', () => {
    const r = periodFromArgs({ from: '2026-10-01', to: '2026-10-07' }, NOW);
    expect(r.ok && r.period.start.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(r.ok && r.period.end.toISOString()).toBe('2026-10-08T00:00:00.000Z');
    expect(r.ok && r.period.label).toBe('Oct 1 – Oct 7');
    const since = periodFromArgs({ from: '2026-10-01' }, NOW);
    expect(since.ok && since.period.label).toBe('since Oct 1');
  });
  it('refuses nonsense instead of guessing', () => {
    expect(periodFromArgs({ from: 'yesterday' }, NOW).ok).toBe(false);
    expect(periodFromArgs({ from: '2026-10-10', to: '2026-10-01' }, NOW).ok).toBe(false);
    expect(periodFromArgs({ from: '2024-01-01' }, NOW).ok).toBe(false);
    expect(periodFromArgs({ days: 0 }, NOW).ok).toBe(false);
  });
});
