import { describe, expect, it } from 'vitest';
import { isBuyConversation, isFindRequest, shouldForceBuySearch } from './buy-intent';

describe('isFindRequest', () => {
  it.each([
    'find me a sneaker vendor in Lagos',
    'who sells good wigs in Abuja?',
    'I need a graphic designer',
    'looking for a tailor in Yaba',
    'recommend a photographer near Ikeja',
    'I want to hire someone to build a website',
    'find an instagram seller for phones in Lagos',
    'graphic designer near me',
    'closest designer to me',
    'tailor nearby',
    'best photographer around me',
  ])('%s → find', (t) => expect(isFindRequest(t)).toBe(true));

  it.each([
    'is @lagos_kicks legit?',
    'is this instagram vendor a scam',
    'what is the weather in Lagos',
    'send 5 USDC to chris',
    'show me my transactions for the past 7 days',
    'what are people saying about celo on reddit',
  ])('%s → not a find', (t) => expect(isFindRequest(t)).toBe(false));
});

describe('how a find request is routed', () => {
  const user = (content: string) => [{ role: 'user' as const, content }];
  it('is not forced into a catalog search (the agent plans a research instead)', () => {
    expect(shouldForceBuySearch(user('find me an instagram vendor for sneakers in Lagos'))).toBe(false);
  });
  it('still forces a catalog search for plain social-data requests', () => {
    expect(shouldForceBuySearch(user('what are people saying on reddit about celo'))).toBe(true);
  });
  it('uses the stronger model for the whole find conversation, including the city answer', () => {
    const convo = [
      { role: 'user' as const, content: 'I need a graphic designer' },
      { role: 'assistant' as const, content: 'Which city should I look in?' },
      { role: 'user' as const, content: 'Lagos' },
    ];
    expect(isBuyConversation(convo)).toBe(true);
  });
  it('keeps going after a shortlist is shown', () => {
    const convo = [
      { role: 'assistant' as const, content: '[Showed a vendor shortlist for sneakers in Lagos: @a (looks solid)]' },
      { role: 'user' as const, content: 'which one should I pick?' },
    ];
    expect(isBuyConversation(convo)).toBe(true);
  });
});
