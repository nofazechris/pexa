import { describe, expect, it } from 'vitest';
import { assistantRun } from './history';
import { QUESTION, stepAsked } from '@/lib/profile/investor';
import { askEarnToken, parseEarnIntent } from '@/lib/earn/intent';

const u = (content: string) => ({ role: 'user' as const, content });
const a = (content: string) => ({ role: 'assistant' as const, content });

describe('what Pexa last said', () => {
  it('is the message right before the reply when nothing sat in between', () => {
    expect(assistantRun([u('hi'), a('How much USDC do you want to deposit into Aave?'), u('5')])).toBe('How much USDC do you want to deposit into Aave?');
  });
  it('sees through the "buttons were shown" note that follows a question', () => {
    const run = assistantRun([u('where can I invest'), a(QUESTION.risk), a('[Showed buttons for the person to choose: Play it safe / A balance / Go for growth / Skip for now]'), u('I can handle big swings for growth')]);
    expect(run).toContain(QUESTION.risk);
    expect(stepAsked(run)).toBe('risk');
  });
  it('only looks at the run just before the reply, not older questions', () => {
    const run = assistantRun([a(QUESTION.risk), u('safe'), a('Thanks'), u('hello')]);
    expect(run).toBe('Thanks');
    expect(stepAsked(run)).toBeNull();
  });
  it('is undefined when the reply is the first message or follows another person message', () => {
    expect(assistantRun([u('hello')])).toBeUndefined();
    expect(assistantRun([u('a'), u('b')])).toBeUndefined();
  });
  it('lets a tap on a coin button answer "Which coin…?" even with the note in between', () => {
    const run = assistantRun([u('deposit $10 into aave'), a(askEarnToken('deposit', '10')), a('[Showed buttons for the person to choose: USDT / USDC]'), u('USDC')]);
    expect(parseEarnIntent('USDC', run)).toEqual({ kind: 'earn', action: 'deposit', token: 'USDC', amount: '10' });
  });
});
