import { describe, expect, it } from 'vitest';
import { PLATFORM_CHOICES, platformsFromChoice, shouldForceBuySearch, shouldOfferPlatformChoice } from './buy-intent';

describe('platformsFromChoice', () => {
  it.each([
    ['Search Instagram', ['instagram']],
    ['Search TikTok', ['tiktok']],
    ['Search X', ['x']],
    ['Search Instagram, TikTok and X', ['instagram', 'tiktok', 'x']],
    ['tiktok and x', ['tiktok', 'x']],
    ['instagram', ['instagram']],
    ['X and instagram', ['instagram', 'x']],
    ['search twitter', ['x']],
    ['TikTok.', ['tiktok']],
  ])('"%s" → %j', (text, want) => expect(platformsFromChoice(text)).toEqual(want));

  it.each(['find me sneakers on instagram', 'what are people saying on tiktok', 'x marks the spot', 'search the web', 'tiktok is great for vendors', ''])('"%s" is not a platform choice', (text) => expect(platformsFromChoice(text)).toBeNull());

  it('every button sends a message that reads back as exactly its own platforms', () => {
    expect(PLATFORM_CHOICES.map((c) => platformsFromChoice(c.text))).toEqual([['instagram'], ['tiktok'], ['x'], ['instagram', 'tiktok', 'x']]);
  });
});

describe('platform buttons', () => {
  const u = (content: string) => ({ role: 'user' as const, content });
  const a = (content: string) => ({ role: 'assistant' as const, content });
  it('are offered when the agent asks which platform, after a find request', () => {
    expect(shouldOfferPlatformChoice([u('find me a sneaker vendor in Lagos')], 'Which platform should I search for sellers — Instagram, TikTok or X?')).toBe(true);
  });
  it('are not offered for other questions or other conversations', () => {
    expect(shouldOfferPlatformChoice([u('find me a sneaker vendor in Lagos')], 'Which city are you in?')).toBe(false);
    expect(shouldOfferPlatformChoice([u('what is my balance')], 'Do you want Instagram, TikTok or X?')).toBe(false);
  });
  it('a platform answer in the middle of finding sellers does not trigger a catalog search for a TikTok scraper', () => {
    const convo = [u('find me a sneaker vendor in Lagos'), a('Which platform should I search for sellers — Instagram, TikTok or X?'), u('Search TikTok')];
    expect(shouldForceBuySearch(convo)).toBe(false);
  });
  it('but a plain social-data request still does', () => {
    expect(shouldForceBuySearch([u('what are people saying on reddit about celo')])).toBe(true);
  });
});
