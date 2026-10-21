import { describe, expect, it } from 'vitest';
import { parseTickerIntent } from './watch-intent';
import { parseWatchIntent } from '@/lib/yield/watch-intent';
import { parseInvestIntent } from '@/lib/agent/invest-intent';
import { parseEarnIntent } from '@/lib/earn/intent';

describe('watching a stock', () => {
  it('reads cashtags and symbols beside a stock word', () => {
    expect(parseTickerIntent('watch $NVDA')).toEqual({ kind: 'watch_ticker', symbol: 'NVDA' });
    expect(parseTickerIntent('keep an eye on $tsla and tell me if it moves')).toEqual({ kind: 'watch_ticker', symbol: 'TSLA' });
    expect(parseTickerIntent('add NVDA stock to my watchlist')).toEqual({ kind: 'watch_ticker', symbol: 'NVDA' });
    expect(parseTickerIntent('track AAPL shares for me')).toEqual({ kind: 'watch_ticker', symbol: 'AAPL' });
  });
  it('reads stopping and refreshing the talk', () => {
    expect(parseTickerIntent('stop watching $AMD')).toEqual({ kind: 'unwatch_ticker', symbol: 'AMD' });
    expect(parseTickerIntent('refresh the talk about $NVDA')).toEqual({ kind: 'refresh_ticker', symbol: 'NVDA' });
    expect(parseTickerIntent('what are people saying about $NVDA now? refresh the chatter')).toEqual({ kind: 'refresh_ticker', symbol: 'NVDA' });
  });
  it('a bare word that is not clearly a stock is left alone', () => {
    for (const t of ['watch the movie', 'track my order', 'watch NVDA', 'keep an eye on it', 'watch $NVDA and $AMD']) expect(parseTickerIntent(t), t).toBeNull();
  });
  it('pools, yields and coins are never stock watches', () => {
    for (const t of ['watch the aave usdt pool', 'watch $USDT', 'track celo staking', 'keep an eye on the uniswap pool']) expect(parseTickerIntent(t), t).toBeNull();
  });
  it('goes through the combined watch reader, ahead of the pool reader', () => {
    expect(parseWatchIntent('watch $NVDA')).toEqual({ kind: 'watch_ticker', symbol: 'NVDA' });
    expect(parseWatchIntent('watch the Aave USDT pool on Celo')).toMatchObject({ kind: 'watch', symbol: 'usdt' });
  });
  it('is never read as stock research, a deposit or a trade', () => {
    for (const t of ['watch $NVDA', 'stop watching $AMD', 'refresh the talk about $NVDA']) {
      expect(parseInvestIntent(t).kind, t).not.toBe('stocks');
      expect(parseEarnIntent(t).kind, t).toBe('none');
    }
  });
});
