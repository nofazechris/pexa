import { describe, expect, it } from 'vitest';
import { RECURRING_MEMO, buildFeed, usd, type FeedInputs } from './feed';

const t = (s: string) => new Date(s);
const empty: FeedInputs = { payments: [], requests: [], purchases: [], deposits: [], seenAt: null };
const pay = (over: Partial<FeedInputs['payments'][number]> = {}): FeedInputs['payments'][number] => ({
  id: 'p1', direction: 'in', counterparty: '@omoefe', amount: '1', token: 'USDC', status: 'CONFIRMED', memo: null, at: t('2026-10-07T12:00:00Z'), ...over,
});

describe('usd', () => {
  it('formats money the way people read it', () => {
    expect(usd('2')).toBe('$2.00');
    expect(usd('1234.5')).toBe('$1,234.50');
    expect(usd('0.006')).toBe('$0.006');
    expect(usd('0.0036')).toBe('$0.0036');
    expect(usd('nope')).toBe('$0.00');
  });
});

describe('what appears, and how it is worded', () => {
  it('money you received', () => {
    const [i] = buildFeed({ ...empty, payments: [pay()] });
    expect(i).toMatchObject({ kind: 'received', title: '@omoefe sent you $1.00', highlight: true, tab: 'activity' });
  });

  it('money you sent, and a subscription (recurring) payment, are told apart', () => {
    const feed = buildFeed({ ...empty, payments: [pay({ id: 'a', direction: 'out', counterparty: '@joyful', amount: '5' }), pay({ id: 'b', direction: 'out', counterparty: '@joyful', amount: '5', memo: RECURRING_MEMO, at: t('2026-10-07T13:00:00Z') })] });
    expect(feed.map((x) => x.title)).toEqual(['Subscription payment: $5.00 to @joyful', 'You sent $5.00 to @joyful']);
    expect(feed[0].kind).toBe('subscription');
    expect(feed[1].kind).toBe('sent');
  });

  it('a deposit says exactly what the user asked for: "You deposited $2.00"', () => {
    const [i] = buildFeed({ ...empty, deposits: [{ id: 'd1', amount: '2', token: 'USDC', from: '0x4b1c0000000000000000000000000000000d9d2a', at: t('2026-10-07T10:00:00Z') }] });
    expect(i.title).toBe('You deposited $2.00');
    expect(i.detail).toBe('USDC · from 0x4b1c…9d2a');
    expect(i.highlight).toBe(true);
  });

  it('a failed outgoing payment is reported so the user knows nothing was taken', () => {
    const [i] = buildFeed({ ...empty, payments: [pay({ direction: 'out', counterparty: '@joyful', status: 'FAILED' })] });
    expect(i.kind).toBe('failed');
    expect(i.detail).toMatch(/nothing was taken/i);
  });

  it('requests, from both sides', () => {
    const feed = buildFeed({
      ...empty,
      requests: [
        { id: 'r1', direction: 'in', counterparty: '@amy', amount: '20', status: 'PENDING', memo: 'lunch', at: t('2026-10-07T09:00:00Z') },
        { id: 'r2', direction: 'out', counterparty: '@bob', amount: '50', status: 'PAID', memo: null, at: t('2026-10-07T08:00:00Z') },
        { id: 'r3', direction: 'out', counterparty: '@cat', amount: '5', status: 'DECLINED', memo: null, at: t('2026-10-07T07:00:00Z') },
      ],
    });
    expect(feed.map((x) => x.title)).toEqual(['@amy requested $20.00 from you', '@bob paid your $50.00 request', '@cat declined your $5.00 request']);
    expect(feed[0].detail).toBe('“lunch”');
  });

  it('Buy purchases: bought, or "check this one" when we cannot be sure', () => {
    const feed = buildFeed({ ...empty, purchases: [{ id: 'b1', service: 'Search X posts', price: '$0.006', token: 'USDC', status: 'PAID', at: t('2026-10-07T11:00:00Z') }, { id: 'b2', service: 'Run a script', price: '$0.02', token: 'USDC', status: 'UNCERTAIN', at: t('2026-10-07T12:00:00Z') }] });
    expect(feed[0].title).toBe('Check this purchase: Run a script');
    expect(feed[1].title).toBe('Bought: Search X posts');
  });
});

describe('what must NOT appear', () => {
  it('nothing about unsent previews, authorizations in progress, cancelled things, or money that has not arrived', () => {
    const feed = buildFeed({
      ...empty,
      payments: [
        pay({ id: '1', direction: 'out', status: 'PREVIEW' }),
        pay({ id: '2', direction: 'out', status: 'AUTHORIZED' }),
        pay({ id: '3', direction: 'out', status: 'CANCELLED' }),
        pay({ id: '4', direction: 'in', status: 'PENDING' }), // not arrived yet — do not announce it
        pay({ id: '5', direction: 'in', status: 'FAILED' }), // the sender's failure is not the receiver's business
      ],
      requests: [{ id: 'r', direction: 'in', counterparty: '@a', amount: '1', status: 'CANCELLED', memo: null, at: t('2026-10-07T00:00:00Z') }],
      purchases: [{ id: 'b', service: 'x', price: '$1', token: 'USDC', status: 'QUOTED', at: t('2026-10-07T00:00:00Z') }],
    });
    expect(feed).toEqual([]);
  });
});

describe('order, size and "unread"', () => {
  it('newest first, capped', () => {
    const many = Array.from({ length: 60 }, (_, i) => pay({ id: `p${i}`, at: new Date(Date.UTC(2026, 9, 7, 0, i)) }));
    const feed = buildFeed({ ...empty, payments: many });
    expect(feed).toHaveLength(40);
    expect(Date.parse(feed[0].at)).toBeGreaterThan(Date.parse(feed[39].at));
  });

  it('only things newer than the last time you looked are unread', () => {
    const feed = buildFeed({ ...empty, payments: [pay({ id: 'old', at: t('2026-10-07T09:00:00Z') }), pay({ id: 'new', at: t('2026-10-07T12:00:00Z') })], seenAt: t('2026-10-07T10:00:00Z') });
    expect(feed.map((x) => [x.id, x.unread])).toEqual([['pay:new', true], ['pay:old', false]]);
  });

  it('with no baseline yet, existing history is not shouted as "new"', () => {
    expect(buildFeed({ ...empty, payments: [pay()] })[0].unread).toBe(false);
  });
});
