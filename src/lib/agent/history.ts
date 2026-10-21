/**
 * What Pexa last said to the person, as the agent sees the chat. A question with buttons is TWO assistant entries in the history:
 * the question, then a note that buttons were shown. A reply to that question comes after both — so "the message before the reply"
 * is the note, not the question. This joins the whole run of assistant entries just before the person's latest message, so an
 * answer is recognised whether or not buttons sat in between. Pure.
 */

export interface HistoryEntry {
  role: 'user' | 'assistant';
  content: string;
}

/** The assistant entries right before the last message (which is the person's), joined; undefined when there are none. */
export function assistantRun(messages: readonly HistoryEntry[]): string | undefined {
  const parts: string[] = [];
  for (let i = messages.length - 2; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'assistant') break;
    parts.unshift(m.content);
  }
  return parts.length ? parts.join('\n') : undefined;
}
