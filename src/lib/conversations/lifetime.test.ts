import { describe, expect, it } from 'vitest';
import { CHAT_LIFETIME_MS, closesAt, isClosed, lifetimeNote } from './lifetime';
import { carryOverSummary, describeCard, historyForAgent, type ChatLike } from './describe';

const DAY = 24 * 60 * 60 * 1000;
const START = Date.UTC(2026, 9, 12, 10, 0, 0);

describe('a chat closes seven days after it starts', () => {
  it('closesAt is exactly 7 days later', () => {
    expect(closesAt(START).getTime()).toBe(START + 7 * DAY);
    expect(CHAT_LIFETIME_MS).toBe(7 * DAY);
  });
  it('open until the seventh day is up, closed from then on', () => {
    expect(isClosed(START, START + 6 * DAY + 23 * 3600_000)).toBe(false);
    expect(isClosed(START, START + 7 * DAY)).toBe(true);
    expect(isClosed(START, START + 30 * DAY)).toBe(true);
  });
  it('accepts a date, a string or a number', () => {
    expect(isClosed(new Date(START), START + 8 * DAY)).toBe(true);
    expect(isClosed(new Date(START).toISOString(), START + 8 * DAY)).toBe(true);
  });
});

describe('the sentence at the top of a chat', () => {
  it('says when it closes', () => {
    const t = lifetimeNote({ closesAtIso: closesAt(START).toISOString(), closed: false });
    expect(t).toMatch(/closes on .*Oct 19/);
    expect(t).toMatch(/7 days/);
  });
  it('says what to do once it has closed', () => {
    const t = lifetimeNote({ closesAtIso: closesAt(START).toISOString(), closed: true });
    expect(t).toMatch(/closed on/);
    expect(t).toMatch(/start a new chat/);
  });
  it('a chat that has not been saved yet still shows the rule', () => {
    expect(lifetimeNote({ closesAtIso: null, closed: false })).toMatch(/close 7 days after they start/);
  });
});

describe('describing cards so the agent can see what was on screen', () => {
  const bridge: ChatLike = { role: 'agent', type: 'bridge', bridge: { chain: 'Arc' } };
  it('a deposit address card says what it is and that the person may be waiting', () => {
    const d = describeCard(bridge)!;
    expect(d).toMatch(/Arc deposit address/);
    expect(d).toMatch(/waiting to see if their deposit arrived/);
  });
  it('payments, receipts, swaps, errors and the intro all get a note; plain text gets none', () => {
    expect(describeCard({ role: 'agent', type: 'preview', preview: { amount: '5', token: 'USDT', recipient: '0x1111…1111', external: true }, status: 'awaiting' })).toMatch(/5 USDT to 0x1111…1111 \(a wallet outside Pexa\).*Confirm/);
    expect(describeCard({ role: 'agent', type: 'receipt', preview: { amount: '1', token: 'USDC', recipient: '@joyful' }, result: { status: 'confirmed' } })).toMatch(/receipt: 1 USDC to @joyful — confirmed/);
    expect(describeCard({ role: 'agent', type: 'swap_preview', swap: { amountIn: '5', from: 'USDC', to: 'USAT', expectedOut: '5.005' } })).toMatch(/5 USDC → about 5.005 USAT/);
    expect(describeCard({ role: 'agent', type: 'error', title: 'I can’t reach Pexa right now.' })).toMatch(/error/);
    expect(describeCard({ role: 'agent', type: 'intro' })).toMatch(/what Pexa can do/);
    expect(describeCard({ role: 'agent', type: 'text', text: 'hi' })).toBeNull();
  });
});

describe('historyForAgent', () => {
  const chat: ChatLike[] = [
    { role: 'user', text: 'I want to receive on arc' },
    { role: 'agent', type: 'text', text: 'Here’s the Arc address.' },
    bridgeCard(),
    { role: 'user', text: 'check' },
  ];
  function bridgeCard(): ChatLike {
    return { role: 'agent', type: 'bridge', bridge: { chain: 'Arc' } };
  }
  it('keeps order and puts the card between the text it belongs to and the next message', () => {
    const h = historyForAgent(chat);
    expect(h.map((x) => x.role)).toEqual(['user', 'assistant', 'assistant', 'user']);
    expect(h[2].content).toMatch(/Arc deposit address/);
    expect(h[3].content).toBe('check');
  });
  it('is bounded to the newest messages', () => {
    const many: ChatLike[] = Array.from({ length: 40 }, (_, i) => ({ role: 'user', text: 'm' + i }));
    const h = historyForAgent(many, 16);
    expect(h).toHaveLength(16);
    expect(h[15].content).toBe('m39');
  });
});

describe('carryOverSummary', () => {
  it('brings over the last things said, including what was on screen', () => {
    const s = carryOverSummary(
      [
        { role: 'user', text: 'I want to receive on arc' },
        { role: 'agent', type: 'text', text: 'Here’s the Arc address.' },
        { role: 'agent', type: 'bridge', bridge: { chain: 'Arc' } },
      ],
      'I want to receive on arc',
      'Oct 19',
    );
    expect(s).toMatch(/Continuing from your earlier chat/);
    expect(s).toMatch(/closed Oct 19/);
    expect(s).toMatch(/• You: I want to receive on arc/);
    expect(s).toMatch(/• Pexa: Here’s the Arc address/);
    expect(s).toMatch(/Showed the Arc deposit address/);
  });
});
