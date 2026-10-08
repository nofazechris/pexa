import { describe, expect, it } from 'vitest';
import { AiBreaker, fastLane, formatBalanceReply, formatRecentReply, modelChain } from './resilience';

describe('modelChain', () => {
  it('keeps the order and drops repeats and blanks', () => {
    expect(modelChain('gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4.1-mini', undefined, 'gpt-4o-mini')).toEqual(['gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4o-mini']);
    expect(modelChain(undefined, '')).toEqual([]);
  });
});

describe('AiBreaker', () => {
  it('opens after a failure and closes by itself', () => {
    const b = new AiBreaker(30_000);
    expect(b.isOpen(1000)).toBe(false);
    b.recordFailure(1000);
    expect(b.isOpen(1001)).toBe(true);
    expect(b.isOpen(31_001)).toBe(false);
  });
  it('closes the moment something works', () => {
    const b = new AiBreaker();
    b.recordFailure(0);
    b.recordSuccess();
    expect(b.isOpen(1)).toBe(false);
  });
});

describe('fastLane', () => {
  it.each([
    ["what's my balance?", 'balance'],
    ['balance', 'balance'],
    ['How much do I have?', 'balance'],
    ['show my recent payments', 'recent'],
    ['my last transactions', 'recent'],
    ['transaction history', 'recent'],
    ['what did I spend this week', 'recent'],
    ['Add money to my wallet', 'receive'],
    ['what is my wallet address', 'receive'],
    ['where can I deposit', 'receive'],
  ])('%s → %s', (text, lane) => expect(fastLane(text)).toBe(lane));
  it.each(['send 5 to @joyful', 'what can you do?', 'hello', 'Is this Instagram vendor legit?', ''])('no lane: %s', (t) => expect(fastLane(t)).toBeNull());
});

describe('replies', () => {
  it('balance, with and without savings', () => {
    expect(formatBalanceReply({ balance: '12.4', available: '12.4', savedInVaults: '0' })).toBe('Your balance is $12.40 USDC.');
    expect(formatBalanceReply({ balance: '20', available: '15', savedInVaults: '5' })).toContain('$15.00 USDC available');
  });
  it('recent payments', () => {
    const rows = [
      { direction: 'out' as const, counterparty: '@joyful', amount: '1', status: 'CONFIRMED', createdAt: '2026-10-08T12:00:00Z' },
      { direction: 'in' as const, counterparty: '@chris', amount: '2.5', status: 'AUTHORIZED', createdAt: '2026-10-07T12:00:00Z' },
    ];
    const text = formatRecentReply(rows);
    expect(text).toContain('Sent $1.00 to @joyful');
    expect(text).toContain('Received $2.50 from @chris');
    expect(text).toContain('(authorized)');
    expect(formatRecentReply([])).toMatch(/haven’t had any/);
  });
});
