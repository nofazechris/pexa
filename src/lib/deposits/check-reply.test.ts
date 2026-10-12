import { describe, expect, it } from 'vitest';
import { agoWords, composeDepositCheck, mapRelayStatus, type CheckFacts } from './check-reply';

const NOW = Date.UTC(2026, 9, 12, 17, 0, 0);
const at = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();
const base: CheckFacts = { recent: [], bridges: [], balance: '2.830345', now: NOW };

describe('mapRelayStatus', () => {
  it.each([
    ['waiting', 'waiting'], ['pending', 'processing'], ['submitted', 'processing'], ['depositing', 'processing'], ['delayed', 'processing'],
    ['success', 'done'], ['failure', 'problem'], ['refunded', 'problem'], ['', 'unknown'], [undefined, 'unknown'], ['something-new', 'unknown'],
  ] as const)('%s → %s', (input, want) => expect(mapRelayStatus(input as string | undefined)).toBe(want));
});

describe('agoWords', () => {
  it.each([[0, 'just now'], [4 * 60_000, '4 min ago'], [90 * 60_000, '2 hours ago'], [60 * 60_000, '1 hour ago'], [26 * 3600_000, '1 day ago'], [3 * 86400_000, '3 days ago']])('%s', (ms, want) => expect(agoWords(ms)).toBe(want));
});

describe('composeDepositCheck', () => {
  it('a fresh deposit → "Yes, it arrived", with the amount, when, and the balance', () => {
    const t = composeDepositCheck({ ...base, recent: [{ amount: '0.971427', token: 'USDC', at: at(4) }] });
    expect(t).toMatch(/^Yes — your deposit arrived: \$0\.9714 USDC, 4 min ago\./);
    expect(t).toMatch(/balance is now \$2\.8303 USDC/);
  });

  it('still converting → says so, and asks to check again', () => {
    const t = composeDepositCheck({ ...base, recent: [{ amount: '2', token: 'USDC', at: at(3000) }], bridges: [{ chain: 'Arc', state: 'processing' }, { chain: 'Base', state: 'waiting' }] });
    expect(t).toMatch(/I can see your deposit on Arc/);
    expect(t).toMatch(/check again/);
    expect(t).not.toMatch(/^Yes/);
  });

  it('a problem is reported honestly, without alarm about lost money', () => {
    const t = composeDepositCheck({ ...base, bridges: [{ chain: 'Arbitrum', state: 'problem' }] });
    expect(t).toMatch(/problem with a transfer on Arbitrum/);
    expect(t).toMatch(/isn’t lost/);
  });

  it('nothing yet → "Not yet", which networks Relay is waiting on, and the last deposit', () => {
    const t = composeDepositCheck({ ...base, recent: [{ amount: '5.064918', token: 'USDC', at: at(60 * 24 * 4) }], bridges: [{ chain: 'Arc', state: 'waiting' }, { chain: 'Arbitrum', state: 'waiting' }] });
    expect(t).toMatch(/^Not yet/);
    expect(t).toMatch(/waiting for a deposit on Arc and Arbitrum/);
    expect(t).toMatch(/last deposit was \$5\.0649 USDC, 4 days ago/);
    expect(t).toMatch(/same network as the address/);
  });

  it('no history, no bridges, no balance → still a clear answer', () => {
    const t = composeDepositCheck({ recent: [], bridges: [], balance: null, now: NOW });
    expect(t).toMatch(/^Not yet/);
    expect(t).not.toMatch(/balance is now/);
  });

  it('a deposit older than 45 minutes is not announced as "it arrived"', () => {
    const t = composeDepositCheck({ ...base, recent: [{ amount: '1', token: 'USDC', at: at(50) }] });
    expect(t).toMatch(/^Not yet/);
    expect(t).toMatch(/last deposit was \$1\.00 USDC, 50 min ago/);
  });
});
