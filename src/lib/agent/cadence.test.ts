import { describe, expect, it } from 'vitest';
import { bareCadence, mentionsRecurrence, parseCadence } from './cadence';

const label = (t: string) => {
  const c = parseCadence(t);
  return c === null ? null : c.kind === 'ok' ? c.label : 'UNSUPPORTED';
};

describe('parseCadence — the four schedules the scheduler really supports', () => {
  it.each([
    ['pay @joyful $5 every Friday', 'Every Friday'],
    ['send 10 to amy each monday', 'Every Monday'],
    ['every Tuesday please', 'Every Tuesday'],
    ['pay him on Fridays', 'Every Friday'],
    ['pay him every fri', 'Every Friday'],
    ['pay joyful every sat', 'Every Saturday'],
    ['send $5 weekly', 'Weekly'],
    ['send $5 every week', 'Weekly'],
    ['once a week', 'Weekly'],
    ['$5 a week', 'Weekly'],
    ['pay monthly', 'Monthly'],
    ['each month', 'Monthly'],
    ['every month', 'Monthly'],
    ['daily', 'Daily'],
    ['every day', 'Daily'],
    ['send 1 USDC to joyful once a day', 'Daily'],
  ])('%s → %s', (t, want) => expect(label(t)).toBe(want));

  it('returns null when nothing about repetition is said', () => {
    for (const t of ['send 5 to joyful', 'hello', 'yes', '']) expect(parseCadence(t)).toBeNull();
  });
});

describe('what it refuses to guess', () => {
  it.each([
    'every other week', 'every 2 weeks', 'every 3 days', 'twice a month', 'on the 15th', 'every weekday', 'fortnightly', 'biweekly', 'quarterly', 'yearly', 'on weekends', 'every two weeks', 'first of the month', 'end of the month',
  ])('%s → unsupported (never silently turned into something else)', (t) => expect(label(`pay amy $5 ${t}`)).toBe('UNSUPPORTED'));
});

describe('bareCadence — a reply that is only a schedule', () => {
  it('reads short replies', () => {
    expect(bareCadence('weekly')).toEqual({ kind: 'ok', label: 'Weekly' });
    expect(bareCadence('every Friday')).toEqual({ kind: 'ok', label: 'Every Friday' });
    expect(bareCadence('Monthly please')).toEqual({ kind: 'ok', label: 'Monthly' });
  });
  it('ignores long messages that merely contain a schedule word', () => {
    expect(bareCadence('I would like you to send this payment to my landlord every week without fail thanks')).toBeNull();
  });
});

describe('mentionsRecurrence', () => {
  it('spots repetition and recurring-payment wording', () => {
    for (const t of ['every Friday', 'set up a recurring payment', 'a subscription', 'autopay', 'weekly', 'twice a month', 'per week']) expect(mentionsRecurrence(t)).toBe(true);
  });
  it('is false for a one-off send', () => {
    for (const t of ['send 5 to joyful', 'pay amy $20', "what's my balance"]) expect(mentionsRecurrence(t)).toBe(false);
  });
});
