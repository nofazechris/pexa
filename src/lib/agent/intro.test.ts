import { describe, expect, it } from 'vitest';
import { buildIntro, introFeatures, isIntroRequest } from './intro';
import { extractAmount, extractRecipient, parseSendSlots } from './send-intent';
import { parseCadence } from './cadence';

describe('isIntroRequest — recognises people asking what the agent is', () => {
  it.each([
    'what do you do', 'What do you do?', 'what can you do', 'What can you do for me?', 'who are you', 'Who are you?', 'what are you',
    "what's pexa", 'What is Pexa?', 'what is this', 'what is this app', 'how does this work', 'how does pexa work?', 'how can you help me', 'what can pexa do',
    'introduce yourself', 'Please introduce yourself', 'tell me about yourself', 'tell me about pexa', 'what are your features', 'what are your capabilities',
    'help', 'help me', 'get started', 'give me a tour', 'what can I do here', 'what can i do with this', "I'm new", 'how do i use this', 'hi, what can you do?',
  ])('yes: %s', (t) => expect(isIntroRequest(t)).toBe(true));

  it.each([
    'What is Reddit saying about Celo today?', 'what do you think about @joyful', 'send 5 to joyful', "What's my balance?", 'what can I buy on Buy?', 'who is @joyful',
    'help me send 5 to joyful', 'what is my username', 'what are people saying about stablecoins on X right now', 'what do you do with my data in the vault', '',
    'who did I pay recently?', 'hello', 'thanks',
  ])('no: %s', (t) => expect(isIntroRequest(t)).toBe(false));

  it('ignores long messages that merely start the same way', () => {
    expect(isIntroRequest('what can you do ' + 'x'.repeat(100))).toBe(false);
  });
});

describe('what it promises', () => {
  it('lists the always-available features', () => {
    const titles = introFeatures({ buy: false, naira: false }).map((f) => f.title);
    expect(titles).toEqual(['Send money', 'Ask for money', 'Recurring payments', 'Add money', 'Balance & activity', 'Save automatically']);
  });

  it('adds Buy only where Buy exists, and naira only when it is public', () => {
    const none = introFeatures({ buy: false, naira: false }).map((f) => f.title).join('|');
    expect(none).not.toMatch(/Check before you pay|Look things up|Naira/);
    const buy = introFeatures({ buy: true, naira: false }).map((f) => f.title);
    expect(buy).toContain('Check before you pay');
    expect(buy).toContain('Look things up');
    expect(buy).not.toContain('Naira');
    expect(introFeatures({ buy: false, naira: true }).map((f) => f.title)).toContain('Naira');
  });

  it('the reply introduces itself and asks if they are ready', () => {
    const { reply } = buildIntro({ buy: true, naira: false });
    expect(reply).toMatch(/Pexa Agent/);
    expect(reply).toMatch(/Confirm/);
    expect(reply).toMatch(/ready/i);
  });

  it('every example is a real sentence that the app understands as written (no dead buttons)', () => {
    const send = introFeatures({ buy: true, naira: true }).find((f) => f.title === 'Send money')!;
    expect(parseSendSlots([{ role: 'user', content: send.example }])).toMatchObject({ wantsSend: true, amount: '5', recipient: 'joyful' });
    const rec = introFeatures({ buy: false, naira: false }).find((f) => f.title === 'Recurring payments')!;
    expect(parseSendSlots([{ role: 'user', content: rec.example }])).toMatchObject({ recurring: true, amount: '5', recipient: 'joyful', cadence: 'Every Friday' });
    expect(parseCadence(rec.example)).toEqual({ kind: 'ok', label: 'Every Friday' });
    expect(extractAmount(send.example)).toBe('5');
    expect(extractRecipient(send.example)).toBe('joyful');
  });

  it('no example is itself mistaken for "what do you do" (so tapping it does the thing, not the intro again)', () => {
    for (const f of introFeatures({ buy: true, naira: true })) expect(isIntroRequest(f.example), f.example).toBe(false);
  });
});
