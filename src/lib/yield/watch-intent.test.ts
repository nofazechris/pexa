import { describe, expect, it } from 'vitest';
import { parseWatchIntent } from './watch-intent';
import { parseEarnIntent } from '@/lib/earn/intent';
import { parseBridgeIntent } from '@/lib/bridge/chains';
import { parseSwapIntent } from '@/lib/swap/intent';

describe('watching a pool', () => {
  it('reads the usual phrasings', () => {
    expect(parseWatchIntent('watch the Aave USDT pool on Celo')).toEqual({ kind: 'watch', chain: 'Celo', project: 'aave', symbol: 'usdt', chainAssumed: false });
    expect(parseWatchIntent('keep an eye on the Moola cUSD pool')).toEqual({ kind: 'watch', chain: 'Celo', project: 'moola', symbol: 'cusd', chainAssumed: true });
    expect(parseWatchIntent('add the Aave USDC pool on Celo to my watchlist')).toMatchObject({ kind: 'watch', chain: 'Celo', project: 'aave', symbol: 'usdc' });
    expect(parseWatchIntent('track USDC yield on Base')).toMatchObject({ kind: 'watch', chain: 'Base', symbol: 'usdc' });
  });
  it('the exact phrase that confused the model', () => {
    expect(parseWatchIntent('watch the Moola cUSD pool on Celo and tell me if it changes')).toMatchObject({ kind: 'watch', chain: 'Celo', project: 'moola', symbol: 'cusd' });
  });
  it('reads a rate to be told about', () => {
    expect(parseWatchIntent('watch the aave usdt pool and tell me when it hits 3%')).toMatchObject({ kind: 'watch', symbol: 'usdt', targetApy: 3 });
    expect(parseWatchIntent('watch aave usdc on celo, alert me if it goes above 2.5%')).toMatchObject({ targetApy: 2.5 });
  });
  it('the tether sign counts as USDT', () => {
    expect(parseWatchIntent('watch the aave USD₮ pool')).toMatchObject({ kind: 'watch', symbol: 'usdt' });
  });
});

describe('stopping and showing', () => {
  it('reads stop requests', () => {
    expect(parseWatchIntent('stop watching the Moola cUSD pool on Celo')).toEqual({ kind: 'unwatch', chain: 'Celo', project: 'moola', symbol: 'cusd' });
    expect(parseWatchIntent('remove the aave usdt one from my watchlist')).toMatchObject({ kind: 'unwatch', project: 'aave', symbol: 'usdt' });
    expect(parseWatchIntent('stop watching everything').kind).toBe('unwatch');
  });
  it('reads requests to see the list', () => {
    for (const t of ['show my watchlist', 'what am I watching', 'my watchlist', "what's on my watchlist"]) {
      expect(parseWatchIntent(t).kind, t).toBe('show');
    }
  });
});

describe('not a pool watch, and no collisions', () => {
  it('ordinary talk about watching or tracking is left alone', () => {
    for (const t of ['track my order', 'watch this video', 'monitor my balance', 'I want to watch a movie', 'where can I earn on my USDC?', 'best yield on Celo']) {
      expect(parseWatchIntent(t).kind, t).toBe('none');
    }
  });
  it('a watch request is never a deposit, a bridge or a conversion', () => {
    for (const t of ['add the Aave USDC pool on Celo to my watchlist', 'watch the aave usdt pool and tell me when it hits 3%', 'keep an eye on aave usdc on celo']) {
      expect(parseEarnIntent(t).kind, t).toBe('none');
      expect(parseBridgeIntent(t).kind, t).toBe('none');
      expect(parseSwapIntent(t).kind, t).toBe('none');
    }
  });
  it('deposits, bridges and conversions are never read as watching', () => {
    for (const t of ['deposit 10 USDT into Aave', 'convert 5 USDC to USAT', 'receive USDC from Base', 'withdraw everything from aave']) {
      expect(parseWatchIntent(t).kind, t).toBe('none');
    }
  });
});
