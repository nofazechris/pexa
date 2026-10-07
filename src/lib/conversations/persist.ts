/**
 * What gets saved of a chat, and how it comes back. Pure (no server/browser imports): the browser and the
 * server both run it, so the rules hold even if one side is bypassed.
 *
 * The one rule that matters: a saved chat must never revive something that can move money. Signing data is
 * dropped before saving, and any card that was still waiting for a tap comes back inert ("restored").
 */

export type SavedMessage = Record<string, unknown>;

export const MAX_SAVED_MESSAGES = 200;
export const MAX_SAVED_BYTES = 400_000;
const MAX_TEXT = 4000;
const MAX_RESULT_CHARS = 4000;
const MAX_TITLE = 60;

const KEEP = new Set(['id', 'role', 'type', 'text', 'kind', 'preview', 'receive', 'buy', 'buyResult', 'recurring', 'recurringResult', 'quote', 'order', 'result', 'status', 'execTool', 'execArgs', 'title', 'hint', 'retryText', 'restored']);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function clipResult(output: unknown): unknown {
  if (output === null || output === undefined) return undefined;
  let s: string;
  try {
    s = typeof output === 'string' ? output : JSON.stringify(output);
  } catch {
    return undefined;
  }
  return s.length > MAX_RESULT_CHARS ? s.slice(0, MAX_RESULT_CHARS) + '… (shortened)' : output;
}

/** One message in its saveable form: known fields only, no signing data, bounded text and results. */
function cleanMessage(raw: unknown): SavedMessage | null {
  if (!isObj(raw) || (raw.role !== 'user' && raw.role !== 'agent')) return null;
  const out: SavedMessage = {};
  for (const [k, v] of Object.entries(raw)) if (KEEP.has(k) && v !== undefined) out[k] = v;

  if (typeof out.text === 'string' && out.text.length > MAX_TEXT) out.text = out.text.slice(0, MAX_TEXT) + '…';

  if (isObj(out.buy)) {
    const { typedData: _drop, ...rest } = out.buy; // the signable authorization is never stored
    void _drop;
    out.buy = rest;
  }
  if (isObj(out.buyResult)) {
    const r = { ...out.buyResult };
    if ('output' in r) {
      const clipped = clipResult(r.output);
      if (clipped === undefined) delete r.output;
      else r.output = clipped;
    }
    out.buyResult = r;
  }
  return out;
}

/** Bounded, cleaned messages ready to store (newest kept), or an empty list when there's nothing worth saving. */
export function prepareForSave(raw: unknown): SavedMessage[] {
  if (!Array.isArray(raw)) return [];
  const cleaned = raw.map(cleanMessage).filter((m): m is SavedMessage => m !== null).slice(-MAX_SAVED_MESSAGES);
  // Drop the oldest until it fits the size cap.
  while (cleaned.length > 1 && JSON.stringify(cleaned).length > MAX_SAVED_BYTES) cleaned.shift();
  return cleaned;
}

/** A readable title: the first thing the user asked. */
export function deriveTitle(messages: readonly SavedMessage[]): string {
  const first = messages.find((m) => m.role === 'user' && typeof m.text === 'string' && m.text.trim());
  const t = typeof first?.text === 'string' ? first.text.replace(/\s+/g, ' ').trim() : '';
  if (!t) return 'New chat';
  return t.length > MAX_TITLE ? t.slice(0, MAX_TITLE - 1).trimEnd() + '…' : t;
}

/** Messages as they should appear when a saved chat is reopened: anything still "awaiting" a tap is made inert. */
export function restoreMessages(raw: unknown): { messages: SavedMessage[]; nextId: number } {
  const cleaned = prepareForSave(raw);
  let maxId = 0;
  const messages = cleaned.map((m, i) => {
    const id = typeof m.id === 'number' && Number.isFinite(m.id) ? m.id : i + 1;
    maxId = Math.max(maxId, id);
    if (m.status === 'awaiting') return { ...m, id, status: 'cancelled', restored: true };
    return { ...m, id };
  });
  return { messages, nextId: maxId + 1 };
}

/** Is this chat worth saving? A chat with no user message isn't. */
export function isWorthSaving(messages: readonly SavedMessage[]): boolean {
  return messages.some((m) => m.role === 'user');
}
