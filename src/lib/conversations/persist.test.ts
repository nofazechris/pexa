import { describe, expect, it } from 'vitest';
import { deriveTitle, isWorthSaving, MAX_SAVED_MESSAGES, prepareForSave, restoreMessages } from './persist';

const user = (id: number, text: string) => ({ id, role: 'user', text });
const buyCard = (id: number, status: string) => ({
  id,
  role: 'agent',
  type: 'buy_quote',
  status,
  buy: { purchaseId: 'p1', service: 'Search Reddit', price: '$0.006', token: 'USDC', from: '0xabc', typedData: { domain: { name: 'USDC' }, message: { from: '0xabc', value: '6000' } } },
});

describe('prepareForSave', () => {
  it('never stores signing data for a Buy card', () => {
    const [m] = prepareForSave([buyCard(1, 'awaiting')]);
    expect((m.buy as Record<string, unknown>).typedData).toBeUndefined();
    expect((m.buy as Record<string, unknown>).purchaseId).toBe('p1');
  });

  it('keeps known fields only and ignores junk and non-chat entries', () => {
    const out = prepareForSave([{ id: 1, role: 'user', text: 'hi', evil: '<script>' }, 'nope', null, { role: 'system', text: 'x' }]);
    expect(out).toEqual([{ id: 1, role: 'user', text: 'hi' }]);
  });

  it('keeps only the newest messages when there are too many', () => {
    const many = Array.from({ length: MAX_SAVED_MESSAGES + 25 }, (_, i) => user(i + 1, `m${i}`));
    const out = prepareForSave(many);
    expect(out).toHaveLength(MAX_SAVED_MESSAGES);
    expect(out[out.length - 1].text).toBe(`m${MAX_SAVED_MESSAGES + 24}`);
  });

  it('shortens very long text and long purchase results', () => {
    const [u] = prepareForSave([user(1, 'x'.repeat(9000))]);
    expect((u.text as string).length).toBeLessThan(4100);
    const [r] = prepareForSave([{ id: 2, role: 'agent', type: 'buy_result', buyResult: { ok: true, output: 'y'.repeat(20000) } }]);
    expect(String((r.buyResult as { output: string }).output).length).toBeLessThan(4100);
  });

  it('stays under the size cap by dropping the oldest', () => {
    const big = Array.from({ length: 150 }, (_, i) => ({ id: i + 1, role: 'agent', type: 'buy_result', buyResult: { ok: true, output: 'z'.repeat(3900) } }));
    expect(JSON.stringify(prepareForSave(big)).length).toBeLessThanOrEqual(400_000);
  });

  it('returns nothing for a non-array', () => {
    expect(prepareForSave({ a: 1 })).toEqual([]);
    expect(prepareForSave(undefined)).toEqual([]);
  });
});

describe('restoreMessages — nothing that can move money comes back live', () => {
  it('makes an awaiting card inert and marks it restored', () => {
    const { messages } = restoreMessages([user(1, 'send $5'), buyCard(2, 'awaiting'), { id: 3, role: 'agent', type: 'preview', status: 'awaiting', preview: { recipient: '@amy', amount: '5' } }]);
    expect(messages[1]).toMatchObject({ status: 'cancelled', restored: true });
    expect(messages[2]).toMatchObject({ status: 'cancelled', restored: true });
  });

  it('leaves finished cards alone', () => {
    const { messages } = restoreMessages([buyCard(1, 'confirmed'), { id: 2, role: 'agent', type: 'receipt', result: { status: 'confirmed' } }]);
    expect(messages[0].status).toBe('confirmed');
    expect(messages[0].restored).toBeUndefined();
  });

  it('continues numbering after the highest saved id', () => {
    expect(restoreMessages([user(7, 'a'), user(12, 'b')]).nextId).toBe(13);
    expect(restoreMessages([]).nextId).toBe(1);
  });
});

describe('titles and worth-saving', () => {
  it('titles a chat by the first thing the user asked, shortened', () => {
    expect(deriveTitle([{ role: 'agent', text: 'Hello' }, user(2, '  What is   Reddit saying about Celo today?  ')])).toBe('What is Reddit saying about Celo today?');
    expect(deriveTitle([user(1, 'a'.repeat(200))]).length).toBeLessThanOrEqual(60);
    expect(deriveTitle([])).toBe('New chat');
  });
  it('only saves chats the user took part in', () => {
    expect(isWorthSaving([{ role: 'agent', text: 'hi' }])).toBe(false);
    expect(isWorthSaving([user(1, 'hi')])).toBe(true);
  });
});

describe('the newer cards survive being saved and reopened', () => {
  it('keeps the deposit address, conversion, intro and statement cards (they used to be dropped)', () => {
    const saved = prepareForSave([
      user(1, 'I want to receive on arc'),
      { id: 2, role: 'agent', type: 'bridge', bridge: { chain: 'Arc', chainId: 5042, address: '0x398228d881c223f4fef2791166afa52a586d7098', qr: 'data:image/png;base64,AAA', estimateFeeUsd: '0.04' } },
      { id: 3, role: 'agent', type: 'swap_preview', status: 'awaiting', swap: { swapId: 's1', from: 'USDC', to: 'USAT', amountIn: '5', expectedOut: '5.005' } },
      { id: 4, role: 'agent', type: 'swap_receipt', swap: { swapId: 's1' }, swapResult: { ok: true, amountOut: '5.005' } },
      { id: 5, role: 'agent', type: 'intro', intro: [{ title: 'Send money', description: 'x', example: 'y' }] },
      { id: 6, role: 'agent', type: 'statement', statement: { label: 'the last 30 days', count: 2, rows: [] } },
    ]);
    expect(saved).toHaveLength(6);
    expect((saved[1].bridge as { chain: string }).chain).toBe('Arc');
    expect((saved[2].swap as { swapId: string }).swapId).toBe('s1');
    expect(saved[3].swapResult).toEqual({ ok: true, amountOut: '5.005' });
    expect(Array.isArray(saved[4].intro)).toBe(true);
    expect((saved[5].statement as { label: string }).label).toBe('the last 30 days');
  });

  it('a conversion that was waiting for a tap comes back inert', () => {
    const { messages } = restoreMessages([user(1, 'convert $5 to USAT'), { id: 2, role: 'agent', type: 'swap_preview', status: 'awaiting', swap: { swapId: 's1' } }]);
    expect(messages[1].status).toBe('cancelled');
    expect(messages[1].restored).toBe(true);
  });
});
