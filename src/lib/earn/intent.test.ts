import { describe, expect, it } from 'vitest';
import { askEarnAmount, askEarnToken, parseEarnIntent } from './intent';

const earn = (action: 'deposit' | 'withdraw', token: 'USDT' | 'USDC' | null, amount: string | 'all' | null) => ({ kind: 'earn', action, token, amount });

describe('reading a deposit into Aave', () => {
  it('reads the usual phrasings', () => {
    expect(parseEarnIntent('deposit $10 USDT into Aave')).toEqual(earn('deposit', 'USDT', '10'));
    expect(parseEarnIntent('put 25 usdc in aave')).toEqual(earn('deposit', 'USDC', '25'));
    expect(parseEarnIntent('invest 5 USDT to earn yield')).toEqual(earn('deposit', 'USDT', '5'));
    expect(parseEarnIntent('lend my usdt on aave')).toEqual(earn('deposit', 'USDT', null));
    expect(parseEarnIntent('Deposit USDT into Aave on Celo')).toEqual(earn('deposit', 'USDT', null)); // the yield card's button
  });
  it('asks for what is missing instead of guessing', () => {
    expect(parseEarnIntent('deposit $10 into Aave')).toEqual(earn('deposit', null, '10'));
    expect(parseEarnIntent('put my money in aave')).toEqual(earn('deposit', null, null));
  });
  it('reads "all"', () => {
    expect(parseEarnIntent('deposit all my USDT into aave')).toEqual(earn('deposit', 'USDT', 'all'));
  });
});

describe('reading a withdrawal', () => {
  it('reads the usual phrasings', () => {
    expect(parseEarnIntent('withdraw 5 USDT from Aave')).toEqual(earn('withdraw', 'USDT', '5'));
    expect(parseEarnIntent('take my usdc out of aave')).toEqual(earn('withdraw', 'USDC', null));
    expect(parseEarnIntent('withdraw everything from aave')).toEqual(earn('withdraw', null, 'all'));
    expect(parseEarnIntent('cash out my earnings from aave usdt')).toEqual(earn('withdraw', 'USDT', null));
  });
});

describe('watching is not depositing', () => {
  it('never reads a watch request about Aave as a deposit', () => {
    for (const t of ['add the Aave USDC pool on Celo to my watchlist', 'watch the aave usdt pool', 'keep an eye on aave usdc on celo', 'track aave usdt and alert me', 'tell me when aave usdt hits 3%']) {
      expect(parseEarnIntent(t).kind, t).toBe('none');
    }
  });
});

describe('not an earn action', () => {
  it('"deposit" alone is about receiving money', () => {
    for (const t of ['I want to deposit crypto', 'deposit 10 USDC', 'how do I deposit money', 'receive USDC from Arbitrum', 'send 10 USDC to @ada', 'put 10 USDC in my vault']) {
      expect(parseEarnIntent(t).kind, t).toBe('none');
    }
  });
  it('a question about earning is research, not an action', () => {
    for (const t of ['where can I earn on my USDC?', 'best yield on Celo', 'what is the APY on aave', 'can I earn interest on USAT']) {
      expect(parseEarnIntent(t).kind, t).toBe('none');
    }
  });
  it('USAT can’t be deposited, and the person is told', () => {
    expect(parseEarnIntent('deposit my USAT into aave')).toEqual({ kind: 'usat' });
    expect(parseEarnIntent('lend 5 usat to earn')).toEqual({ kind: 'usat' });
  });
});

describe('answers to the app’s own questions', () => {
  it('the coin, keeping an amount already given', () => {
    const q = askEarnToken('deposit', '10');
    expect(parseEarnIntent('USDC', q)).toEqual(earn('deposit', 'USDC', '10'));
    expect(parseEarnIntent('usdt please', askEarnToken('withdraw', null))).toEqual(earn('withdraw', 'USDT', null));
  });
  it('the amount', () => {
    expect(parseEarnIntent('15', askEarnAmount('deposit', 'USDT'))).toEqual(earn('deposit', 'USDT', '15'));
    expect(parseEarnIntent('$7.50', askEarnAmount('withdraw', 'USDC'))).toEqual(earn('withdraw', 'USDC', '7.50'));
    expect(parseEarnIntent('all', askEarnAmount('withdraw', 'USDT'))).toEqual(earn('withdraw', 'USDT', 'all'));
  });
  it('ignores an unrelated reply', () => {
    expect(parseEarnIntent('thanks', askEarnAmount('deposit', 'USDT')).kind).toBe('none');
  });
});

import { parseBridgeIntent } from '@/lib/bridge/chains';
import { parseSwapIntent } from '@/lib/swap/intent';

describe('does not collide with the other flows', () => {
  const earnPhrases = ['deposit $10 USDT into Aave', 'put 25 usdc in aave', 'invest 5 USDT to earn yield', 'withdraw 5 USDT from Aave', 'Deposit USDT into Aave on Celo', 'lend my usdt on aave'];
  it('an earn phrase is never read as a bridge or a conversion', () => {
    for (const t of earnPhrases) {
      expect(parseBridgeIntent(t).kind, t).toBe('none');
      expect(parseSwapIntent(t).kind, t).toBe('none');
    }
  });
  it('bridge and conversion phrases are never read as earn', () => {
    for (const t of ['I want to deposit crypto', 'somebody wants to send me USDC on Arbitrum', 'convert $5 to USAT', 'swap 10 USDC for USDT', 'receive USDC from Base']) {
      expect(parseEarnIntent(t).kind, t).toBe('none');
    }
  });
});
