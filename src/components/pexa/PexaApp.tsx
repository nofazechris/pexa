'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PrivyPayLogo } from '@/components/brand/PrivyPayLogo';
import { ChatIcon, WalletIcon, ActivityIcon, PaymentsIcon, SettingsNavIcon, type Icon } from '@/components/ui/icons';
import { color } from '@/lib/design/tokens';
import { statusColor } from '@/lib/format';
import { ServiceConnect } from '@/components/app/ServiceConnect';
import { AgentPayments } from '@/components/app/AgentPayments';
import type { ActivityItem } from '@/components/auth/useActivity';
import type { RequestItem } from '@/components/auth/useRequests';
import type { RecurringItem } from '@/components/auth/useRecurring';
import { useAgentChat, type AgentChatDeps, type ChatMessage } from '@/components/auth/useAgentChat';

/**
 * Pexa app shell — chat-first, agent-native. A slim sidebar (Chat / Wallet / Activity / Payments /
 * Settings) on desktop, a bottom bar on mobile, and the agent Chat as the primary surface. The
 * Chat drives the real payment loop; Wallet/Activity show real data; Payments/Settings are the
 * next slices. Rebuilt from design/Pexa.dc.html.
 */

type Page = 'chat' | 'wallet' | 'activity' | 'payments' | 'settings';
const NAV: Array<{ key: Page; label: string; icon: Icon }> = [
  { key: 'chat', label: 'Chat', icon: ChatIcon },
  { key: 'wallet', label: 'Wallet', icon: WalletIcon },
  { key: 'activity', label: 'Activity', icon: ActivityIcon },
  { key: 'payments', label: 'Payments', icon: PaymentsIcon },
  { key: 'settings', label: 'Settings', icon: SettingsNavIcon },
];
const PAGE_TITLE: Record<Page, string> = { chat: 'Chat', wallet: 'Wallet', activity: 'Activity', payments: 'Payments', settings: 'Settings' };

function money(n: number): string {
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function BetaChip() {
  return (
    <span
      title="Pexa is in beta and being deployed"
      style={{ fontFamily: 'var(--font-geist-mono),monospace', fontSize: '9px', letterSpacing: '.12em', color: color.primaryHover, border: `1px solid ${color.primarySoftBorder}`, background: color.primarySoft, borderRadius: '999px', padding: '2px 6px', lineHeight: 1.4 }}
    >
      BETA
    </span>
  );
}

export interface PexaAppProps {
  username?: string;
  address?: string;
  /** Decimal USDC balance string, e.g. "20.00". */
  balance: string;
  activity: ActivityItem[];
  requests: RequestItem[];
  recurring: RecurringItem[];
  onSignOut: () => void;
  /** The tool-calling agent + confirmed-action executors (from AppGate). */
  sendToAgent: AgentChatDeps['sendToAgent'];
  executeAction: AgentChatDeps['executeAction'];
  executeSend: AgentChatDeps['executeSend'];
  /** Pay a received request through the engine, then mark it settled. */
  payRequest: (args: { requestId: string; recipient: string; amount: string }) => Promise<{ ok: boolean; error?: string }>;
  setRecurringPaused: (id: string, paused: boolean) => Promise<{ ok: boolean; error?: string }>;
  cancelRecurring: (id: string) => Promise<{ ok: boolean; error?: string }>;
  /** Authorized token getter, for the Wallet screen's own reads (USDT balance, linked banks). */
  getAccessToken?: () => Promise<string | null>;
}

export function PexaApp(props: PexaAppProps) {
  const { username, address, balance, activity } = props;
  const handleDisplay = username ? '@' + username : 'Account';
  const initial = (username?.[0] ?? '?').toUpperCase();

  const [page, setPage] = useState<Page>('chat');
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 820);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const deps = useMemo<AgentChatDeps>(
    () => ({
      sendToAgent: props.sendToAgent,
      executeAction: props.executeAction,
      executeSend: props.executeSend,
    }),
    [props.sendToAgent, props.executeAction, props.executeSend],
  );
  const chat = useAgentChat(deps);

  // Agent status pill in the header.
  const pill = ((): { label: string; color: string; bg: string; border: string; dot: string; anim: string } => {
    // Persistent "having trouble" state after a failed turn, until the next success — so downtime
    // stays visible rather than flashing away.
    if (chat.health === 'degraded' && (chat.agentState === 'idle' || chat.agentState === 'error')) {
      return { label: 'Pexa is having trouble', color: '#A8352A', bg: '#FDF1EF', border: '#F0DCD8', dot: '#C0362A', anim: 'pp-pulse 1.6s ease-in-out infinite' };
    }
    switch (chat.agentState) {
      case 'thinking':
        return { label: 'Thinking…', color: '#153AB4', bg: '#F4F6FE', border: '#DDE3F6', dot: '#1B45D7', anim: 'pp-pulse 1.2s ease-in-out infinite' };
      case 'processing':
        return { label: 'Sending…', color: '#153AB4', bg: '#F4F6FE', border: '#DDE3F6', dot: '#1B45D7', anim: 'pp-pulse 1.2s ease-in-out infinite' };
      case 'success':
        return { label: 'Done', color: '#167A54', bg: '#E8F3ED', border: '#CDE7DA', dot: '#167A54', anim: 'none' };
      case 'error':
        return { label: 'Needs attention', color: '#8A6A1E', bg: '#FBF6EA', border: '#F0E4C8', dot: '#D8A93A', anim: 'none' };
      default:
        return { label: 'Pexa is active', color: '#167A54', bg: '#E8F3ED', border: '#CDE7DA', dot: '#167A54', anim: 'none' };
    }
  })();

  return (
    <div style={{ display: 'flex', height: '100dvh', minHeight: '100dvh', maxHeight: '100dvh', background: color.background, overflow: 'hidden' }}>
      {!isMobile ? (
        <aside style={{ width: '214px', flex: 'none', borderRight: `1px solid #E8EAEF`, background: color.surfaceMuted, display: 'flex', flexDirection: 'column', padding: '16px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '4px 8px 18px' }}>
            <PrivyPayLogo size={22} />
            <span style={{ fontSize: '15.5px', fontWeight: 600, letterSpacing: '-.025em' }}>Pexa</span>
            <BetaChip />
          </div>
          <nav style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {NAV.map((n) => {
              const active = page === n.key;
              const Ico = n.icon;
              return (
                <button
                  key={n.key}
                  onClick={() => setPage(n.key)}
                  aria-label={n.label}
                  aria-current={active ? 'page' : undefined}
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', border: 'none', background: active ? color.primarySoft : 'transparent', borderRadius: '10px', padding: '10px 11px', cursor: 'pointer', textAlign: 'left', width: '100%' }}
                >
                  <Ico size={20} color={active ? color.primary : '#5B6472'} weight={active ? 'bold' : 'regular'} />
                  <span style={{ fontSize: '14px', fontWeight: active ? 600 : 450, color: active ? '#153AB4' : '#5B6472' }}>{n.label}</span>
                </button>
              );
            })}
          </nav>
          <div style={{ flex: 1 }} />
          <div style={{ borderTop: `1px solid #E8EAEF`, padding: '14px 10px 4px', display: 'flex', alignItems: 'center', gap: '9px' }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: color.primarySoft, color: color.primary, fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{initial}</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '13.5px', fontWeight: 600, letterSpacing: '-.01em', overflow: 'hidden', textOverflow: 'ellipsis' }}>{handleDisplay}</div>
              <button onClick={props.onSignOut} style={{ border: 'none', background: 'transparent', padding: 0, marginTop: '2px', fontSize: '11.5px', color: color.muted, cursor: 'pointer' }}>Sign out</button>
            </div>
          </div>
        </aside>
      ) : null}

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <header style={{ flex: 'none', borderBottom: `1px solid #E8EAEF`, background: 'rgba(246,247,249,.92)', backdropFilter: 'blur(10px)', padding: '11px clamp(14px,2.6vw,26px)', display: 'flex', alignItems: 'center', gap: '12px' }}>
          {isMobile ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <PrivyPayLogo size={21} />
              <span style={{ fontSize: '15px', fontWeight: 600, letterSpacing: '-.025em' }}>Pexa</span>
              <BetaChip />
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '15.5px', fontWeight: 600, letterSpacing: '-.022em' }}>{PAGE_TITLE[page]}</span>
            </div>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px', border: `1px solid ${pill.border}`, background: pill.bg, borderRadius: '999px', padding: '5px 11px' }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: pill.dot, display: 'inline-block', animation: pill.anim }} />
              <span style={{ fontSize: '11.5px', fontWeight: 500, color: pill.color, whiteSpace: 'nowrap' }}>{pill.label}</span>
            </div>
            {!isMobile ? <span style={{ fontSize: '13.5px', fontWeight: 500, color: color.muted }}>{handleDisplay}</span> : null}
          </div>
        </header>

        <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            {page === 'chat' ? <ChatScreen chat={chat} getAccessToken={props.getAccessToken} balance={balance} /> : null}
            {page === 'wallet' ? (
              <WalletPage
                balance={balance}
                username={username}
                address={address}
                getAccessToken={props.getAccessToken}
                onAsk={(text) => {
                  setPage('chat');
                  chat.send(text);
                }}
              />
            ) : null}
            {page === 'activity' ? <ActivityPage activity={activity} /> : null}
            {page === 'payments' ? (
              <PaymentsPage
                requests={props.requests}
                recurring={props.recurring}
                payRequest={props.payRequest}
                setRecurringPaused={props.setRecurringPaused}
                cancelRecurring={props.cancelRecurring}
                onGoChat={() => setPage('chat')}
              />
            ) : null}
            {page === 'settings' ? <SettingsPage username={username} address={address} onSignOut={props.onSignOut} /> : null}
          </div>
        </div>

        {isMobile ? (
          <nav style={{ flex: 'none', borderTop: `1px solid #E8EAEF`, background: 'rgba(255,255,255,.96)', backdropFilter: 'blur(10px)', display: 'flex', padding: '8px 6px 10px' }}>
            {NAV.map((n) => {
              const active = page === n.key;
              const Ico = n.icon;
              return (
                <button key={n.key} onClick={() => setPage(n.key)} aria-label={n.label} style={{ flex: 1, border: 'none', background: 'transparent', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px', padding: '6px 2px', minHeight: 48, cursor: 'pointer' }}>
                  <Ico size={20} color={active ? color.primary : '#5F6878'} weight={active ? 'bold' : 'regular'} />
                  <span style={{ fontSize: '11px', color: active ? '#153AB4' : '#5F6878', fontWeight: active ? 600 : 450 }}>{n.label}</span>
                </button>
              );
            })}
          </nav>
        ) : null}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- Chat screen */

function ChatScreen({ chat, getAccessToken, balance }: { chat: ReturnType<typeof useAgentChat>; getAccessToken?: () => Promise<string | null>; balance?: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages.length, chat.agentState]);

  // "Add money" is only useful when there's nothing to spend yet — surface it only for an empty wallet.
  // Keep the prompts generic (no specific @username): a new user doesn't know anyone yet, and the
  // agent will ask who/how much when it needs to.
  const walletEmpty = !balance || Number(balance) === 0;
  const suggestions = walletEmpty
    ? ['Add money to my wallet', "What's my balance?", 'Send a payment', 'Save part of every payment I get']
    : ['Send a payment', 'Request a payment', "What's my balance?", 'Save part of every payment I get'];
  const empty = chat.messages.length === 0;

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: 'clamp(16px,2.6vw,30px) clamp(14px,2.6vw,26px)' }}>
        <div style={{ maxWidth: '700px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {empty ? (
            <div style={{ padding: 'clamp(18px,5vh,60px) 0 6px', animation: 'pp-up .5s cubic-bezier(.2,.8,.3,1) both' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <PrivyPayLogo size={26} />
                <span style={{ fontFamily: 'var(--font-geist-mono),monospace', fontSize: '10.5px', letterSpacing: '.14em', color: color.faint }}>PEXA AGENT</span>
              </div>
              <h1 style={{ fontSize: 'clamp(28px,4.4vw,38px)', letterSpacing: '-.04em', fontWeight: 600, margin: '18px 0 0' }}>How can I help?</h1>
              <p style={{ fontSize: '16px', color: color.muted, lineHeight: 1.6, margin: '12px 0 0', maxWidth: '440px' }}>A new way to interact with your money on-chain — send, request and manage payments, set money rules, and ask about your wallet. Just talk to Pexa.</p>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', marginTop: '14px', border: `1px solid ${color.primarySoftBorder}`, background: color.primarySoft, borderRadius: '999px', padding: '5px 11px' }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: color.primary, display: 'inline-block', animation: 'pp-pulse 1.8s ease-in-out infinite' }} />
                <span style={{ fontSize: '11.5px', fontWeight: 500, color: color.primaryHover }}>Beta · being deployed</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '26px', maxWidth: '430px' }}>
                {suggestions.map((sg) => (
                  <button key={sg} onClick={() => chat.send(sg)} style={{ border: `1px solid ${color.border}`, background: color.surface, borderRadius: '11px', padding: '12px 14px', fontSize: '14.5px', color: color.ink, cursor: 'pointer', textAlign: 'left' }}>
                    {sg}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {chat.messages.map((m) => (
            <ChatRow key={m.id} m={m} onConfirm={() => chat.confirm(m.id)} onCancel={() => chat.cancel(m.id)} onRetry={(t) => chat.send(t)} getAccessToken={getAccessToken} />
          ))}

          {chat.agentState === 'thinking' || chat.agentState === 'processing' ? (
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', animation: 'pp-fade .2s ease both' }}>
              <AgentAvatar />
              <div style={{ display: 'flex', gap: '4px', border: `1px solid ${color.borderFaint}`, background: color.surface, borderRadius: '14px 14px 14px 4px', padding: '11px 13px' }}>
                <Dot delay="0s" /><Dot delay=".16s" /><Dot delay=".32s" />
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ flex: 'none', borderTop: `1px solid #E8EAEF`, background: 'rgba(246,247,249,.94)', backdropFilter: 'blur(8px)', padding: '12px clamp(14px,2.6vw,26px) 14px' }}>
        <div style={{ maxWidth: '700px', margin: '0 auto' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
            <input
              value={chat.draft}
              onChange={(e) => chat.setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  chat.send();
                }
              }}
              aria-label="Ask Pexa to do something"
              placeholder="Ask Pexa to do something..."
              style={{ flex: 1, minWidth: 0, border: `1px solid ${color.borderStrong}`, background: color.surface, borderRadius: '13px', padding: '14px 15px', fontSize: '15px', color: color.ink, outline: 'none' }}
            />
            <button onClick={() => chat.send()} aria-label="Send instruction" style={{ border: 'none', background: color.primary, color: '#fff', borderRadius: '13px', padding: '14px 17px', cursor: 'pointer', fontSize: '14.5px', fontWeight: 500, opacity: chat.draft.trim() ? 1 : 0.55 }}>Send</button>
          </div>
          <div style={{ fontSize: '11.5px', color: color.faint, marginTop: '9px' }}>Pexa always shows a preview. Nothing moves until you confirm.</div>
        </div>
      </div>
    </div>
  );
}

function AgentAvatar() {
  return (
    <div style={{ width: 26, height: 26, borderRadius: '50%', border: `1px solid ${color.primarySoftBorder}`, background: color.primarySoft, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
      <PrivyPayLogo size={13} />
    </div>
  );
}
function Dot({ delay }: { delay: string }) {
  return <span style={{ width: 5, height: 5, borderRadius: '50%', background: color.primary, display: 'inline-block', animation: `pp-pulse 1.1s ease-in-out ${delay} infinite` }} />;
}

function ChatRow({ m, onConfirm, onCancel, onRetry, getAccessToken }: { m: ChatMessage; onConfirm: () => void; onCancel: () => void; onRetry?: (text: string) => void; getAccessToken?: () => Promise<string | null> }) {
  if (m.role === 'user') {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', animation: 'pp-step .34s cubic-bezier(.2,.8,.3,1) both' }}>
        <div style={{ maxWidth: '80%', background: color.ink, color: '#fff', borderRadius: '15px 15px 4px 15px', padding: '11px 15px', fontSize: '15px', lineHeight: 1.45 }}>{m.text}</div>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', animation: 'pp-step .34s cubic-bezier(.2,.8,.3,1) both' }}>
      <AgentAvatar />
      <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: '9px' }}>
        {m.text && m.type === 'text' ? <div style={{ fontSize: '15px', lineHeight: 1.5, color: color.ink, paddingTop: '3px', whiteSpace: 'pre-wrap' }}>{m.text}</div> : null}
        {m.type === 'preview' ? <PreviewCard m={m} onConfirm={onConfirm} onCancel={onCancel} /> : null}
        {m.type === 'receipt' ? <ReceiptCard m={m} /> : null}
        {m.type === 'fiat_quote' ? <FiatQuoteCard m={m} onConfirm={onConfirm} onCancel={onCancel} /> : null}
        {m.type === 'fiat_receipt' ? <FiatReceiptCard m={m} /> : null}
        {m.type === 'error' ? <ErrorCard m={m} onRetry={onRetry} /> : null}
        {m.type === 'receive' ? <ReceiveCard m={m} getAccessToken={getAccessToken} /> : null}
      </div>
    </div>
  );
}

function PreviewCard({ m, onConfirm, onCancel }: { m: ChatMessage; onConfirm: () => void; onCancel: () => void }) {
  const p = m.preview;
  if (!p) return null;
  const settled = m.status && m.status !== 'awaiting';
  const rows = [
    { label: 'To', value: p.recipient },
    { label: 'Asset', value: p.token },
    { label: 'Network', value: p.network },
  ];
  return (
    <div style={{ border: `1px solid ${color.primarySoftBorder}`, background: color.surface, borderRadius: '16px', padding: '16px', maxWidth: '400px', boxShadow: '0 20px 44px -40px rgba(14,20,32,.5)' }}>
      <div style={{ fontFamily: 'var(--font-geist-mono),monospace', fontSize: '10.5px', letterSpacing: '.12em', color: color.faint }}>PAYMENT PREVIEW</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '13px', flexWrap: 'wrap' }}>
        <div style={{ width: 34, height: 34, borderRadius: '50%', background: color.primarySoft, color: color.primary, fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{(p.recipient.replace(/^@/, '')[0] ?? '?').toUpperCase()}</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '15px', fontWeight: 600, letterSpacing: '-.016em' }}>{p.recipient}</div>
          <div style={{ fontSize: '12px', color: color.mutedStrong, marginTop: '1px' }}>Recipient</div>
        </div>
        <div style={{ marginLeft: 'auto', fontSize: '23px', fontWeight: 600, letterSpacing: '-.036em', fontVariantNumeric: 'tabular-nums' }}>${money(Number(p.amount))}</div>
      </div>
      <div style={{ display: 'grid', gap: '9px', marginTop: '14px', paddingTop: '13px', borderTop: `1px solid ${color.borderFaint}` }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: '14px', fontSize: '13.5px' }}>
            <span style={{ color: color.mutedStrong }}>{r.label}</span>
            <span style={{ fontWeight: 500, textAlign: 'right' }}>{r.value}</span>
          </div>
        ))}
      </div>
      {!settled ? (
        <div style={{ display: 'flex', gap: '8px', marginTop: '16px', flexWrap: 'wrap' }}>
          <button onClick={onConfirm} style={{ border: 'none', background: color.primary, color: '#fff', fontSize: '14.5px', fontWeight: 500, padding: '12px 16px', borderRadius: '11px', cursor: 'pointer', flex: 1, minWidth: '150px' }}>Confirm payment</button>
          <button onClick={onCancel} style={{ border: `1px solid ${color.borderStrong}`, background: color.surface, color: color.ink, fontSize: '14px', fontWeight: 500, padding: '12px 15px', borderRadius: '11px', cursor: 'pointer' }}>Cancel</button>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginTop: '14px', paddingTop: '13px', borderTop: `1px solid ${color.borderFaint}`, fontSize: '13px', color: m.status === 'cancelled' ? color.warning : color.success }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: m.status === 'cancelled' ? color.warning : color.success, display: 'inline-block' }} />
          {m.status === 'cancelled' ? 'Cancelled' : m.status === 'failed' ? 'Failed' : 'Confirmed'}
        </div>
      )}
    </div>
  );
}

function ReceiptCard({ m }: { m: ChatMessage }) {
  const p = m.preview;
  if (!p) return null;
  const statusVal = m.result?.status === 'pending' ? 'Pending' : m.result?.status === 'failed' ? 'Failed' : 'Completed';
  const rows: Array<{ label: string; value: string; color?: string }> = [
    { label: 'To', value: p.recipient },
    { label: 'Status', value: statusVal, color: statusColor(statusVal) },
    ...(m.result?.txHash ? [{ label: 'Transaction', value: m.result.txHash.slice(0, 6) + '…' + m.result.txHash.slice(-4) }] : []),
  ];
  return (
    <div style={{ border: `1px solid ${color.border}`, background: color.surface, borderRadius: '16px', padding: '18px', maxWidth: '400px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '11px' }}>
        <div style={{ width: 32, height: 32, borderRadius: '50%', background: color.primary, color: '#fff', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', animation: 'pp-pop .34s cubic-bezier(.2,.8,.3,1) both' }}>✓</div>
        <div style={{ fontSize: '15px', fontWeight: 600, letterSpacing: '-.018em' }}>Payment sent</div>
      </div>
      <div style={{ fontSize: '28px', fontWeight: 600, letterSpacing: '-.04em', marginTop: '14px', fontVariantNumeric: 'tabular-nums' }}>
        ${money(Number(p.amount))} <span style={{ fontFamily: 'var(--font-geist-mono),monospace', fontSize: '12px', fontWeight: 400, color: color.mutedStrong }}>{p.token}</span>
      </div>
      <div style={{ display: 'grid', gap: '9px', marginTop: '14px', paddingTop: '13px', borderTop: `1px solid ${color.borderFaint}` }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: '14px', fontSize: '13.5px' }}>
            <span style={{ color: color.mutedStrong }}>{r.label}</span>
            <span style={{ fontWeight: 500, textAlign: 'right', color: r.color ?? color.ink }}>{r.value}</span>
          </div>
        ))}
      </div>
      {m.result?.explorerUrl ? (
        <button onClick={() => window.open(m.result!.explorerUrl!, '_blank', 'noopener')} style={{ border: `1px solid ${color.borderStrong}`, background: color.surface, color: color.ink, fontSize: '14px', fontWeight: 500, padding: '11px 16px', borderRadius: '11px', cursor: 'pointer', marginTop: '15px' }}>View on explorer</button>
      ) : null}
    </div>
  );
}

function SandboxBadge() {
  return (
    <span style={{ fontFamily: 'var(--font-geist-mono),monospace', fontSize: '9.5px', letterSpacing: '.1em', color: color.warning, border: `1px solid ${color.warningDot}`, background: '#FEFBF0', borderRadius: '999px', padding: '3px 7px' }}>
      SANDBOX · NOT LIVE
    </span>
  );
}

function FiatQuoteCard({ m, onConfirm, onCancel }: { m: ChatMessage; onConfirm: () => void; onCancel: () => void }) {
  const q = m.quote;
  if (!q) return null;
  const isBuy = q.side === 'buy';
  const title = isBuy ? 'BUY USDT' : 'CONVERT TO NAIRA';
  const big = isBuy ? `₦${q.ngn}` : `${q.usdt} USDT`;
  const receive = q.estimatedReceiveCurrency === 'USDT' ? `${q.estimatedReceive} USDT` : `₦${q.estimatedReceive}`;
  const rows = [
    { label: 'Rate', value: `₦${q.rate} / USDT` },
    { label: 'Fee', value: `₦${q.feeNgn}` },
    { label: 'You receive', value: receive },
  ];
  const awaiting = m.status === 'awaiting';
  const settled = m.status && m.status !== 'awaiting';
  const confirmLabel = isBuy ? 'Confirm purchase' : 'Confirm conversion';
  return (
    <div style={{ border: `1px solid ${color.primarySoftBorder}`, background: color.surface, borderRadius: '16px', padding: '16px', maxWidth: '400px', boxShadow: '0 20px 44px -40px rgba(14,20,32,.5)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
        <div style={{ fontFamily: 'var(--font-geist-mono),monospace', fontSize: '10.5px', letterSpacing: '.12em', color: color.faint }}>{title}</div>
        {q.sandbox ? <SandboxBadge /> : null}
      </div>
      <div style={{ fontSize: '28px', fontWeight: 600, letterSpacing: '-.04em', marginTop: '12px', fontVariantNumeric: 'tabular-nums' }}>{big}</div>
      <div style={{ fontSize: '13.5px', color: color.mutedStrong, marginTop: '4px' }}>≈ {receive}</div>
      <div style={{ display: 'grid', gap: '9px', marginTop: '14px', paddingTop: '13px', borderTop: `1px solid ${color.borderFaint}` }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: '14px', fontSize: '13.5px' }}>
            <span style={{ color: color.mutedStrong }}>{r.label}</span>
            <span style={{ fontWeight: 500, textAlign: 'right' }}>{r.value}</span>
          </div>
        ))}
      </div>
      {awaiting ? (
        <div style={{ display: 'flex', gap: '8px', marginTop: '16px', flexWrap: 'wrap' }}>
          <button onClick={onConfirm} style={{ border: 'none', background: color.primary, color: '#fff', fontSize: '14.5px', fontWeight: 500, padding: '12px 16px', borderRadius: '11px', cursor: 'pointer', flex: 1, minWidth: '150px' }}>{confirmLabel}</button>
          <button onClick={onCancel} style={{ border: `1px solid ${color.borderStrong}`, background: color.surface, color: color.ink, fontSize: '14px', fontWeight: 500, padding: '12px 15px', borderRadius: '11px', cursor: 'pointer' }}>Cancel</button>
        </div>
      ) : settled ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginTop: '14px', paddingTop: '13px', borderTop: `1px solid ${color.borderFaint}`, fontSize: '13px', color: m.status === 'cancelled' ? color.warning : m.status === 'failed' ? color.warning : color.success }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: m.status === 'failed' ? color.warning : color.success, display: 'inline-block' }} />
          {m.status === 'cancelled' ? 'Cancelled' : m.status === 'failed' ? 'Failed' : 'Confirmed'}
        </div>
      ) : (
        <div style={{ fontSize: '12px', color: color.mutedStrong, marginTop: '12px' }}>Quote valid for ~60s.</div>
      )}
    </div>
  );
}

function FiatReceiptCard({ m }: { m: ChatMessage }) {
  const q = m.quote;
  if (!q) return null;
  const isBuy = q.side === 'buy';
  const big = isBuy ? `${q.estimatedReceive} USDT` : `₦${q.estimatedReceive}`;
  const dest = isBuy ? '→ your Pexa wallet' : '→ your bank account';
  const statusLabel = (m.order?.status ?? '').replace(/_/g, ' ').toLowerCase() || 'processing';
  const title = isBuy ? 'Purchase started' : 'Conversion started';
  return (
    <div style={{ border: `1px solid ${color.border}`, background: color.surface, borderRadius: '16px', padding: '18px', maxWidth: '400px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '11px' }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: color.primary, color: '#fff', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', animation: 'pp-pop .34s cubic-bezier(.2,.8,.3,1) both' }}>✓</div>
          <div style={{ fontSize: '15px', fontWeight: 600, letterSpacing: '-.018em' }}>{title}</div>
        </div>
        {q.sandbox ? <SandboxBadge /> : null}
      </div>
      <div style={{ fontSize: '26px', fontWeight: 600, letterSpacing: '-.04em', marginTop: '14px', fontVariantNumeric: 'tabular-nums' }}>{big}</div>
      <div style={{ fontSize: '13.5px', color: color.muted, marginTop: '4px' }}>{dest}</div>
      <div style={{ display: 'grid', gap: '9px', marginTop: '14px', paddingTop: '13px', borderTop: `1px solid ${color.borderFaint}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '14px', fontSize: '13.5px' }}>
          <span style={{ color: color.mutedStrong }}>Status</span>
          <span style={{ fontWeight: 500, textAlign: 'right', textTransform: 'capitalize' }}>{statusLabel}</span>
        </div>
        {m.order?.orderId ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '14px', fontSize: '13.5px' }}>
            <span style={{ color: color.mutedStrong }}>Order</span>
            <span style={{ fontWeight: 500, textAlign: 'right', fontFamily: 'var(--font-geist-mono),monospace', fontSize: '12px' }}>{m.order.orderId.slice(0, 8)}</span>
          </div>
        ) : null}
      </div>
      {q.sandbox ? (
        <div style={{ fontSize: '12px', color: color.mutedStrong, marginTop: '12px', lineHeight: 1.5 }}>
          Sandbox order — no real money moved. Live conversion arrives when a provider is connected.
        </div>
      ) : null}
    </div>
  );
}

function ErrorCard({ m, onRetry }: { m: ChatMessage; onRetry?: (text: string) => void }) {
  const canRetry = Boolean(m.retryText && onRetry);
  return (
    <div style={{ border: '1px solid #F0DCD8', background: '#FDF8F7', borderRadius: '16px', padding: '15px 16px', maxWidth: '400px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
        <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#F4E2DE', color: '#A8352A', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>!</span>
        <span style={{ fontSize: '14.5px', fontWeight: 500, color: '#A8352A' }}>{m.title}</span>
      </div>
      {m.hint ? <div style={{ fontSize: '13.5px', color: color.muted, lineHeight: 1.55, marginTop: '9px' }}>{m.hint}</div> : null}
      {canRetry ? (
        <button
          onClick={() => onRetry!(m.retryText!)}
          aria-label="Try again"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', marginTop: '12px', border: '1px solid #E6C9C3', background: '#fff', color: '#A8352A', fontSize: '13px', fontWeight: 500, padding: '7px 12px', borderRadius: '9px', cursor: 'pointer' }}
        >
          <RetryIcon size={14} />
          Try again
        </button>
      ) : null}
    </div>
  );
}

/** A small circular-arrow "retry" glyph, drawn inline so it needs no icon dependency. */
function RetryIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

function ReceiveCard({ m, getAccessToken }: { m: ChatMessage; getAccessToken?: () => Promise<string | null> }) {
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<'watching' | 'reflected' | 'idle'>('watching');
  const [received, setReceived] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const baselineRef = useRef<bigint | null>(null);
  const doneRef = useRef(false);
  const r = m.receive;

  // Read the wallet's on-chain USDC (smallest unit). Returns null on any transient failure.
  const readRaw = useCallback(async (): Promise<{ raw: bigint; decimals: number } | null> => {
    if (!r) return null;
    try {
      const token = getAccessToken ? await getAccessToken() : null;
      const res = await fetch('/api/balance?address=' + encodeURIComponent(r.address), { headers: token ? { authorization: `Bearer ${token}` } : undefined });
      if (!res.ok) return null;
      const d = (await res.json()) as { balance?: { raw: string; decimals?: number } | null };
      if (!d.balance) return { raw: 0n, decimals: 6 };
      return { raw: BigInt(d.balance.raw), decimals: d.balance.decimals ?? 6 };
    } catch {
      return null;
    }
  }, [r, getAccessToken]);

  const settleReflected = useCallback((delta: bigint, decimals: number) => {
    setReceived(money(Number(delta) / 10 ** decimals));
    setStatus('reflected');
    doneRef.current = true;
  }, []);

  // Watch for a deposit: capture a baseline, then poll for the balance to go up.
  useEffect(() => {
    if (!r) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    (async () => {
      const base = await readRaw();
      if (!alive) return;
      if (base) baselineRef.current = base.raw;
      const poll = async () => {
        if (!alive || doneRef.current) return;
        attempts += 1;
        const cur = await readRaw();
        if (!alive || doneRef.current) return;
        if (cur && baselineRef.current != null && cur.raw > baselineRef.current) {
          settleReflected(cur.raw - baselineRef.current, cur.decimals);
          return;
        }
        if (attempts >= 50) {
          setStatus('idle'); // ~5 min with no deposit — stop the loop, keep a manual check
          return;
        }
        timer = setTimeout(poll, 6000);
      };
      timer = setTimeout(poll, 6000);
    })();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [r, readRaw, settleReflected]);

  const checkNow = useCallback(async () => {
    if (doneRef.current) return;
    setChecking(true);
    const cur = await readRaw();
    setChecking(false);
    if (cur && baselineRef.current != null && cur.raw > baselineRef.current) {
      settleReflected(cur.raw - baselineRef.current, cur.decimals);
    } else {
      setStatus('watching'); // resume watching if they were idle
    }
  }, [readRaw, settleReflected]);

  if (!r) return null;
  const copy = () => {
    navigator.clipboard?.writeText(r.address).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => {});
  };

  return (
    <div style={{ border: `1px solid ${status === 'reflected' ? color.successSoft : color.border}`, background: color.surface, borderRadius: '16px', padding: '16px', maxWidth: '360px' }}>
      <div style={{ fontFamily: 'var(--font-geist-mono),monospace', fontSize: '10.5px', letterSpacing: '.12em', color: color.faint }}>ADD MONEY · {r.network.toUpperCase()}</div>
      <div style={{ fontSize: '14px', color: color.mutedStrong, marginTop: '9px', lineHeight: 1.5 }}>Send <strong style={{ color: color.ink }}>USDC on Celo</strong> to your wallet. Scan the code or copy the address.</div>
      {r.qr ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={r.qr} alt="Your wallet address QR code" width={180} height={180} style={{ display: 'block', margin: '14px auto 4px', borderRadius: '10px', border: `1px solid ${color.borderFaint}` }} />
      ) : null}
      <div style={{ marginTop: '12px', border: `1px solid ${color.borderFaint}`, borderRadius: '11px', padding: '11px 12px' }}>
        <div style={{ fontSize: '11.5px', color: color.faint }}>Your Celo wallet</div>
        <div style={{ fontFamily: 'var(--font-geist-mono),monospace', fontSize: '12.5px', marginTop: '4px', wordBreak: 'break-all', color: color.ink }}>{r.address}</div>
      </div>
      <button onClick={copy} style={{ marginTop: '12px', width: '100%', border: 'none', background: color.primary, color: '#fff', fontSize: '14px', fontWeight: 500, padding: '11px', borderRadius: '11px', cursor: 'pointer' }}>{copied ? 'Address copied' : 'Copy address'}</button>

      {/* Live deposit watcher */}
      <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: `1px solid ${color.borderFaint}` }}>
        {status === 'reflected' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '9px', animation: 'pp-pop .4s cubic-bezier(.2,.8,.3,1) both' }}>
            <span style={{ width: 20, height: 20, borderRadius: '50%', background: color.successSoft, color: color.success, fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>✓</span>
            <span style={{ fontSize: '14px', fontWeight: 500, color: color.success }}>Received ${received} — it’s in your wallet.</span>
          </div>
        ) : status === 'watching' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
            <span style={{ width: 14, height: 14, border: `2px solid ${color.primarySoftBorder}`, borderTopColor: color.primary, borderRadius: '50%', animation: 'pp-spin .8s linear infinite', display: 'inline-block', flex: 'none' }} />
            <span style={{ fontSize: '13px', color: color.mutedStrong }}>Watching for your deposit…</span>
            <button onClick={checkNow} disabled={checking} style={{ marginLeft: 'auto', border: 'none', background: 'transparent', color: color.primary, fontSize: '13px', fontWeight: 500, cursor: 'pointer', padding: 0 }}>{checking ? 'Checking…' : 'Check now'}</button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
            <span style={{ fontSize: '13px', color: color.mutedStrong }}>No deposit yet.</span>
            <button onClick={checkNow} disabled={checking} style={{ marginLeft: 'auto', border: `1px solid ${color.borderStrong}`, background: color.surface, color: color.ink, fontSize: '12.5px', fontWeight: 500, padding: '6px 11px', borderRadius: '8px', cursor: 'pointer' }}>{checking ? 'Checking…' : 'Check again'}</button>
          </div>
        )}
      </div>

      <div style={{ fontSize: '11.5px', color: color.warning, marginTop: '10px', lineHeight: 1.5 }}>Only send USDC on Celo. Other networks or tokens may be lost.</div>
    </div>
  );
}

/* ----------------------------------------------------------------- other pages */

interface PayoutBank { id: string; bankName: string; accountName: string; last4: string }
interface Vault { id: string; name: string; balance: string; target: string | null; progress: number | null }

function WalletPage({
  balance,
  username,
  address,
  getAccessToken,
  onAsk,
}: {
  balance: string;
  username?: string;
  address?: string;
  getAccessToken?: () => Promise<string | null>;
  onAsk: (text: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [usdt, setUsdt] = useState<string | null>(null);
  const [fiatOn, setFiatOn] = useState(false);
  const [fiatPublic, setFiatPublic] = useState(false);
  const [fundingLive, setFundingLive] = useState(false);
  const [banks, setBanks] = useState<PayoutBank[]>([]);
  const [vaults, setVaults] = useState<Vault[]>([]);
  const short = address ? address.slice(0, 6) + '…' + address.slice(-4) : '—';
  const savedTotal = vaults.reduce((s, v) => s + (Number(v.balance) || 0), 0);

  // Wallet-screen reads: derived USDT balance + linked bank accounts (only if fiat is enabled).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const token = getAccessToken ? await getAccessToken() : null;
        const headers = token ? { authorization: `Bearer ${token}` } : undefined;
        const [bRes, aRes, vRes] = await Promise.all([
          fetch('/api/fiat/balance', { headers }),
          fetch('/api/fiat/payout-accounts', { headers }),
          fetch('/api/vaults', { headers }),
        ]);
        if (!alive) return;
        if (bRes.ok) {
          const d = (await bRes.json()) as { usdt?: string; fundingLive?: boolean; public?: boolean };
          setUsdt(d.usdt ?? '0');
          setFundingLive(Boolean(d.fundingLive));
          setFiatPublic(Boolean(d.public));
          setFiatOn(true);
        }
        if (aRes.ok) {
          const d = (await aRes.json()) as { accounts?: PayoutBank[] };
          setBanks(d.accounts ?? []);
        }
        if (vRes.ok) {
          const d = (await vRes.json()) as { vaults?: Vault[] };
          setVaults(d.vaults ?? []);
        }
      } catch {
        /* leave fiat sections hidden */
      }
    })();
    return () => {
      alive = false;
    };
  }, [getAccessToken]);

  const copyAddress = () => {
    if (address) navigator.clipboard?.writeText(address).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => {});
  };

  // Naira actions only appear when the fiat feature is public; core Celo actions are always shown.
  const actions: Array<{ label: string; prompt: string; primary?: boolean }> = fiatPublic
    ? [
        { label: 'Buy USDT', prompt: 'I want to buy USDT with naira', primary: true },
        { label: 'Convert', prompt: 'I want to convert USDT to naira' },
        { label: 'Send', prompt: 'I want to send a payment', primary: true },
        { label: 'Withdraw', prompt: 'I want to withdraw naira to my bank' },
      ]
    : [
        { label: 'Send', prompt: 'I want to send a payment', primary: true },
        { label: 'Request', prompt: 'I want to request a payment' },
      ];

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 'clamp(16px,2.6vw,28px) clamp(14px,2.6vw,26px) 40px' }}>
      <div style={{ maxWidth: '720px', margin: '0 auto', animation: 'pp-fade .22s ease both' }}>
        {/* Balance */}
        <div style={{ background: color.ink, borderRadius: '18px', padding: 'clamp(20px,3vw,28px)', color: '#fff' }}>
          <div style={{ fontSize: '12.5px', color: '#A3ACBC' }}>Available balance</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '9px', marginTop: '8px' }}>
            <div style={{ fontSize: 'clamp(34px,5vw,44px)', fontWeight: 600, letterSpacing: '-.045em', fontVariantNumeric: 'tabular-nums' }}>${money(Number(balance) || 0)}</div>
            <div style={{ fontFamily: 'var(--font-geist-mono),monospace', fontSize: '13px', color: '#A3ACBC' }}>USDC</div>
          </div>
          {fiatOn && fiatPublic ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
              <span style={{ fontSize: '14px', color: '#C9D0DC', fontVariantNumeric: 'tabular-nums' }}>{usdt ?? '0'} <span style={{ fontFamily: 'var(--font-geist-mono),monospace', fontSize: '12px', color: '#8A93A5' }}>USDT</span></span>
              <span style={{ fontFamily: 'var(--font-geist-mono),monospace', fontSize: '9.5px', letterSpacing: '.1em', color: '#8A6A1E', border: '1px solid #6B5A2E', background: '#2A2410', borderRadius: '999px', padding: '2px 7px' }}>SANDBOX</span>
            </div>
          ) : null}
          <div style={{ display: 'flex', gap: '8px', marginTop: '20px', flexWrap: 'wrap' }}>
            <button onClick={() => onAsk('I want to send a payment')} style={{ border: 'none', background: color.primary, color: '#fff', fontSize: '14.5px', fontWeight: 500, padding: '12px 18px', borderRadius: '11px', cursor: 'pointer' }}>Send</button>
            <button onClick={copyAddress} style={{ border: '1px solid #2C3547', background: 'transparent', color: '#fff', fontSize: '14.5px', fontWeight: 500, padding: '12px 18px', borderRadius: '11px', cursor: 'pointer' }}>
              {copied ? 'Address copied' : 'Receive'}
            </button>
          </div>
        </div>

        {/* Funding status (only once naira is public). */}
        {fiatPublic && fiatOn && !fundingLive ? (
          <div style={{ marginTop: '14px', border: `1px solid ${color.warningDot}`, background: '#FEFBF0', borderRadius: '12px', padding: '12px 14px', display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
            <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#FBF0D2', color: color.warning, fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>i</span>
            <div style={{ fontSize: '13px', color: color.warning, lineHeight: 1.5 }}>Funding is coming soon — you can’t add real money yet while Pexa is in beta.</div>
          </div>
        ) : null}

        {/* Quick actions — everything runs through the chat agent */}
        <div style={{ marginTop: '14px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: '10px' }}>
          {actions.map((a) => {
            const buyNotLive = a.label === 'Buy USDT' && fiatOn && !fundingLive;
            const sub = buyNotLive
              ? 'coming soon'
              : a.label === 'Buy USDT'
                ? 'with naira'
                : a.label === 'Convert'
                  ? 'USDT → naira'
                  : a.label === 'Send'
                    ? 'to a @username'
                    : a.label === 'Request'
                      ? 'from a @username'
                      : 'to your bank';
            return (
              <button
                key={a.label}
                onClick={() => onAsk(buyNotLive ? 'Can I fund my wallet with naira?' : a.prompt)}
                style={{
                  border: `1px solid ${a.primary ? color.primary : color.border}`,
                  background: a.primary ? color.primarySoft : color.surface,
                  color: a.primary ? color.primaryHover : color.ink,
                  fontSize: '14.5px',
                  fontWeight: 600,
                  letterSpacing: '-.01em',
                  padding: '16px 14px',
                  borderRadius: '14px',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                {a.label}
                <div style={{ fontSize: '12px', fontWeight: 400, color: color.mutedStrong, marginTop: '4px' }}>{sub}</div>
              </button>
            );
          })}
        </div>

        {/* Identity */}
        <div style={{ background: color.surface, border: `1px solid ${color.border}`, borderRadius: '16px', padding: '18px', marginTop: '14px' }}>
          <div style={{ fontFamily: 'var(--font-geist-mono),monospace', fontSize: '10.5px', letterSpacing: '.12em', color: color.faint }}>YOUR IDENTITY</div>
          <div style={{ fontSize: '21px', fontWeight: 600, letterSpacing: '-.03em', marginTop: '13px' }}>{username ? '@' + username : '—'}</div>
          <div style={{ fontSize: '13px', color: color.mutedStrong, marginTop: '4px' }}>People pay you by username.</div>
          <div style={{ marginTop: '15px', paddingTop: '14px', borderTop: `1px solid ${color.borderFaint}`, display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '12.5px', color: color.mutedStrong }}>Celo wallet</div>
              <div style={{ fontFamily: 'var(--font-geist-mono),monospace', fontSize: '13px', marginTop: '5px', wordBreak: 'break-all' }}>{short}</div>
            </div>
            <button onClick={copyAddress} style={{ marginLeft: 'auto', border: `1px solid ${color.borderStrong}`, background: color.surface, color: color.ink, fontSize: '12.5px', fontWeight: 500, padding: '8px 12px', borderRadius: '9px', cursor: 'pointer' }}>{copied ? 'Copied' : 'Copy'}</button>
          </div>
        </div>

        {/* Savings vaults — money set aside within the wallet (earmark, no on-chain move). */}
        <div style={{ background: color.surface, border: `1px solid ${color.border}`, borderRadius: '16px', padding: '18px', marginTop: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ fontFamily: 'var(--font-geist-mono),monospace', fontSize: '10.5px', letterSpacing: '.12em', color: color.faint }}>SAVINGS</div>
            {vaults.length > 0 ? (
              <span style={{ fontSize: '12.5px', color: color.mutedStrong }}>${money(savedTotal)} set aside</span>
            ) : null}
            <button onClick={() => onAsk('Create a savings vault')} style={{ marginLeft: 'auto', border: `1px solid ${color.primary}`, background: color.primarySoft, color: color.primaryHover, fontSize: '13px', fontWeight: 500, padding: '8px 12px', borderRadius: '9px', cursor: 'pointer' }}>+ New vault</button>
          </div>
          {vaults.length === 0 ? (
            <div style={{ fontSize: '13px', color: color.mutedStrong, marginTop: '13px', lineHeight: 1.5 }}>
              Set money aside for a goal — rent, travel, an emergency fund. It stays in your wallet, just earmarked so you don’t spend it by accident. Ask Pexa to create one.
            </div>
          ) : (
            <div style={{ marginTop: '14px', display: 'grid', gap: '10px' }}>
              {vaults.map((v) => (
                <div key={v.id} style={{ border: `1px solid ${color.borderFaint}`, borderRadius: '12px', padding: '13px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
                    <div style={{ fontSize: '14.5px', fontWeight: 600, letterSpacing: '-.01em' }}>{v.name}</div>
                    <div style={{ marginLeft: 'auto', fontSize: '14.5px', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                      ${money(Number(v.balance) || 0)}
                      {v.target ? <span style={{ fontSize: '12px', fontWeight: 400, color: color.mutedStrong }}> / ${money(Number(v.target))}</span> : null}
                    </div>
                  </div>
                  {v.progress != null ? (
                    <div style={{ height: '6px', borderRadius: '999px', background: color.primarySoft, marginTop: '10px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${Math.round(v.progress * 100)}%`, background: color.primary, borderRadius: '999px' }} />
                    </div>
                  ) : null}
                  <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                    <button onClick={() => onAsk(`Add money to my "${v.name}" vault`)} style={{ border: `1px solid ${color.borderStrong}`, background: color.surface, color: color.ink, fontSize: '12.5px', fontWeight: 500, padding: '7px 12px', borderRadius: '9px', cursor: 'pointer' }}>Add</button>
                    <button onClick={() => onAsk(`Withdraw from my "${v.name}" vault`)} style={{ border: `1px solid ${color.borderStrong}`, background: color.surface, color: color.ink, fontSize: '12.5px', fontWeight: 500, padding: '7px 12px', borderRadius: '9px', cursor: 'pointer' }}>Withdraw</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Linked bank accounts (fiat) */}
        {fiatOn && fiatPublic ? (
          <div style={{ background: color.surface, border: `1px solid ${color.border}`, borderRadius: '16px', padding: '18px', marginTop: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ fontFamily: 'var(--font-geist-mono),monospace', fontSize: '10.5px', letterSpacing: '.12em', color: color.faint }}>BANK ACCOUNTS</div>
              <button onClick={() => onAsk('I want to add a bank account for withdrawals')} style={{ marginLeft: 'auto', border: `1px solid ${color.primary}`, background: color.primarySoft, color: color.primaryHover, fontSize: '13px', fontWeight: 500, padding: '8px 12px', borderRadius: '9px', cursor: 'pointer' }}>+ Add bank</button>
            </div>
            <div style={{ marginTop: '14px', display: 'grid', gap: '10px' }}>
              {banks.length === 0 ? (
                <div style={{ fontSize: '13.5px', color: color.mutedStrong }}>No bank linked yet. Add one to withdraw naira.</div>
              ) : (
                banks.map((b) => (
                  <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', border: `1px solid ${color.borderFaint}`, borderRadius: '12px', padding: '12px 13px' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '14px', fontWeight: 500 }}>{b.accountName}</div>
                      <div style={{ fontSize: '12.5px', color: color.mutedStrong, marginTop: '2px' }}>{b.bankName} · •••• {b.last4}</div>
                    </div>
                    <span style={{ marginLeft: 'auto', fontSize: '11.5px', fontWeight: 500, color: color.success }}>Verified</span>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ActivityPage({ activity }: { activity: ActivityItem[] }) {
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 'clamp(16px,2.6vw,28px) clamp(14px,2.6vw,26px) 40px' }}>
      <div style={{ maxWidth: '720px', margin: '0 auto', animation: 'pp-fade .22s ease both' }}>
        <div style={{ background: color.surface, border: `1px solid ${color.border}`, borderRadius: '16px', overflow: 'hidden' }}>
          {activity.length === 0 ? <div style={{ padding: '34px 18px', textAlign: 'center', fontSize: '14px', color: color.mutedStrong }}>Nothing here yet.</div> : null}
          {activity.map((t) => {
            const out = t.direction === 'out';
            const label = { CONFIRMED: 'Completed', PENDING: 'Pending', FAILED: 'Failed' }[t.status] ?? t.status;
            return (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 17px', borderBottom: `1px solid #F2F3F6` }}>
                <div style={{ width: 34, height: 34, borderRadius: '50%', background: out ? '#F1F2F5' : color.successSoft, color: out ? '#5B6472' : color.success, fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{(t.counterparty.replace(/^@/, '')[0] ?? '?').toUpperCase()}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '14.5px', fontWeight: 500, letterSpacing: '-.012em' }}>{t.counterparty}</div>
                  <div style={{ fontSize: '12.5px', color: color.mutedStrong, marginTop: '2px' }}>{new Date(t.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                </div>
                <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                  <div style={{ fontSize: '14.5px', fontWeight: 600, color: out ? color.ink : color.success, fontVariantNumeric: 'tabular-nums' }}>{(out ? '-$' : '+$') + money(Number(t.amount))}</div>
                  <div style={{ fontSize: '12px', color: statusColor(label), marginTop: '2px' }}>{label}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PaymentsPage({
  requests,
  recurring,
  payRequest,
  setRecurringPaused,
  cancelRecurring,
  onGoChat,
}: {
  requests: RequestItem[];
  recurring: RecurringItem[];
  payRequest: PexaAppProps['payRequest'];
  setRecurringPaused: PexaAppProps['setRecurringPaused'];
  cancelRecurring: PexaAppProps['cancelRecurring'];
  onGoChat: () => void;
}) {
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const withBusy = async (id: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy((b) => ({ ...b, [id]: true }));
    setError(null);
    const r = await fn();
    if (!r.ok) setError(r.error ?? 'Something went wrong.');
    setBusy((b) => ({ ...b, [id]: false }));
  };

  const incoming = requests.filter((r) => r.direction === 'incoming');
  const outgoing = requests.filter((r) => r.direction === 'outgoing');
  const activeRecurring = recurring.filter((r) => r.status !== 'cancelled');

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 'clamp(16px,2.6vw,28px) clamp(14px,2.6vw,26px) 48px' }}>
      <div style={{ maxWidth: '760px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '22px', animation: 'pp-fade .22s ease both' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '16px', fontWeight: 600, letterSpacing: '-.02em' }}>Requests & recurring</div>
            <div style={{ fontSize: '13px', color: color.muted, marginTop: '3px' }}>Ask Pexa in Chat to create new ones.</div>
          </div>
          <button onClick={onGoChat} style={{ marginLeft: 'auto', border: `1px solid ${color.primary}`, background: color.primary, color: '#fff', fontSize: '13.5px', fontWeight: 500, padding: '9px 15px', borderRadius: '10px', cursor: 'pointer', whiteSpace: 'nowrap' }}>New in Chat</button>
        </div>

        {error ? <div style={{ fontSize: '13px', color: color.danger, background: color.dangerSoft, border: '1px solid #F0DCD8', borderRadius: '10px', padding: '10px 13px' }}>{error}</div> : null}

        {/* Requests to pay */}
        <section>
          <SectionHead title="Requests for you" subtitle="People asking you to pay. You confirm each one." />
          <div style={{ background: color.surface, border: `1px solid ${color.border}`, borderRadius: '16px', overflow: 'hidden' }}>
            {incoming.length === 0 ? <Empty text="No incoming requests." /> : null}
            {incoming.map((r) => (
              <Row key={r.id}>
                <Avatar name={r.counterparty} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '14.5px', fontWeight: 500 }}>{r.counterparty}</div>
                  <div style={{ fontSize: '12.5px', color: color.mutedStrong, marginTop: '2px' }}>{r.memo || 'No note'}</div>
                </div>
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ fontSize: '14.5px', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>${money(Number(r.amount))}</div>
                  {r.payable ? (
                    <button
                      onClick={() => withBusy(r.id, () => payRequest({ requestId: r.id, recipient: r.counterparty, amount: r.amount }))}
                      disabled={busy[r.id]}
                      style={{ border: 'none', background: color.primary, color: '#fff', fontSize: '13.5px', fontWeight: 500, padding: '8px 15px', borderRadius: '9px', cursor: busy[r.id] ? 'default' : 'pointer', opacity: busy[r.id] ? 0.6 : 1 }}
                    >
                      {busy[r.id] ? 'Paying…' : 'Pay'}
                    </button>
                  ) : (
                    <StatusPill label={r.status} />
                  )}
                </div>
              </Row>
            ))}
          </div>
        </section>

        {/* Requests you sent */}
        <section>
          <SectionHead title="Requests you sent" subtitle="Waiting on others to pay." />
          <div style={{ background: color.surface, border: `1px solid ${color.border}`, borderRadius: '16px', overflow: 'hidden' }}>
            {outgoing.length === 0 ? <Empty text="You haven’t sent any requests." /> : null}
            {outgoing.map((r) => (
              <Row key={r.id}>
                <Avatar name={r.counterparty} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '14.5px', fontWeight: 500 }}>{r.counterparty}</div>
                  <div style={{ fontSize: '12.5px', color: color.mutedStrong, marginTop: '2px' }}>{r.memo || 'No note'}</div>
                </div>
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ fontSize: '14.5px', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>${money(Number(r.amount))}</div>
                  <StatusPill label={r.status} />
                </div>
              </Row>
            ))}
          </div>
        </section>

        {/* Recurring */}
        <section>
          <SectionHead title="Recurring payments" subtitle="Scheduled payments. Pause, resume or cancel any time." />
          <div style={{ background: color.surface, border: `1px solid ${color.border}`, borderRadius: '16px', overflow: 'hidden' }}>
            {activeRecurring.length === 0 ? <Empty text="No recurring payments." /> : null}
            {activeRecurring.map((r) => (
              <Row key={r.id}>
                <Avatar name={r.counterparty} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '14.5px', fontWeight: 500 }}>{r.counterparty}</div>
                  <div style={{ fontSize: '12.5px', color: color.mutedStrong, marginTop: '2px' }}>
                    {r.cadence}
                    {r.next ? ` · next ${new Date(r.next).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}
                    {r.paused ? ' · paused' : ''}
                  </div>
                </div>
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '9px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <div style={{ fontSize: '14.5px', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>${money(Number(r.amount))}</div>
                  <button
                    onClick={() => withBusy(r.id, () => setRecurringPaused(r.id, !r.paused))}
                    disabled={busy[r.id]}
                    style={{ border: `1px solid ${color.borderStrong}`, background: color.surface, color: color.ink, fontSize: '13px', fontWeight: 500, padding: '7px 12px', borderRadius: '9px', cursor: busy[r.id] ? 'default' : 'pointer', opacity: busy[r.id] ? 0.6 : 1 }}
                  >
                    {r.paused ? 'Resume' : 'Pause'}
                  </button>
                  <button
                    onClick={() => withBusy(r.id, () => cancelRecurring(r.id))}
                    disabled={busy[r.id]}
                    style={{ border: `1px solid ${color.borderStrong}`, background: color.surface, color: color.danger, fontSize: '13px', fontWeight: 500, padding: '7px 12px', borderRadius: '9px', cursor: busy[r.id] ? 'default' : 'pointer', opacity: busy[r.id] ? 0.6 : 1 }}
                  >
                    Cancel
                  </button>
                </div>
              </Row>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 17px', borderBottom: `1px solid #F2F3F6` }}>{children}</div>;
}
function Avatar({ name }: { name: string }) {
  return <div style={{ width: 34, height: 34, borderRadius: '50%', background: color.primarySoft, color: color.primary, fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{(name.replace(/^@/, '')[0] ?? '?').toUpperCase()}</div>;
}
function Empty({ text }: { text: string }) {
  return <div style={{ padding: '30px 18px', textAlign: 'center', fontSize: '13.5px', color: color.mutedStrong }}>{text}</div>;
}
function StatusPill({ label }: { label: string }) {
  const pretty = label.charAt(0).toUpperCase() + label.slice(1).toLowerCase();
  return <span style={{ fontSize: '12.5px', color: statusColor(pretty), fontWeight: 500 }}>{pretty}</span>;
}

function SettingsPage({ username, address, onSignOut }: { username?: string; address?: string; onSignOut: () => void }) {
  const [copied, setCopied] = useState(false);
  const short = address ? address.slice(0, 10) + '…' + address.slice(-6) : '—';
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 'clamp(16px,2.6vw,28px) clamp(14px,2.6vw,26px) 48px' }}>
      <div style={{ maxWidth: '760px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '22px', animation: 'pp-fade .22s ease both' }}>
        {/* Account */}
        <section>
          <SectionHead title="Account" subtitle="Your Pexa identity and wallet." />
          <div style={{ background: color.surface, border: `1px solid ${color.border}`, borderRadius: '16px', padding: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '13px' }}>
              <div style={{ width: 42, height: 42, borderRadius: '50%', background: color.primarySoft, color: color.primary, fontSize: 17, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{(username?.[0] ?? '?').toUpperCase()}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '17px', fontWeight: 600, letterSpacing: '-.02em' }}>{username ? '@' + username : '—'}</div>
                <div style={{ fontSize: '13px', color: color.mutedStrong, marginTop: '2px' }}>People pay you by username.</div>
              </div>
              <button onClick={onSignOut} style={{ marginLeft: 'auto', border: `1px solid ${color.borderStrong}`, background: color.surface, color: color.danger, fontSize: '13.5px', fontWeight: 500, padding: '9px 15px', borderRadius: '10px', cursor: 'pointer', whiteSpace: 'nowrap' }}>Sign out</button>
            </div>
            <div style={{ marginTop: '17px', paddingTop: '15px', borderTop: `1px solid ${color.borderFaint}`, display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '12.5px', color: color.mutedStrong }}>Celo wallet</div>
                <div style={{ fontFamily: 'var(--font-geist-mono),monospace', fontSize: '13px', marginTop: '4px', wordBreak: 'break-all' }}>{short}</div>
              </div>
              {address ? (
                <button
                  onClick={() => navigator.clipboard?.writeText(address).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => {})}
                  style={{ marginLeft: 'auto', border: `1px solid ${color.borderStrong}`, background: color.surface, color: color.ink, fontSize: '13px', fontWeight: 500, padding: '8px 13px', borderRadius: '9px', cursor: 'pointer' }}
                >
                  {copied ? 'Copied' : 'Copy address'}
                </button>
              ) : null}
            </div>
          </div>
        </section>

        {/* Connected agents (MCP) */}
        <section>
          <SectionHead title="Connected agents" subtitle="Connect ChatGPT or Claude so your agent can act on your behalf. You confirm every payment." />
          <ServiceConnect />
        </section>

        {/* Delegated (agent) payments */}
        <section>
          <SectionHead title="Automation" subtitle="Let a connected agent settle a payment right after you confirm it — within your limits." />
          <AgentPayments />
        </section>

        {/* Privacy */}
        <section>
          <SectionHead title="Privacy & limits" subtitle="How Pexa protects you." />
          <div style={{ background: color.surface, border: `1px solid ${color.border}`, borderRadius: '16px', padding: '20px', display: 'grid', gap: '13px' }}>
            {[
              ['Preview-first', 'Pexa always shows a preview. Nothing moves until you confirm.'],
              ['Spending limits', 'Every payment passes a $500 per-payment and $1,000 per-day cap — including agent-initiated ones.'],
              ['Keys stay in Privy', 'Your wallet keys never leave Privy’s secure enclave. Pexa and connected agents never see them.'],
            ].map(([t, b]) => (
              <div key={t} style={{ display: 'flex', gap: '11px' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: color.success, marginTop: '7px', flex: 'none' }} />
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 600, letterSpacing: '-.01em' }}>{t}</div>
                  <div style={{ fontSize: '13px', color: color.muted, lineHeight: 1.55, marginTop: '2px' }}>{b}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function SectionHead({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div style={{ margin: '0 0 13px 2px' }}>
      <div style={{ fontSize: '16px', fontWeight: 600, letterSpacing: '-.02em' }}>{title}</div>
      <div style={{ fontSize: '13px', color: color.muted, lineHeight: 1.5, marginTop: '3px', maxWidth: '560px' }}>{subtitle}</div>
    </div>
  );
}
