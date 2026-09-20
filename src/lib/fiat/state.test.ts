import { describe, it, expect } from 'vitest';
import { assertTransition, canReach, canTransition, isTerminal, isValidStatus } from './state';

describe('fiat order state machine — buy (NGN→USDT)', () => {
  it('advances along the happy path QUOTE_CREATED → SETTLED', () => {
    const happy = ['QUOTE_CREATED', 'AWAITING_FUNDING', 'FUNDING_RECEIVED', 'PROCESSING', 'SETTLED'] as const;
    for (let i = 0; i < happy.length - 1; i++) {
      expect(canTransition('buy', happy[i], happy[i + 1])).toBe(true);
    }
  });

  it('forbids skipping straight to SETTLED', () => {
    expect(canTransition('buy', 'QUOTE_CREATED', 'SETTLED')).toBe(false);
  });

  it('treats SETTLED as terminal', () => {
    expect(isTerminal('buy', 'SETTLED')).toBe(true);
    expect(canTransition('buy', 'SETTLED', 'PROCESSING')).toBe(false);
  });

  it('allows a funded order to be refunded after failure', () => {
    expect(canTransition('buy', 'FAILED', 'REFUNDED')).toBe(true);
  });
});

describe('fiat order state machine — sell (USDT→NGN)', () => {
  it('advances along the happy path QUOTE_CREATED → PAID', () => {
    const happy = ['QUOTE_CREATED', 'AWAITING_ASSET', 'ASSET_RECEIVED', 'PROCESSING', 'PAYOUT_PROCESSING', 'PAID'] as const;
    for (let i = 0; i < happy.length - 1; i++) {
      expect(canTransition('sell', happy[i], happy[i + 1])).toBe(true);
    }
  });

  it('allows a completed payout to be reversed', () => {
    expect(canTransition('sell', 'PAID', 'REVERSED')).toBe(true);
  });

  it('assertTransition throws on an illegal move and returns the target on a legal one', () => {
    expect(() => assertTransition('sell', 'QUOTE_CREATED', 'PAID')).toThrow(/Illegal sell fiat-order transition/);
    expect(assertTransition('sell', 'PAYOUT_PROCESSING', 'PAID')).toBe('PAID');
  });

  it('does not share transitions across sides', () => {
    // AWAITING_FUNDING is a buy-only state; it must not be reachable on the sell machine.
    expect(canTransition('sell', 'QUOTE_CREATED', 'AWAITING_FUNDING')).toBe(false);
  });
});

describe('fiat settlement reachability (webhooks)', () => {
  it('a webhook may jump forward to a reachable later state', () => {
    expect(canReach('buy', 'AWAITING_FUNDING', 'SETTLED')).toBe(true);
    expect(canReach('sell', 'AWAITING_ASSET', 'PAID')).toBe(true);
  });
  it('cannot reach a state on the other side or go backwards', () => {
    expect(canReach('buy', 'AWAITING_FUNDING', 'PAID')).toBe(false); // sell-only terminal
    expect(canReach('buy', 'SETTLED', 'PROCESSING')).toBe(false); // terminal has no exits
    expect(canReach('sell', 'PAID', 'PROCESSING')).toBe(false);
  });
  it('validates status strings per side', () => {
    expect(isValidStatus('buy', 'SETTLED')).toBe(true);
    expect(isValidStatus('buy', 'PAID')).toBe(false);
    expect(isValidStatus('sell', 'PAID')).toBe(true);
    expect(isValidStatus('sell', 'SETTLED')).toBe(false);
  });
});
