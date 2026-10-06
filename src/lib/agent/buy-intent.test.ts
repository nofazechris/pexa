import { describe, expect, it } from 'vitest';
import { isBuyIntent, shouldForceBuySearch, type TurnMessage } from './buy-intent';

const u = (content: string): TurnMessage => ({ role: 'user', content });
const a = (content: string): TurnMessage => ({ role: 'assistant', content });

describe('isBuyIntent', () => {
  it.each([
    'What are people saying about stablecoins on X right now?',
    'what is reddit saying about celo today',
    'Check this instagram vendor @shoes_ng',
    'find flights from Lagos to London next month',
    'Run a script on a cloud VM that prints the date',
    'What can I buy on Buy? Show me the categories and some example prices.',
    'what are people tweeting about naira',
    'youtube videos about stablecoins',
    'Is anyone talking about us on twitter?',
  ])('yes: %s', (t) => expect(isBuyIntent(t)).toBe(true));

  it.each([
    'Send $5 to @amy',
    "What's my balance?",
    'Save 10% of every payment I get',
    'send x dollars to @bob',
    'I’m about to pay someone I found online. Can you check whether they’re legit before I send money?',
    'Add money to my wallet',
  ])('no: %s', (t) => expect(isBuyIntent(t)).toBe(false));
});

describe('shouldForceBuySearch', () => {
  it('forces on a plain Buy request', () => {
    expect(shouldForceBuySearch([u('what is reddit saying about celo')])).toBe(true);
  });
  it('forces on "yes" that accepts the assistant’s own offer to search', () => {
    expect(shouldForceBuySearch([u('What are people saying about stablecoins on X?'), a('I can search X for that. Would you like me to?'), u('yes')])).toBe(true);
  });
  it('does not force on a stray "ok" after a statement (no question was asked)', () => {
    expect(shouldForceBuySearch([u('what is reddit saying about celo'), a('It’s waiting for your approval below.'), u('ok')])).toBe(false);
  });
  it('does not force "yes" when the earlier request was not a Buy one', () => {
    expect(shouldForceBuySearch([u('send $5 to amy'), a('Send $5 to @amy?'), u('yes')])).toBe(false);
  });
  it('is false for empty input', () => {
    expect(shouldForceBuySearch([])).toBe(false);
  });
});

import { isBuyConversation } from './buy-intent';

describe('isBuyConversation', () => {
  it('is true while a Buy request is in the recent conversation, even for "yes" or a handle', () => {
    expect(isBuyConversation([u('what is reddit saying about celo'), a('Want me to?'), u('yes')])).toBe(true);
    expect(isBuyConversation([u('check someone for me'), a('Which platform and handle?'), u('their instagram is @sneakerplug_ng')])).toBe(true);
  });
  it('is true for the hidden post-approval follow-up', () => {
    expect(isBuyConversation([u('I approved the purchase (abc) and it went through. Read its result and answer my original request concisely.')])).toBe(true);
  });
  it('is false for ordinary money chat', () => {
    expect(isBuyConversation([u('send $5 to @amy'), a('Send $5 to @amy?'), u('yes')])).toBe(false);
  });
});
