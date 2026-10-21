import { describe, expect, it } from 'vitest';
import { resolveWatchPronoun } from './watch-intent';

describe('"watch them" means the stocks Pexa just showed', () => {
  const note = '[Showed stock research for stocks: $NVDA (attention and momentum, 9 people talking, +6.3% this month); $AAPL (thin evidence, 6 people talking); $PUMP (looks coordinated, 3 people talking). It is evidence from posts and prices, not a recommendation; Pexa can’t buy or sell stocks]';
  const chat = [
    { role: 'user' as const, content: 'find me stocks that are going viral' },
    { role: 'assistant' as const, content: note },
    { role: 'user' as const, content: 'watch them and track them from now on' },
  ];
  it('takes the tickers from the latest stock research in the chat', () => {
    expect(resolveWatchPronoun('watch them and track them from now on', chat)).toEqual(['NVDA', 'AAPL', 'PUMP']);
    expect(resolveWatchPronoun('keep an eye on all the stocks you just suggested', chat)).toEqual(['NVDA', 'AAPL', 'PUMP']);
  });
  it('does nothing without stock research to point at, or when a stock is named, or for pools', () => {
    expect(resolveWatchPronoun('watch them', [{ role: 'user', content: 'hi' }, { role: 'user', content: 'watch them' }])).toBeNull();
    expect(resolveWatchPronoun('watch $AMD and them', chat)).toBeNull();
    expect(resolveWatchPronoun('watch them pools on aave', chat)).toBeNull();
    expect(resolveWatchPronoun('what do you think of them', chat)).toBeNull();
  });
  it('uses only the latest stock research, and never more than six', () => {
    const letters = 'ABCDEFGH'.split('');
    const many = '[Showed stock research: ' + letters.map((c) => '$' + c + c + ' (x)').join('; ') + ']';
    const out = resolveWatchPronoun('track these', [{ role: 'assistant', content: note }, { role: 'assistant', content: many }, { role: 'user', content: 'track these' }]);
    expect(out).toHaveLength(6);
    expect(out).toEqual(['AA', 'BB', 'CC', 'DD', 'EE', 'FF']);
  });
});
