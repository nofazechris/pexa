import { describe, expect, it } from 'vitest';
import { askHowMuch, askWho, extractAmount, extractRecipient, parseSendSlots, type TurnMessage } from './send-intent';

const u = (content: string): TurnMessage => ({ role: 'user', content });
const a = (content: string): TurnMessage => ({ role: 'assistant', content });
const ADDR = '0x52c23C312B27c8361BC37E7c8429F0328c7F5F2A';

describe('your exact conversations', () => {
  it('everything in one message → nothing to ask', () => {
    expect(parseSendSlots([u('Send 1 USDC to joyful')])).toEqual({ wantsSend: true, amount: '1', recipient: 'joyful' });
    expect(parseSendSlots([u('send $5 to @amy_k')])).toEqual({ wantsSend: true, amount: '5', recipient: 'amy_k' });
  });

  it('"I want to send 1 USDC" → "joyful": the amount is remembered, not asked again', () => {
    const s = parseSendSlots([u('I want to send 1 USDC'), a(askWho('1', [])), u('joyful')]);
    expect(s).toEqual({ wantsSend: true, amount: '1', recipient: 'joyful' });
  });

  it('"send money to joyful" → "1 USDC": the name is remembered, only the amount is asked', () => {
    const first = parseSendSlots([u('send money to joyful')]);
    expect(first).toEqual({ wantsSend: true, amount: null, recipient: 'joyful' });
    const second = parseSendSlots([u('send money to joyful'), a(askHowMuch('joyful')), u('1 USDC')]);
    expect(second).toEqual({ wantsSend: true, amount: '1', recipient: 'joyful' });
  });

  it('a bare number answers "how much"', () => {
    expect(parseSendSlots([u('pay joyful'), a(askHowMuch('joyful')), u('25')])).toMatchObject({ amount: '25', recipient: 'joyful' });
  });

  it('nothing given → asks for both, once', () => {
    expect(parseSendSlots([u('I want to send money')])).toEqual({ wantsSend: true, amount: null, recipient: null });
  });
});

describe('amounts', () => {
  it.each([
    ['send 1 USDC', '1'], ['send $5', '5'], ['send 2.5 usdc', '2.5'], ['pay 10 dollars', '10'], ['send one usdc', '1'], ['send fifty bucks', '50'], ['give a dollar', '1'], ['send 0.25', '0.25'],
  ])('%s → %s', (t, n) => expect(extractAmount(t)).toBe(n));

  it('does not mistake digits inside a username or an address for an amount', () => {
    expect(extractAmount('send money to user123')).toBeNull();
    expect(extractAmount(`send to ${ADDR}`)).toBeNull();
    expect(extractAmount('send to @bob2')).toBeNull();
  });
  it('ignores zero', () => expect(extractAmount('send 0 usdc')).toBeNull());
});

describe('recipients', () => {
  it.each([
    ['send 1 to @joyful', 'joyful'], ['send 1 usdc to joyful', 'joyful'], ['pay joyful 5 usdc', 'joyful'], ['send joyful 5', 'joyful'], ['transfer 3 to Omoefe', 'omoefe'], ['send 5 to PX7K2M9Q', 'PX7K2M9Q'], [`send 5 to ${ADDR}`, ADDR],
  ])('%s → %s', (t, r) => expect(extractRecipient(t)).toBe(r));

  it('does not treat filler words as a name', () => {
    expect(extractRecipient('send 1 usdc to me')).toBeNull();
    expect(extractRecipient('send money to him')).toBeNull();
    expect(extractRecipient('send it to someone')).toBeNull();
    expect(extractRecipient('send money')).toBeNull();
  });
  it('takes the latest @mention', () => expect(extractRecipient('not @bob, send to @amy')).toBe('amy'));
  it('a UID or address as a bare reply works', () => {
    expect(parseSendSlots([u('send 2 usdc'), a(askWho('2', [])), u('px7k2m9q')]).recipient).toBe('PX7K2M9Q');
    expect(parseSendSlots([u('send 2 usdc'), a(askWho('2', [])), u(ADDR)]).recipient).toBe(ADDR);
  });
});

describe('knowing when it is NOT a plain send', () => {
  it.each([
    "What's my balance?", 'Request $20 from @mike', 'send naira to my bank', 'withdraw 50 usdc', 'pay @sarah $20 every Friday', 'swap usdc for usdt', 'I sent money to chris', 'Save 10% of what I receive',
    'What is Reddit saying about Celo today?', 'yes', 'thanks',
    'Who did I pay or receive from recently?', 'who did I send money to last week', 'have I paid chris before?', 'show me my recent payments', 'did I send joyful anything',
    'What is the last time I paid amy',
  ])('%s', (t) => expect(parseSendSlots([u(t)]).wantsSend).toBe(false));

  it('a stray "yes" after an unrelated question is not a send', () => {
    expect(parseSendSlots([u('what can I buy'), a('Want me to look?'), u('yes')]).wantsSend).toBe(false);
  });
  it('a name reply is not a send unless we were asking who to send to', () => {
    expect(parseSendSlots([u('who is my friend'), a('Which friend do you mean?'), u('joyful')]).wantsSend).toBe(false);
  });
  it('a send from an earlier, finished request does not leak into a new, unrelated message', () => {
    expect(parseSendSlots([u('send 5 to @amy'), a('Confirm below.'), u("what's my balance?")]).wantsSend).toBe(false);
  });
});

describe('the questions it asks recognise their own answers', () => {
  it('askWho / askHowMuch are detected as questions', () => {
    expect(parseSendSlots([u('send 3 usdc'), a(askWho('3', ['joyful', 'omoefe'])), u('omoefe')])).toMatchObject({ amount: '3', recipient: 'omoefe' });
    expect(parseSendSlots([u('send to @joyful'), a(askHowMuch('joyful')), u('$7')])).toMatchObject({ amount: '7', recipient: 'joyful' });
  });
  it('mentions recent people when it has them', () => {
    expect(askWho('1', ['joyful', 'omoefe'])).toContain('@joyful, @omoefe');
    expect(askWho(null, [])).not.toContain('Your recent');
  });
});
