'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Pexa's agent chat — the primary surface. Every message goes to the server-side tool-calling agent
 * (/api/agent/chat), which reads data, links bank accounts, quotes conversions and prepares money
 * moves. When the agent wants to move money it returns a pending action; the UI shows a confirm
 * card and only on the user's explicit Confirm does it execute — crypto sends via the client-sign
 * path, fiat via the server (/api/agent/execute). The model never moves money on its own.
 */

export type AgentState = 'idle' | 'thinking' | 'processing' | 'success' | 'error';

/** Mirrors the server's presentQuote / QuoteView. */
export interface FiatQuoteView {
  quoteId: string;
  side: 'buy' | 'sell';
  ngn: string;
  usdt: string;
  rate: string;
  feeNgn: string;
  estimatedReceive: string;
  estimatedReceiveCurrency: 'NGN' | 'USDT';
  expiresAt: string;
  sandbox: boolean;
}

/** The agent's pending action (mirrors the runtime's PendingAction). */
export interface PendingActionView {
  tool: string;
  args: Record<string, unknown>;
  render:
    | { type: 'payment_preview'; recipient: string; amount: string; token: string; network: string }
    | { type: 'fiat_quote'; quote: FiatQuoteView };
}

export interface ChatMessage {
  id: number;
  role: 'user' | 'agent';
  type?: 'text' | 'preview' | 'fiat_quote' | 'receipt' | 'fiat_receipt' | 'error';
  text?: string;
  /** Card payloads. */
  kind?: 'send' | 'buy' | 'sell';
  preview?: { recipient: string; amount: string; token: string; network: string };
  quote?: FiatQuoteView;
  order?: { orderId: string; status: string };
  result?: { status: string; txHash?: string | null; explorerUrl?: string | null };
  status?: 'awaiting' | 'confirmed' | 'cancelled' | 'failed';
  /** The action to run on confirm (fiat path). */
  execTool?: string;
  execArgs?: Record<string, unknown>;
  /** Error card. */
  title?: string;
  hint?: string;
}

export interface AgentChatDeps {
  /** Send a message to the agent; returns its reply and any pending action. */
  sendToAgent: (args: {
    message: string;
    history: { role: 'user' | 'assistant'; content: string }[];
  }) => Promise<{ reply: string; action?: PendingActionView } | null>;
  /** Execute a confirmed fiat action server-side. */
  executeAction: (args: { tool: string; args: Record<string, unknown> }) => Promise<{
    ok: boolean;
    result?: { order?: { orderId: string; status: string }; [k: string]: unknown };
    error?: string;
  }>;
  /** Execute a confirmed crypto send via the client-sign path (real on-chain outcome). */
  executeSend: (args: { recipient: string; amount: string }) => Promise<{
    ok: boolean;
    error?: string;
    status?: 'confirmed' | 'pending' | 'failed';
    txHash?: string | null;
    explorerUrl?: string | null;
  }>;
}

export function useAgentChat(deps: AgentChatDeps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [agentState, setAgentState] = useState<AgentState>('idle');
  const [draft, setDraft] = useState('');
  const idRef = useRef(1);
  const depsRef = useRef(deps);
  useEffect(() => {
    depsRef.current = deps;
  });

  const push = useCallback((m: Omit<ChatMessage, 'id'>) => {
    const id = idRef.current++;
    setMessages((prev) => [...prev, { ...m, id }]);
    return id;
  }, []);

  const setStatus = useCallback((id: number, status: ChatMessage['status']) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, status } : m)));
  }, []);

  const send = useCallback(
    async (text?: string) => {
      const raw = (typeof text === 'string' ? text : draft).trim();
      if (!raw || agentState === 'processing' || agentState === 'thinking') return;
      const d = depsRef.current;
      push({ role: 'user', text: raw });
      setDraft('');
      setAgentState('thinking');

      // Build bounded conversational history from prior text turns.
      const history = messages
        .filter((m) => (m.role === 'user' && m.text) || (m.role === 'agent' && m.type === 'text' && m.text))
        .slice(-10)
        .map((m) => ({ role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant', content: m.text ?? '' }));

      let turn: { reply: string; action?: PendingActionView } | null = null;
      try {
        turn = await d.sendToAgent({ message: raw, history });
      } catch {
        turn = null;
      }
      if (!turn) {
        push({ role: 'agent', type: 'error', title: 'I couldn’t reach the agent.', hint: 'Please try again in a moment.' });
        setAgentState('error');
        return setTimeout(() => setAgentState('idle'), 400) as unknown as void;
      }

      if (turn.reply && turn.reply.trim()) push({ role: 'agent', type: 'text', text: turn.reply.trim() });

      const action = turn.action;
      if (action) {
        if (action.render.type === 'payment_preview') {
          push({
            role: 'agent',
            type: 'preview',
            kind: 'send',
            preview: action.render,
            execTool: action.tool,
            execArgs: action.args,
            status: 'awaiting',
          });
        } else {
          const q = action.render.quote;
          push({
            role: 'agent',
            type: 'fiat_quote',
            kind: q.side,
            quote: q,
            execTool: action.tool,
            execArgs: action.args,
            status: 'awaiting',
          });
        }
      }
      setAgentState('idle');
    },
    [draft, agentState, push, messages],
  );

  const confirm = useCallback(
    async (id: number) => {
      const d = depsRef.current;
      const m = messages.find((x) => x.id === id);
      if (!m || m.status !== 'awaiting') return;
      setStatus(id, 'confirmed');
      setAgentState('processing');

      if (m.type === 'preview' && m.preview) {
        // Crypto send — client-sign path for a real on-chain settlement.
        const r = await d.executeSend({ recipient: m.preview.recipient, amount: m.preview.amount });
        if (r.ok) {
          push({ role: 'agent', type: 'receipt', kind: 'send', preview: m.preview, result: { status: r.status ?? 'confirmed', txHash: r.txHash, explorerUrl: r.explorerUrl } });
          setAgentState('success');
        } else {
          setStatus(id, 'failed');
          push({ role: 'agent', type: 'error', title: 'Payment failed.', hint: r.error ?? 'Something went wrong settling this payment.' });
          setAgentState('error');
        }
      } else if (m.type === 'fiat_quote' && m.execTool) {
        const r = await d.executeAction({ tool: m.execTool, args: m.execArgs ?? {} });
        if (r.ok) {
          const order = r.result?.order;
          push({ role: 'agent', type: 'fiat_receipt', kind: m.kind, quote: m.quote, order });
          setAgentState('success');
        } else {
          setStatus(id, 'failed');
          push({ role: 'agent', type: 'error', title: 'Conversion couldn’t be completed.', hint: r.error ?? '' });
          setAgentState('error');
        }
      } else {
        setAgentState('idle');
        return;
      }
      setTimeout(() => setAgentState('idle'), 1400);
    },
    [messages, push, setStatus],
  );

  const cancel = useCallback(
    (id: number) => {
      setStatus(id, 'cancelled');
      push({ role: 'agent', type: 'text', text: 'Cancelled. Nothing was sent.' });
      setAgentState('idle');
    },
    [push, setStatus],
  );

  return { messages, agentState, draft, setDraft, send, confirm, cancel };
}
