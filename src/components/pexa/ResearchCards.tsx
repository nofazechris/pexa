'use client';

import { useState } from 'react';
import { color } from '@/lib/design/tokens';
import type { ChatMessage } from '@/components/auth/useAgentChat';
import type { ResearchItem, ResearchResult, Verdict } from '@/lib/research/types';

/**
 * Chat cards for "find me a vendor / someone to hire". The plan card is the one human checkpoint: it states the cost and the
 * most it can ever cost, and nothing is bought until it is approved. The result card is a ranked shortlist whose every line
 * is a fact read from the profile — with the honest limits written on it.
 */

const MONO = 'var(--font-geist-mono),monospace';

function Label({ children }: { children: string }) {
  return <div style={{ fontFamily: MONO, fontSize: '10.5px', letterSpacing: '.12em', color: color.faint }}>{children}</div>;
}

export function ResearchPlanCard({ m, onConfirm, onCancel }: { m: ChatMessage; onConfirm: () => void; onCancel: () => void }) {
  const plan = m.research;
  if (!plan) return null;
  const awaiting = m.status === 'awaiting';
  const running = m.status === 'confirmed';
  const progress = m.researchProgress;

  return (
    <div style={{ border: `1px solid ${color.border}`, background: color.surface, borderRadius: '16px', padding: '16px', maxWidth: '420px' }}>
      <Label>{plan.request.kind === 'hire' ? 'FIND SOMEONE · BUY' : 'FIND A VENDOR · BUY'}</Label>
      <div style={{ fontSize: '16px', fontWeight: 600, letterSpacing: '-.015em', marginTop: '10px' }}>{plan.title}</div>
      <ol style={{ margin: '10px 0 0', paddingLeft: '18px', listStyle: 'decimal', fontSize: '13.5px', lineHeight: 1.55, color: color.mutedStrong }}>
        {plan.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '26px', fontWeight: 600, letterSpacing: '-.04em', fontVariantNumeric: 'tabular-nums' }}>≈ {plan.estimate}</span>
        <span style={{ fontSize: '12.5px', color: color.mutedStrong }}>never more than {plan.cap}</span>
      </div>

      {awaiting ? (
        <>
          <div style={{ display: 'flex', gap: '8px', marginTop: '14px' }}>
            <button onClick={onConfirm} style={{ flex: 1, border: 'none', background: color.primary, color: '#fff', fontSize: '14px', fontWeight: 500, padding: 'var(--pp-btn-y) 15px', borderRadius: '11px', cursor: 'pointer' }}>
              Approve up to {plan.cap}
            </button>
            <button onClick={onCancel} style={{ border: `1px solid ${color.borderStrong}`, background: color.surface, color: color.ink, fontSize: '14px', fontWeight: 500, padding: 'var(--pp-btn-y) 15px', borderRadius: '11px', cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
          <div style={{ fontSize: '11.5px', color: color.faint, marginTop: '10px', lineHeight: 1.5 }}>
            Each lookup is a few cents, paid from your wallet in dollar stablecoins — no gas. Payments on Buy can’t be reversed, and nothing here pays any seller.
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '14px', paddingTop: '13px', borderTop: `1px solid ${color.borderFaint}`, fontSize: '13px', color: m.status === 'cancelled' || m.status === 'failed' ? color.warning : color.mutedStrong }}>
          {running ? (
            <>
              <span style={{ width: 12, height: 12, border: `2px solid ${color.primarySoftBorder}`, borderTopColor: color.primary, borderRadius: '50%', animation: 'pp-spin .8s linear infinite', display: 'inline-block', flexShrink: 0 }} />
              <span>
                {progress ? progress.label : 'Starting…'}
                {progress ? <span style={{ color: color.faint }}> · {progress.spent} of {progress.cap}</span> : null}
              </span>
            </>
          ) : m.status === 'cancelled' && m.restored ? (
            'From an earlier chat — ask again to search'
          ) : m.status === 'cancelled' ? (
            'Cancelled — nothing was charged'
          ) : m.status === 'failed' ? (
            'Stopped — see the note below'
          ) : (
            'Done — the shortlist is below'
          )}
        </div>
      )}
    </div>
  );
}

const TONE: Record<Verdict, { fg: string; bg: string; border: string }> = {
  solid: { fg: color.success, bg: color.successSoft, border: 'var(--pp-success-border)' },
  mixed: { fg: color.warning, bg: 'var(--pp-warning-tint)', border: color.warningDot },
  careful: { fg: 'var(--pp-danger-text)', bg: 'var(--pp-danger-tint)', border: 'var(--pp-danger-border)' },
  unknown: { fg: color.mutedStrong, bg: color.surfaceMuted, border: color.borderFaint },
};

const SIGNAL_MARK = { good: '✓', warn: '!', info: '·' } as const;

/** What to send the seller or the person, ready to paste. Vendors on Instagram rarely take crypto, so it asks. */
export function outreachMessage(r: ResearchResult, item: ResearchItem): string {
  const first = item.name.split(/\s+/)[0] || 'there';
  if (r.request.kind === 'hire') {
    return `Hi ${first}, I came across your profile and I’m looking for ${r.request.what}${r.request.place ? ` in ${r.request.place}` : ''}. Could you share examples of your recent work, your rate and your timeline? I can pay in USDT/USDC on the Celo network — do you accept that?`;
  }
  return `Hi, I found your page${item.handle ? ` ${item.handle}` : ''} and I’m interested in ${r.request.what}. Could you send the price and availability? I can pay in USDT/USDC on the Celo network — do you accept that? If yes, please send your wallet address.`;
}

function ItemRow({ item, r, onTry }: { item: ResearchItem; r: ResearchResult; onTry?: (text: string) => void }) {
  const [copied, setCopied] = useState(false);
  const tone = TONE[item.verdict];
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(outreachMessage(r, item));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — the message is simply not copied */
    }
  };
  const btn = { border: `1px solid ${color.borderStrong}`, background: color.surface, color: color.ink, fontSize: '12.5px', fontWeight: 500, padding: '6px 11px', borderRadius: '9px', cursor: 'pointer' } as const;

  return (
    <div style={{ border: `1px solid ${tone.border}`, background: tone.bg, borderRadius: '14px', padding: '13px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '14.5px', fontWeight: 600, color: color.ink, wordBreak: 'break-word' }}>{item.handle ?? item.name}</span>
        {item.handle && item.name !== item.handle ? <span style={{ fontSize: '13px', color: color.mutedStrong }}>{item.name}</span> : null}
        <span style={{ marginLeft: 'auto', fontSize: '12px', fontWeight: 600, color: tone.fg, whiteSpace: 'nowrap' }}>{item.verdictLabel}</span>
      </div>
      {item.headline ? <div style={{ fontSize: '12.5px', color: color.mutedStrong, marginTop: '5px', lineHeight: 1.45, wordBreak: 'break-word' }}>{item.headline}</div> : null}
      {item.stats.length ? <div style={{ fontFamily: MONO, fontSize: '11.5px', color: color.mutedStrong, marginTop: '7px' }}>{item.stats.join(' · ')}</div> : null}
      <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {item.signals.map((s) => (
          <li key={s.text} style={{ display: 'flex', gap: '7px', fontSize: '12.5px', lineHeight: 1.45, color: s.tone === 'warn' ? 'var(--pp-danger-text)' : color.ink }}>
            <span style={{ width: 12, flexShrink: 0, fontWeight: 700, color: s.tone === 'good' ? color.success : s.tone === 'warn' ? 'var(--pp-danger-text)' : color.faint }}>{SIGNAL_MARK[s.tone]}</span>
            <span>{s.text}</span>
          </li>
        ))}
      </ul>
      <div style={{ display: 'flex', gap: '7px', flexWrap: 'wrap', marginTop: '11px' }}>
        {item.url ? (
          <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ ...btn, textDecoration: 'none', display: 'inline-block' }}>
            Open profile
          </a>
        ) : null}
        <button onClick={copy} style={btn}>
          {copied ? 'Copied' : 'Copy a message to send'}
        </button>
        {item.handle && onTry ? (
          <button onClick={() => onTry(`Check the Instagram account ${item.handle} before I pay: is it legit?`)} style={btn}>
            Check closer
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function ResearchResultCard({ m, onTry }: { m: ChatMessage; onTry?: (text: string) => void }) {
  const r = m.researchResult;
  if (!r) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '9px', maxWidth: '460px' }}>
      <div style={{ border: `1px solid ${color.border}`, background: color.surface, borderRadius: '16px', padding: '14px 16px' }}>
        <Label>{r.request.kind === 'hire' ? 'SHORTLIST · PEOPLE TO HIRE' : 'SHORTLIST · VENDORS'}</Label>
        <div style={{ fontSize: '14.5px', lineHeight: 1.5, marginTop: '8px', color: color.ink }}>{r.summary}</div>
        <div style={{ fontFamily: MONO, fontSize: '11.5px', color: color.faint, marginTop: '8px' }}>Cost of this search: {r.spent} · receipts saved under Purchases</div>
      </div>
      {r.items.map((item) => (
        <ItemRow key={(item.handle ?? item.name) + (item.url ?? '')} item={item} r={r} onTry={onTry} />
      ))}
      {r.notes.length ? (
        <div style={{ fontSize: '12px', color: color.mutedStrong, lineHeight: 1.55, padding: '0 4px' }}>
          {r.notes.map((n) => (
            <div key={n} style={{ marginTop: '4px' }}>
              {n}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
