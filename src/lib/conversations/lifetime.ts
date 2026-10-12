/**
 * Chats don't stay open forever: seven days after a chat starts it closes. A closed chat can still be read, but to carry on
 * the person starts a new one (and Pexa brings over where they left off). Pure, so the server and the screen agree.
 */

export const CHAT_LIFETIME_DAYS = 7;
export const CHAT_LIFETIME_MS = CHAT_LIFETIME_DAYS * 24 * 60 * 60 * 1000;

const toMs = (v: Date | string | number): number => (v instanceof Date ? v.getTime() : typeof v === 'number' ? v : new Date(v).getTime());

/** When a chat that started at `createdAt` closes. */
export function closesAt(createdAt: Date | string | number): Date {
  return new Date(toMs(createdAt) + CHAT_LIFETIME_MS);
}

/** Has it closed? (Exactly seven days after it started counts as closed.) */
export function isClosed(createdAt: Date | string | number, now: number = Date.now()): boolean {
  return now >= toMs(createdAt) + CHAT_LIFETIME_MS;
}

const dateLabel = (d: Date) => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

/** The sentence shown at the top of a chat. `closesAtIso` is unknown for a chat that hasn't been saved yet. */
export function lifetimeNote(state: { closesAtIso: string | null; closed: boolean }): string {
  if (state.closed) {
    const when = state.closesAtIso ? ` on ${dateLabel(new Date(state.closesAtIso))}` : '';
    return `This chat closed${when}. You can read it, but to carry on, start a new chat — I’ll bring over where we left off.`;
  }
  if (state.closesAtIso) return `This chat closes on ${dateLabel(new Date(state.closesAtIso))}. Chats close ${CHAT_LIFETIME_DAYS} days after they start.`;
  return `Chats close ${CHAT_LIFETIME_DAYS} days after they start, so a chat never goes stale.`;
}
