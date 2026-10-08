import { describe, expect, it } from 'vitest';
import { askSwapAmount, parseSwapIntent } from './intent';

const swap = (text: string, prev?: string) => {
  const r = parseSwapIntent(text, prev);
  return r.kind === 'swap' ? `${r.from}>${r.to}:${r.amount ?? '?'}` : 'none';
};

describe('converting to USAT', () => {
  it.each([
    ['convert $5 to USAT', 'USDC>USAT:5'],
    ['Convert 5 USDC to USAT', 'USDC>USAT:5'],
    ['swap 10 USDC for USAT', 'USDC>USAT:10'],
    ['exchange $25.50 to usat', 'USDC>USAT:25.50'],
    ['buy 5 USAT', 'USDC>USAT:5'],
    ['buy $5 worth of USAT', 'USDC>USAT:5'],
    ['get me some USAT', 'USDC>USAT:?'],
    ['I want to convert to USAT', 'USDC>USAT:?'],
    ['convert to usat', 'USDC>USAT:?'],
    ['swap all my USDC to USAT', 'USDC>USAT:all'],
    ['convert everything to USAT', 'USDC>USAT:all'],
    ['convert 1,250 usdc into usat', 'USDC>USAT:1250'],
    ['convert 5 USDT to USAT', 'USDT>USAT:5'],
    ['convert to USAT from USDC', 'USDC>USAT:?'],
    ['swap from usdt to usat 20', 'USDT>USAT:20'],
  ])('%s → %s', (text, want) => expect(swap(text)).toBe(want));
});

describe('converting back, and between the other coins', () => {
  it.each([
    ['convert 5 USAT to USDC', 'USAT>USDC:5'],
    ['sell my USAT', 'USAT>USDC:?'],
    ['sell all my usat', 'USAT>USDC:all'],
    ['swap USAT back to USDC', 'USAT>USDC:?'],
    ['convert 10 USAT', 'USAT>USDC:10'],
    ['swap 5 USDC for USDT', 'USDC>USDT:5'],
    ['convert USDT to USDC', 'USDT>USDC:?'],
    ['swap 3 usdt to usdc', 'USDT>USDC:3'],
    ['convert 5 USAT to USDT', 'USAT>USDT:5'],
  ])('%s → %s', (text, want) => expect(swap(text)).toBe(want));
});

describe('answering "how much?"', () => {
  const prev = askSwapAmount('USDC', 'USAT');
  it.each([
    ['5', 'USDC>USAT:5'],
    ['$12.50', 'USDC>USAT:12.50'],
    ['25 usdc', 'USDC>USAT:25'],
    ['all', 'USDC>USAT:all'],
    ['everything', 'USDC>USAT:all'],
  ])('%s → %s', (text, want) => expect(swap(text, prev)).toBe(want));
  it('a non-answer is not a conversion', () => {
    expect(swap('what is my balance?', prev)).toBe('none');
    expect(swap('abc', prev)).toBe('none');
  });
  it('remembers the direction it asked about', () => {
    expect(swap('10', askSwapAmount('USAT', 'USDC'))).toBe('USAT>USDC:10');
  });
});

describe('things that are NOT conversions', () => {
  it.each([
    'send 5 USDC to @joyful',
    'send 5 USAT to @joyful',
    'pay @joyful $5',
    "what's my balance?",
    'change my pay token to USAT',
    'use USAT to buy Reddit posts',
    'I want to pay with USAT',
    'Buy ₦50,000 of USDT',
    'convert 100 USDT to naira',
    'How much is $50 in naira?',
    'what is USAT?',
    'bring USDC from Arbitrum',
    'somebody wants to send me USDC',
    'What can you do?',
    'hello',
  ])('no: %s', (text) => expect(swap(text)).toBe('none'));
});

describe('the ask', () => {
  it('names both coins so the next turn knows the direction', () => {
    expect(askSwapAmount('USDC', 'USAT')).toMatch(/How much USDC do you want to convert to USAT\?/);
  });
});
