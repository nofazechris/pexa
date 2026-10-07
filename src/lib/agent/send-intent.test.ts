import { describe, expect, it } from 'vitest';
import { askHowMuch, askWho, extractAmount, extractRecipient, parseSendSlots, replyToTypedAnswer, type TurnMessage } from './send-intent';

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

describe('an old send must never leak into a new request (the "add to vault" → sent $1 bug)', () => {
  const sentCard = a('Sending 1 USDC to @joyful (PX3STC3A) — confirm below.');

  it('the exact sequence from the screenshot: "1" answers the VAULT question, not an old send', () => {
    const s = parseSendSlots([
      u('Send 1 USDC to joyful'),
      sentCard,
      u('Add money to my "My Savings" vault'),
      a('How much USDC would you like to add to your "My Savings" vault?'),
      u('1'),
    ]);
    expect(s.wantsSend).toBe(false);
  });

  it('a "how much" question about anything but sending is never a send question', () => {
    for (const q of ['How much would you like to add to your vault?', 'How much would you like to withdraw?', 'How much do you want to save?', 'How much is it worth?']) {
      expect(parseSendSlots([u('send 1 USDC to joyful'), sentCard, u('hi'), a(q), u('5')]).wantsSend).toBe(false);
    }
  });

  it('a fresh "send money" does not inherit the amount or person from an earlier, finished send', () => {
    expect(parseSendSlots([u('Send 1 USDC to joyful'), sentCard, u('I want to send money')])).toEqual({ wantsSend: true, amount: null, recipient: null });
  });

  it('a fresh send names its own details and ignores the old ones', () => {
    expect(parseSendSlots([u('Send 1 USDC to joyful'), sentCard, u('send 5 to omoefe')])).toEqual({ wantsSend: true, amount: '5', recipient: 'omoefe' });
  });

  it('changing the subject while a question is open is not an answer', () => {
    expect(parseSendSlots([u('send money to joyful'), a(askHowMuch('joyful')), u("what's my balance?")]).wantsSend).toBe(false);
    expect(parseSendSlots([u('send money to joyful'), a(askHowMuch('joyful')), u('save 10% of what I receive')]).wantsSend).toBe(false);
  });

  it('"cancel" / "never mind" ends the exchange', () => {
    for (const w of ['cancel', 'never mind', 'No', 'stop', "don't"]) {
      expect(parseSendSlots([u('send money to joyful'), a(askHowMuch('joyful')), u(w)]).wantsSend).toBe(false);
    }
  });

  it('two questions in a row still chain: who, then how much', () => {
    const s = parseSendSlots([u('I want to send money'), a('Sure — who should I send to, and how much? Give me their @username and the amount.'), u('joyful'), a(askHowMuch('joyful')), u('3')]);
    expect(s).toEqual({ wantsSend: true, amount: '3', recipient: 'joyful' });
  });

  it('each of the app’s own questions is recognised as a send question (so its answer is read)', () => {
    const qs = [
      'Sure — who should I send to, and how much? Give me their @username and the amount.',
      askWho('2', ['omoefe']),
      askHowMuch('joyful'),
      'A few of your people match "chr" — which one should I send to?\n• @chris (PXAY2KWJ)\n• @chris_ng (PXZZ7K2M)\nReply with the @username or UID.',
      'I couldn’t find anyone called "zzz" on Pexa. Who should I send to instead? Check the spelling or give me their @username.',
      'That’s your own account. Who should I send 1 USDC to instead? Give me their @username.',
    ];
    for (const q of qs) expect(parseSendSlots([u('send 1 USDC'), a(q), u('joyful')]).wantsSend, q).toBe(true);
  });
});

describe('several payments in one message', () => {
  it('two people → flagged, never quietly turned into one wrong payment', () => {
    expect(parseSendSlots([u('Send 1 USDC to @joyful and 2 to @omoefe')]).multiple).toBe(true);
    expect(parseSendSlots([u('send 5 usdc to joyful and omoefe')]).multiple).toBe(true);
  });
  it('two clear amounts → flagged', () => {
    expect(parseSendSlots([u('send $5 and 2 USDC to joyful')]).multiple).toBe(true);
  });
  it('a normal send, or digits in a note, is not "multiple"', () => {
    expect(parseSendSlots([u('Send 1 USDC to joyful')]).multiple).toBeUndefined();
    expect(parseSendSlots([u('send 5 USDC to joyful for 2 days of lunch')]).multiple).toBeUndefined();
    expect(parseSendSlots([u('send 5 to @joyful, @joyful')]).multiple).toBeUndefined();
  });
});

describe('typing "yes" / "cancel" under a waiting card', () => {
  const payCard = a('Sending 1 USDC to @joyful (PX3STC3A) — confirm below.');
  const buyCard = a('Search Reddit costs $0.006. Approve it below and I’ll run it.');

  it('"yes" tells you to tap the button — it never sends and never makes a second card', () => {
    for (const y of ['yes', 'Yes please', 'ok', 'confirm', 'send it', 'go ahead']) {
      expect(replyToTypedAnswer([u('Send 1 USDC to joyful'), payCard, u(y)])).toMatch(/tap .*Confirm payment/i);
    }
    expect(replyToTypedAnswer([u('reddit'), buyCard, u('yes')])).toMatch(/tap .*Approve/i);
  });

  it('"cancel" / "no" says nothing was sent', () => {
    for (const n of ['cancel', 'no', 'Cancel that', 'never mind']) expect(replyToTypedAnswer([u('Send 1 USDC to joyful'), payCard, u(n)])).toMatch(/nothing was sent/i);
  });

  it('only applies right after a card, and only to a bare yes/no', () => {
    expect(replyToTypedAnswer([u('hi'), a('Hello!'), u('yes')])).toBeNull();
    expect(replyToTypedAnswer([u('send 1 to joyful'), payCard, u('actually make it 5')])).toBeNull();
    expect(replyToTypedAnswer([u('yes')])).toBeNull();
    expect(replyToTypedAnswer([payCard, u('x'), a('ok'), u('yes')])).toBeNull();
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
