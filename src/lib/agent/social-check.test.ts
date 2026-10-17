import { describe, expect, it } from 'vitest';
import { isSocialAccountCheck } from './buy-intent';

describe('isSocialAccountCheck', () => {
  it.each([
    'Check the Instagram account @lagos_kicks before I pay: is it legit?',
    'is @lagos_kicks legit?',
    'is this seller @kicks_ng a scam',
    'check @ada_designs on x before I pay her',
    'can I trust @sneaker_plug on tiktok',
  ])('%s → a social account', (t) => expect(isSocialAccountCheck(t)).toBe(true));

  it.each([
    'send 5 USDC to @chris',
    'request $10 from @joyful',
    'who is @chris',
    'is it legit?',
    'find me a vendor in Lagos',
    'transfer to @omoefe on instagram',
  ])('%s → not one', (t) => expect(isSocialAccountCheck(t)).toBe(false));
});
