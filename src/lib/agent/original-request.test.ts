import { describe, expect, it } from 'vitest';
import { QUESTION } from '@/lib/profile/investor';

// requestBeforeQuestions is private to the runtime; this mirrors its rule on the real history shape to pin it down.
import { originalRequest } from './original-request';

const u = (content: string) => ({ role: 'user' as const, content });
const a = (content: string) => ({ role: 'assistant' as const, content });
const note = a('[Showed buttons for the person to choose: x / y / z]');

describe('what the person first asked, before the questions', () => {
  const ask = 'find me stocks that are going viral';
  it('is found across questions, button notes and answers', () => {
    const chat = [u(ask), a(QUESTION.risk), note, u('safe'), a(QUESTION.horizon), note, u('1 to 3 years'), a(QUESTION.amount), note, u('300')];
    expect(originalRequest(chat)).toBe(ask);
  });
  it('is found when a question was re-asked after an answer it could not read', () => {
    const chat = [u(ask), a(QUESTION.risk), note, u('purple'), a('I didn’t quite catch that. ' + QUESTION.risk), note, u('safe')];
    expect(originalRequest(chat)).toBe(ask);
  });
  it('does not reach back past an unrelated assistant reply', () => {
    const chat = [u('older request'), a('Here you go.'), u(ask), a(QUESTION.risk), note, u('safe')];
    expect(originalRequest(chat)).toBe(ask);
  });
  it('is null when there were no questions', () => {
    expect(originalRequest([u('hi'), a('hello'), u('ok')])).toBeNull();
  });
});
