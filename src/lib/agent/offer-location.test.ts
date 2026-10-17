import { describe, expect, it } from 'vitest';
import { shouldOfferLocation } from './buy-intent';

const u = (content: string) => ({ role: 'user' as const, content });
const a = (content: string) => ({ role: 'assistant' as const, content });

describe('shouldOfferLocation', () => {
  it('offers the button when the agent asks where, right after a find request', () => {
    expect(shouldOfferLocation([u('I need a graphic designer close to me')], 'Which area or city are you in?')).toBe(true);
    expect(shouldOfferLocation([u('find me a phone plug near me')], 'Could you tell me the city or neighbourhood?')).toBe(true);
  });
  it('still offers it when the person replied with something unhelpful in between', () => {
    expect(shouldOfferLocation([u('I need a tailor'), a('Which city are you in?'), u('hmm not sure')], 'Which area should I look in?')).toBe(true);
  });
  it('does not offer it when the question is not about a place', () => {
    expect(shouldOfferLocation([u('I need a graphic designer in Lagos')], 'What kind of design — logo, flyers or social posts?')).toBe(false);
  });
  it('does not offer it for questions that are not about finding someone', () => {
    expect(shouldOfferLocation([u('send 5 USDC to chris')], 'Which city is chris in?')).toBe(false);
    expect(shouldOfferLocation([u('what is my balance')], 'Where would you like it shown?')).toBe(false);
  });
  it('does not offer it for a statement', () => {
    expect(shouldOfferLocation([u('I need a designer')], 'Sure, looking in your area now.')).toBe(false);
  });
});
