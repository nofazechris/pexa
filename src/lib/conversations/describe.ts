/**
 * What was on screen, in words. The agent only ever receives the chat as text, so a card (an address, a payment preview, a
 * receipt…) used to be invisible to it: after Pexa showed a deposit address and the person said "check", the AI had no idea
 * what "check" referred to. These one-line notes give it the same view the person has.
 *
 * Pure: the browser builds them for each turn, and the same function writes the "where we left off" summary.
 */

export interface ChatLike {
  role: 'user' | 'agent';
  type?: string;
  text?: string;
  kind?: string;
  status?: string;
  preview?: { recipient?: string; amount?: string; token?: string; external?: boolean };
  bridge?: { chain?: string };
  swap?: { amountIn?: string; from?: string; to?: string; expectedOut?: string };
  swapResult?: { ok?: boolean; amountOut?: string | null; error?: string };
  statement?: { label?: string; count?: number };
  research?: { title?: string; estimate?: string; cap?: string };
  researchResult?: { request?: { kind?: string; what?: string; place?: string }; items?: { handle?: string | null; name?: string; verdictLabel?: string }[] };
  result?: { status?: string };
  title?: string;
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

/** A note for a card message, or null for plain text / nothing worth saying. */
export function describeCard(m: ChatLike): string | null {
  switch (m.type) {
    case 'preview': {
      const p = m.preview;
      const what = p ? `${p.amount ?? '?'} ${p.token ?? 'USDC'} to ${p.recipient ?? 'someone'}${p.external ? ' (a wallet outside Pexa)' : ''}` : 'a payment';
      return `[Showed a confirm card to send ${what}${m.status === 'cancelled' ? ' — it was cancelled' : m.status === 'awaiting' ? ' — waiting for the person to tap Confirm' : ''}]`;
    }
    case 'receipt': {
      const p = m.preview;
      return `[Showed a payment receipt: ${p?.amount ?? '?'} ${p?.token ?? 'USDC'} to ${p?.recipient ?? 'someone'} — ${m.result?.status ?? 'confirmed'}]`;
    }
    case 'receive':
      return '[Showed the person’s own Celo wallet address (and QR) so they can receive money on Celo]';
    case 'bridge':
      return `[Showed the ${m.bridge?.chain ?? 'cross-network'} deposit address: USDC sent there on ${m.bridge?.chain ?? 'that network'} arrives in the person’s Pexa wallet as USDC on Celo. The person may be waiting to see if their deposit arrived]`;
    case 'swap_preview':
      return `[Showed a conversion quote: ${m.swap?.amountIn ?? '?'} ${m.swap?.from ?? ''} → about ${m.swap?.expectedOut ?? '?'} ${m.swap?.to ?? ''}${m.status === 'awaiting' ? ' — waiting for Confirm' : ''}]`;
    case 'swap_receipt':
      return m.swapResult?.ok ? `[Showed the conversion result: received ${m.swapResult.amountOut ?? 'the amount'} ${m.swap?.to ?? ''}]` : `[Showed that a conversion did not complete: ${clip(m.swapResult?.error ?? 'error', 80)}]`;
    case 'recurring_preview':
      return '[Showed a card to set up a repeating payment — waiting for Confirm]';
    case 'recurring_receipt':
      return '[Showed the result of setting up a repeating payment]';
    case 'buy_quote':
      return '[Showed a Buy purchase price waiting for approval]';
    case 'buy_result':
      return '[Showed the result of a Buy purchase]';
    case 'fiat_quote':
    case 'fiat_receipt':
      return '[Showed a naira conversion card]';
    case 'intro':
      return '[Showed a list of what Pexa can do]';
    case 'statement':
      return `[Showed a statement${m.statement?.label ? ` for ${m.statement.label}` : ''}${typeof m.statement?.count === 'number' ? ` with ${m.statement.count} items` : ''}, with Download and Print buttons]`;
    case 'ask_location':
      return '[Showed a button for the person to share their area (a neighbourhood name, not exact coordinates), because the assistant asked where they are]';
    case 'research_plan':
      return `[Showed a plan to search for “${m.research?.title ?? 'a vendor'}” — about ${m.research?.estimate ?? '?'}, never more than ${m.research?.cap ?? '?'}${m.status === 'awaiting' ? ' — waiting for the person to tap Approve' : m.status === 'cancelled' ? ' — it was cancelled' : ''}]`;
    case 'research_result': {
      const r = m.researchResult;
      const who = (r?.items ?? []).slice(0, 5).map((i) => `${i.handle ?? i.name ?? 'someone'} (${(i.verdictLabel ?? '').toLowerCase()})`).join(', ');
      const kind = r?.request?.kind === 'hire' ? 'hiring' : 'vendor';
      return `[Showed a ${kind} shortlist for ${r?.request?.what ?? 'what they asked'}${r?.request?.place ? ` in ${r.request.place}` : ''}: ${who || 'nobody found'}. The cards show each one’s facts and a message to send them]`;
    }
    case 'error':
      return `[Showed an error: ${clip(m.title ?? 'something went wrong', 80)}]`;
    default:
      return null;
  }
}

/** The chat as the agent should see it: text as said, cards as short notes. Newest `limit` entries. */
export function historyForAgent(messages: readonly ChatLike[], limit = 16): { role: 'user' | 'assistant'; content: string }[] {
  const out: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      if (m.text) out.push({ role: 'user', content: m.text });
    } else if (m.type === 'text' || m.type === undefined) {
      if (m.text) out.push({ role: 'assistant', content: m.text });
    } else {
      const note = describeCard(m);
      if (note) out.push({ role: 'assistant', content: note });
    }
  }
  return out.slice(-limit);
}

/** A short "where we left off" for starting a new chat from a closed one. */
export function carryOverSummary(messages: readonly ChatLike[], title: string, closedLabel: string | null): string {
  const lines: string[] = [];
  for (const m of messages.slice(-14)) {
    if (m.role === 'user' && m.text) lines.push(`• You: ${clip(m.text.replace(/\s+/g, ' '), 140)}`);
    else if (m.role === 'agent' && m.type === 'text' && m.text) lines.push(`• Pexa: ${clip(m.text.replace(/\s+/g, ' '), 160)}`);
    else {
      const note = describeCard(m);
      if (note) lines.push(`• ${note.replace(/^\[|\]$/g, '')}`);
    }
  }
  const recent = lines.slice(-6);
  return [`Continuing from your earlier chat “${clip(title, 50)}”${closedLabel ? ` (closed ${closedLabel})` : ''}. Here’s where we left off:`, ...recent, '', 'Tell me what you’d like to do next.'].join('\n');
}
