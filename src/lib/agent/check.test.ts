import { describe, expect, it } from 'vitest';
import { checkTopic, isCheckRequest, whatToCheck, type TurnMessage } from './check';

const u = (content: string): TurnMessage => ({ role: 'user', content });
const a = (content: string): TurnMessage => ({ role: 'assistant', content });

describe('isCheckRequest — short "has it happened yet?" messages', () => {
  it.each([
    'check', 'Check', 'check now', 'check again', 'please check', 'can you check?', 'check it', 'ok check', 'refresh', 'update', 'status', 'verify',
    'check my deposit', 'check if it arrived', 'check the transfer', 'did it arrive?', 'has it arrived', 'has my deposit arrived yet', 'is it there?',
    'did my money come', 'did it go through', 'did the deposit land', 'any update?', 'any news', 'is there any update',
  ])('yes: %s', (t) => expect(isCheckRequest(t)).toBe(true));

  it.each([
    '', 'hello', 'send 5 to @joyful', 'what can you do?', 'Is this Instagram vendor legit?', 'check balance of my vault please and also explain how savings work in detail',
    'I want to receive on arc', 'convert $5 to USAT',
  ])('no: %s', (t) => expect(isCheckRequest(t)).toBe(false));
});

describe('checkTopic — what was last on screen', () => {
  it('a deposit address means a deposit', () => {
    expect(checkTopic([u('I want to receive on arc'), a('Here’s the Arc address. Give it to whoever is sending… I’ll notify you when it lands.')])).toBe('deposit');
    expect(checkTopic([a('[Showed the Arc deposit address: USDC sent there arrives in the person’s Pexa wallet as USDC on Celo. The person may be waiting to see if their deposit arrived]')])).toBe('deposit');
    expect(checkTopic([a('Here’s your wallet address. Send USDC on Celo to it and I’ll tell you when it lands.')])).toBe('deposit');
  });
  it('a payment preview means a payment, a conversion quote means a conversion', () => {
    expect(checkTopic([a('Sending 5 USDC to @joyful — confirm below.')])).toBe('payment');
    expect(checkTopic([a('[Showed a conversion quote: 5 USDC → about 5.005 USAT]')])).toBe('swap');
  });
  it('the most recent thing wins', () => {
    expect(checkTopic([a('Here’s the Arc deposit address'), a('Sending 5 USDC to @joyful — confirm below.')])).toBe('payment');
  });
  it('nothing relevant on screen → unknown', () => {
    expect(checkTopic([a('Your balance is $2.83 USDC.')])).toBe('unknown');
    expect(checkTopic([])).toBe('unknown');
  });
});

describe('whatToCheck — the whole decision', () => {
  it('"check" right after a deposit address is a deposit check (your exact conversation)', () => {
    expect(whatToCheck([u('I want to receive on arc'), a('Here’s the Arc address. Give it to whoever is sending (or use it from your own wallet)… I’ll notify you when it lands.'), u('check')])).toBe('deposit');
  });
  it('works through the card note too', () => {
    expect(whatToCheck([u('receive on arbitrum'), a('Here’s the Arbitrum address…'), a('[Showed the Arbitrum deposit address: … The person may be waiting to see if their deposit arrived]'), u('did it arrive?')])).toBe('deposit');
  });
  it('a check about a seller or account is NOT a deposit check', () => {
    expect(whatToCheck([a('Here’s the Arc address… I’ll notify you when it lands.'), u('check this seller')])).toBeNull();
    expect(whatToCheck([a('Here’s the Arc address… I’ll notify you when it lands.'), u('check @sneakerplug_ng')])).toBeNull();
  });
  it('a bare "check" with nothing on screen is left to the AI (unknown), not forced', () => {
    expect(whatToCheck([u('hi'), a('Hello! How can I help?'), u('check')])).toBe('unknown');
  });
  it('anything that is not a check is not decided here', () => {
    expect(whatToCheck([a('Here’s the Arc address.'), u('send 5 to joyful')])).toBeNull();
    expect(whatToCheck([a('Here’s the Arc address.')])).toBeNull();
  });
});
