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
