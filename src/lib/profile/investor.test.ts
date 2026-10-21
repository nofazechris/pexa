import { describe, expect, it } from 'vitest';
import { CHOICES, EMPTY_PROFILE, QUESTION, applyAnswer, isComplete, maxPoolRisk, minPoolSize, nextStep, readAmount, readHorizon, readRisk, stepAsked, summary } from './investor';
import { parseInvestIntent, themeLabel } from '@/lib/agent/invest-intent';

describe('getting to know the investor', () => {
  it('asks risk, then horizon, then amount, once', () => {
    let p = EMPTY_PROFILE;
    expect(nextStep(p)).toBe('risk');
    p = applyAnswer(p, 'risk', 'I’d rather play it safe').profile;
    expect(nextStep(p)).toBe('horizon');
    p = applyAnswer(p, 'horizon', 'In one to three years').profile;
    expect(nextStep(p)).toBe('amount');
    p = applyAnswer(p, 'amount', '$1,500').profile;
    expect(nextStep(p)).toBeNull();
    expect(isComplete(p)).toBe(true);
    expect(p).toEqual({ risk: 'cautious', horizon: 'medium', amountUsd: 1500, skipped: false });
  });
  it('reads every button as what it means', () => {
    expect(CHOICES.risk.map((c) => readRisk(c.text))).toEqual(['cautious', 'balanced', 'bold', null]);
    expect(CHOICES.horizon.map((c) => readHorizon(c.text))).toEqual(['short', 'medium', 'long', null]);
  });
  it('reads people’s own words', () => {
    expect(readRisk('I hate losing money, keep it conservative')).toBe('cautious');
    expect(readRisk('aggressive please')).toBe('bold');
    expect(readHorizon('probably a few months')).toBe('short');
    expect(readHorizon('I’m saving for retirement')).toBe('long');
    expect(readAmount('maybe 5k')).toBe(5000);
    expect(readAmount('about $250')).toBe(250);
    expect(readAmount('not sure')).toBeNull();
  });
  it('does not guess when an answer is not understood', () => {
    const r = applyAnswer(EMPTY_PROFILE, 'risk', 'purple');
    expect(r.ok).toBe(false);
    expect(r.profile).toEqual(EMPTY_PROFILE);
  });
  it('skipping stops the questions and keeps middle-of-the-road settings', () => {
    const r = applyAnswer(EMPTY_PROFILE, 'risk', 'Skip the questions');
    expect(r.profile.skipped).toBe(true);
    expect(nextStep(r.profile)).toBeNull();
    expect(maxPoolRisk(r.profile)).toBe('medium');
    expect(summary(r.profile)).toMatch(/skipped/);
  });
  it('recognises which question was just asked', () => {
    expect(stepAsked(`${QUESTION.risk} (tap one)`)).toBe('risk');
    expect(stepAsked(QUESTION.horizon)).toBe('horizon');
    expect(stepAsked(QUESTION.amount)).toBe('amount');
    expect(stepAsked('Here are your pools')).toBeNull();
  });
  it('shapes what is shown: bold people see everything; cautious people only large, not-high-risk pools', () => {
    const cautious = { risk: 'cautious' as const, horizon: 'long' as const, amountUsd: 100, skipped: false };
    expect(maxPoolRisk(cautious)).toBe('medium');
    expect(minPoolSize(cautious)).toBe(1_000_000);
    expect(maxPoolRisk({ ...cautious, risk: 'bold' })).toBe('high');
    expect(minPoolSize({ ...cautious, risk: 'bold' })).toBeUndefined();
    expect(maxPoolRisk(null)).toBe('medium');
  });
  it('reflects back what they said', () => {
    expect(summary({ risk: 'balanced', horizon: 'long', amountUsd: 2000, skipped: false })).toBe('You told me: a balanced approach, needing the money in more than three years, about $2,000 to put in.');
  });
});

describe('telling stock research, yield research and trades apart', () => {
  it('stock research, with a theme when there is one', () => {
    expect(parseInvestIntent('Can you research the stocks that are going viral and doing well right now?')).toEqual({ kind: 'stocks', theme: null });
    expect(parseInvestIntent('what are the best AI stocks right now')).toEqual({ kind: 'stocks', theme: 'AI' });
    expect(parseInvestIntent('find me dividend stocks that are performing')).toEqual({ kind: 'stocks', theme: 'dividend' });
    expect(themeLabel('AI')).toBe('AI stocks');
    expect(themeLabel(null)).toBe('stocks');
  });
  it('asking Pexa to buy a stock is a trade request, which it can’t do', () => {
    expect(parseInvestIntent('buy me $50 of Tesla stock').kind).toBe('trade');
    expect(parseInvestIntent('sell my 10 shares of Apple stock').kind).toBe('trade');
  });
  it('yield and earning questions', () => {
    for (const t of ['where can I earn on my USDC?', 'best yield on Celo', 'I want to stake my USDT', 'where should I invest my money', 'what pays the best APY']) {
      expect(parseInvestIntent(t).kind, t).toBe('yield');
    }
  });
  it('actions on pools and everyday talk are not investing research', () => {
    for (const t of ['deposit 10 USDT into Aave', 'watch the aave usdt pool', 'convert 5 USDC to USAT', 'send 5 USDC to @ada', 'hello', 'what can you do']) {
      expect(parseInvestIntent(t).kind, t).toBe('none');
    }
  });
});
