'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BuyResult, BuyTypedData } from './useBuy';

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
    | { type: 'fiat_quote'; quote: FiatQuoteView }
    | { type: 'receive'; address: string; username: string; network: string; qr: string }
    | { type: 'intro'; features: IntroFeatureView[] }
    | ({ type: 'bridge' } & BridgeCardData)
    | ({ type: 'recurring_preview' } & RecurringCardData)
    | { type: 'buy_quote'; purchaseId: string; service: string; price: string; priceAtomic: string; token: string; detail: string; expiresAt: string; from: string; typedData: BuyTypedData; note: string };
}

/** A deposit address for bringing USDC from another network (shown as a card; nothing to confirm). */
export interface BridgeCardData {
  chain: string;
  address: string;
  qr: string;
  estimateFeeUsd: string;
}

/** One thing Pexa can do, with a sentence to try it. */
export interface IntroFeatureView {
  title: string;
  description: string;
  example: string;
}

/** A Buy purchase waiting for approval (shown as an Approve card). */
export interface BuyQuoteCardData {
  purchaseId: string;
  service: string;
  price: string;
  priceAtomic: string;
  /** Stablecoin it will be paid in: USDC | USDT | USAT. */
  token: string;
  /** What the request will run, e.g. "query: celo · type: latest". */
  detail?: string;
  expiresAt: string;
  from: string;
  typedData: BuyTypedData;
  note: string;
}

/** A repeating payment waiting for Confirm (mirrors the server's recurring_preview render). */
export interface RecurringCardData {
  recipient: string;
  username: string;
  amount: string;
  token: string;
  cadence: string;
  firstPayment: string;
  /** Will it run by itself, or only wait for the user until they enable Agent payments? */
  automatic: boolean;
  /** Above the auto limit: every payment will wait for the user's approval. */
  needsApprovalEachTime: boolean;
  autoLimit: string;
  network: string;
}

export interface ChatMessage {
  id: number;
  role: 'user' | 'agent';
  type?: 'text' | 'preview' | 'fiat_quote' | 'receipt' | 'fiat_receipt' | 'error' | 'receive' | 'buy_quote' | 'buy_result' | 'recurring_preview' | 'recurring_receipt' | 'intro' | 'bridge';
  text?: string;
  /** The "what I can do" list, each with a tap-to-try sentence. */
  intro?: IntroFeatureView[];
  /** A deposit address for bringing USDC from another network. */
  bridge?: BridgeCardData;
  /** Card payloads. */
  kind?: 'send' | 'buy' | 'sell';
  preview?: { recipient: string; amount: string; token: string; network: string };
  receive?: { address: string; username: string; network: string; qr: string };
  buy?: BuyQuoteCardData;
  /** A repeating payment: the card to confirm, and (on the receipt) what was set up. */
  recurring?: RecurringCardData;
  recurringResult?: { ok: boolean; next?: string; error?: string };
  /** A finished Buy purchase (the receipt card). */
  buyResult?: BuyResult;
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
  /** When set, the error card shows a retry button that re-sends this message. */
  retryText?: string;
  /** Set when a saved chat is reopened: a card that was waiting for a tap is now inert (ask again to redo it). */
  restored?: boolean;
}

/** Why an agent turn failed — drives the plain-language message and the health indicator. */
export type AgentFailReason = 'network' | 'unavailable' | 'account' | 'server';

export interface AgentChatDeps {
  /** Send a message to the agent; returns its reply, or a typed failure. */
  sendToAgent: (args: {
    message: string;
    history: { role: 'user' | 'assistant'; content: string }[];
  }) => Promise<{ ok: true; reply: string; action?: PendingActionView } | { ok: false; reason: AgentFailReason } | null>;
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
  /** Approve a Buy purchase: sign with the user's wallet, pay, and wait for the recorded result. */
  executeBuy?: (args: { purchaseId: string; from: string; typedData: BuyTypedData }) => Promise<BuyResult>;
  /** Decline a quoted Buy purchase (best effort). */
  cancelBuy?: (purchaseId: string) => Promise<void>;
  /** Set up a confirmed recurring payment (the server re-validates everything). */
  createRecurring?: (args: { payee: string; amount: string; cadence: string }) => Promise<{ ok: boolean; next?: string; error?: string }>;
  /** Save the chat so it survives a reload and can be continued later (best effort). */
  saveConversation?: (id: string, messages: ChatMessage[]) => Promise<void>;
  /** Load a saved chat; the server has already made any pending money card inert. */
  loadConversation?: (id: string) => Promise<{ messages: ChatMessage[]; nextId: number } | null>;
}

/** Plain-language error copy — no codes, no jargon. The whole point is that people understand it. */
function plainError(reason: AgentFailReason): { title: string; hint: string } {
  switch (reason) {
    case 'network':
      return { title: 'I can’t reach Pexa right now.', hint: 'Looks like a connection problem. Check your internet and try again in a moment.' };
    case 'unavailable':
      return { title: 'Pexa’s assistant is taking a break.', hint: 'The AI is temporarily unavailable — nothing’s wrong with your account. Please try again shortly.' };
    case 'account':
      return { title: 'I’m having trouble reaching your account.', hint: 'This is usually brief. Give it a moment and try again.' };
    case 'server':
    default:
      return { title: 'Something went wrong on my end.', hint: 'That’s on us, not you. Please try again in a moment.' };
  }
}

export function useAgentChat(deps: AgentChatDeps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [agentState, setAgentState] = useState<AgentState>('idle');
  /** Persistent agent health: 'ok' until a turn fails, back to 'ok' on the next success. */
  const [health, setHealth] = useState<'ok' | 'degraded'>('ok');
  const [draft, setDraft] = useState('');
  const idRef = useRef(1);
  /** Which saved chat this is. Created when the first message is saved; replaced by "New chat" / opening another. */
  const [conversationId, setConversationId] = useState<string | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  /** Set right after opening a saved chat so loading it doesn't immediately re-save (and bump) it. */
  const skipSaveRef = useRef(false);
  const depsRef = useRef(deps);
  /** Always-current `send`, for system-driven follow-ups scheduled from inside other callbacks. */
  const sendRef = useRef<((text?: string, opts?: { hidden?: boolean }) => Promise<unknown>) | null>(null);
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
    async (text?: string, opts?: { hidden?: boolean }) => {
      const raw = (typeof text === 'string' ? text : draft).trim();
      if (!raw || agentState === 'processing' || agentState === 'thinking') return;
      const d = depsRef.current;
      // A hidden turn is a system-driven follow-up (e.g. "read the purchase result"): no user bubble.
      if (!opts?.hidden) {
        push({ role: 'user', text: raw });
        setDraft('');
      }
      setAgentState('thinking');

      // Build bounded conversational history from prior text turns.
      const history = messages
        .filter((m) => (m.role === 'user' && m.text) || (m.role === 'agent' && m.type === 'text' && m.text))
        .slice(-10)
        .map((m) => ({ role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant', content: m.text ?? '' }));

      let turn: Awaited<ReturnType<AgentChatDeps['sendToAgent']>> = null;
      try {
        turn = await d.sendToAgent({ message: raw, history });
      } catch {
        turn = null;
      }
      // Any failure (no response, or a typed failure) → plain-language error + mark the agent degraded.
      if (!turn || turn.ok === false) {
        const reason: AgentFailReason = turn && turn.ok === false ? turn.reason : 'network';
        const { title, hint } = plainError(reason);
        // Carry the message so the error card can offer a one-tap retry (handy on connection blips).
        push({ role: 'agent', type: 'error', title, hint, retryText: raw });
        setHealth('degraded');
        setAgentState('error');
        return setTimeout(() => setAgentState('idle'), 400) as unknown as void;
      }

      // A successful turn means the agent is reachable again.
      setHealth('ok');
      if (turn.reply && turn.reply.trim()) push({ role: 'agent', type: 'text', text: turn.reply.trim() });

      const action = turn.action;
      if (action) {
        if (action.render.type === 'receive') {
          push({ role: 'agent', type: 'receive', receive: action.render });
        } else if (action.render.type === 'bridge') {
          const { type: _b, ...card } = action.render;
          void _b;
          push({ role: 'agent', type: 'bridge', bridge: card });
        } else if (action.render.type === 'intro') {
          push({ role: 'agent', type: 'intro', intro: action.render.features });
        } else if (action.render.type === 'recurring_preview') {
          const { type: _t, ...card } = action.render;
          void _t;
          push({ role: 'agent', type: 'recurring_preview', recurring: card, execArgs: action.args, status: 'awaiting' });
        } else if (action.render.type === 'buy_quote') {
          const { purchaseId, service, price, priceAtomic, token, detail, expiresAt, from, typedData, note } = action.render;
          push({ role: 'agent', type: 'buy_quote', buy: { purchaseId, service, price, priceAtomic, token, detail, expiresAt, from, typedData, note }, status: 'awaiting' });
        } else if (action.render.type === 'payment_preview') {
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
      } else if (m.type === 'recurring_preview' && m.recurring) {
        const card = m.recurring;
        const create = d.createRecurring;
        const r = create ? await create({ payee: card.username, amount: card.amount, cadence: card.cadence }) : { ok: false, error: 'Recurring payments aren’t available here.' };
        push({ role: 'agent', type: 'recurring_receipt', recurring: card, recurringResult: r });
        if (r.ok) {
          setAgentState('success');
        } else {
          setStatus(id, 'failed');
          setAgentState('error');
        }
      } else if (m.type === 'buy_quote' && m.buy) {
        const buy = m.buy;
        if (!d.executeBuy) {
          setStatus(id, 'failed');
          push({ role: 'agent', type: 'error', title: 'Buying isn’t available here.', hint: 'Nothing was charged.' });
          setAgentState('error');
        } else {
          const r = await d.executeBuy({ purchaseId: buy.purchaseId, from: buy.from, typedData: buy.typedData });
          push({ role: 'agent', type: 'buy_result', buyResult: r });
          if (r.ok) {
            setAgentState('success');
            // Let the agent read what was bought and answer the original question — no visible user bubble.
            setTimeout(
              () => sendRef.current?.(`I approved the purchase (${buy.purchaseId}) and it went through. Read its result and answer my original request concisely.`, { hidden: true }),
              500,
            );
          } else {
            if (!r.purchase) setStatus(id, 'failed'); // never got as far as paying
            setAgentState('error');
          }
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
      const m = messages.find((x) => x.id === id);
      if (m?.type === 'buy_quote' && m.buy) void depsRef.current.cancelBuy?.(m.buy.purchaseId);
      setStatus(id, 'cancelled');
      push({ role: 'agent', type: 'text', text: m?.type === 'buy_quote' ? 'Cancelled. Nothing was charged.' : m?.type === 'recurring_preview' ? 'Cancelled. Nothing was set up.' : 'Cancelled. Nothing was sent.' });
      setAgentState('idle');
    },
    [messages, push, setStatus],
  );

  // Keep the always-current `send` available to system-driven follow-ups (see `sendRef` above).
  useEffect(() => {
    sendRef.current = send;
  });

  // Save the chat as it goes (once it settles), so a reload or a closed tab never loses it.
  useEffect(() => {
    const save = depsRef.current.saveConversation;
    if (!save || agentState === 'thinking' || agentState === 'processing') return;
    if (!messages.some((m) => m.role === 'user')) return;
    if (skipSaveRef.current) {
      skipSaveRef.current = false;
      return;
    }
    const timer = setTimeout(() => {
      let id = conversationIdRef.current;
      if (!id) {
        id = crypto.randomUUID();
        conversationIdRef.current = id;
        setConversationId(id);
      }
      void save(id, messages);
    }, 800);
    return () => clearTimeout(timer);
  }, [messages, agentState]);

  /** Start a fresh chat. The previous one stays in History. */
  const newChat = useCallback(() => {
    conversationIdRef.current = null;
    setConversationId(null);
    skipSaveRef.current = false;
    idRef.current = 1;
    setMessages([]);
    setDraft('');
    setAgentState('idle');
  }, []);

  /** Reopen a saved chat and carry on where it left off. Returns false if it couldn't be loaded. */
  const openChat = useCallback(async (id: string): Promise<boolean> => {
    const load = depsRef.current.loadConversation;
    if (!load) return false;
    const loaded = await load(id);
    if (!loaded) return false;
    conversationIdRef.current = id;
    setConversationId(id);
    skipSaveRef.current = true;
    idRef.current = loaded.nextId;
    setMessages(loaded.messages);
    setDraft('');
    setAgentState('idle');
    return true;
  }, []);

  return { messages, agentState, health, draft, setDraft, send, confirm, cancel, conversationId, newChat, openChat };
}
