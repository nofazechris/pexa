import { stepAsked } from '@/lib/profile/investor';

/**
 * The request the person made before the "get to know you" questions started: the user message just before the FIRST question of
 * the run. The run is the questions, the "buttons were shown" notes after them, and the person's answers; it ends at the first
 * assistant message that is none of those. Pure.
 */
export function originalRequest(messages: readonly { role: 'user' | 'assistant'; content: string }[]): string | null {
  let first = -1;
  for (let i = messages.length - 2; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'user') continue; // an answer inside the run
    if (stepAsked(m.content)) first = i;
    else if (m.content.startsWith('[Showed buttons')) continue; // the note that follows a question with buttons
    else break;
  }
  const before = first > 0 ? messages[first - 1] : null;
  return before?.role === 'user' ? before.content : null;
}
