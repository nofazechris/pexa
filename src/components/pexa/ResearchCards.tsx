'use client';

import { useState } from 'react';
import { color } from '@/lib/design/tokens';
import type { ChatMessage } from '@/components/auth/useAgentChat';
import type { ResearchItem, ResearchResult, Verdict } from '@/lib/research/types';
import { distanceText } from '@/lib/geo/place';
import { stageForLabel } from '@/lib/agent/stage';
import { AgentOrb } from '@/components/pexa/AgentOrb';
import { StockResultCard } from '@/components/pexa/StockCards';

const PLATFORM_NAME = { instagram: 'Instagram', tiktok: 'TikTok', x: 'X', linkedin: 'LinkedIn', reddit: 'Reddit' } as const;

/**
 * Chat cards for "find me a vendor / someone to hire". The plan card is the one human checkpoint: it states the cost and the
 * most it can ever cost, and nothing is bought until it is approved. The result card is a ranked shortlist whose every line
 * is a fact read from the profile — with the honest limits written on it.
 */

const MONO = 'var(--font-geist-mono),monospace';

function Icon({ kind }: { kind: 'pin' | 'phone' | 'mail' }) {
  const common = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, style: { flexShrink: 0 } } as const;
  if (kind === 'pin') return <svg {...common}><path d="M12 21s7-5.2 7-11a7 7 0 10-14 0c0 5.8 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>;
  if (kind === 'phone') return <svg {...common}><path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z" /></svg>;
  return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></svg>;
}

const fiveStars = (n: number) => (n / 20).toFixed(1);
const PART_NAME = { trust: 'Trust', fit: 'Fit', nearby: 'Near', price: 'Price' } as const;

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
      <Label>{plan.request.kind === 'hire' ? 'FIND SOMEONE · BUY' : plan.request.kind === 'stocks' ? 'STOCK RESEARCH · BUY' : 'FIND A VENDOR · BUY'}</Label>
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
              <AgentOrb stage={stageForLabel(progress?.label)} size={20} />
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

/** "Was this a good lead?" — three taps that teach Pexa (and everyone after you) about this account. */
function FeedbackRow({ item, getAccessToken }: { item: ResearchItem; getAccessToken?: () => Promise<string | null> }) {
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!item.handle || item.platform === 'linkedin') return null;
  const send = async (kind: 'good' | 'bad' | 'scam') => {
    setBusy(true);
    try {
      const token = await getAccessToken?.();
      const res = await fetch('/api/research/feedback', { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ platform: item.platform, handle: item.handle, kind }) });
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      setSent(res.ok ? (data.message ?? 'Thanks — Pexa will remember that.') : 'Couldn’t save that just now.');
    } catch {
      setSent('Couldn’t save that just now.');
    } finally {
      setBusy(false);
    }
  };
  const small = { border: `1px solid ${color.borderFaint}`, background: 'transparent', color: color.mutedStrong, fontSize: '12px', padding: '4px 9px', borderRadius: '8px', cursor: busy ? 'default' : 'pointer' } as const;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginTop: '10px', paddingTop: '9px', borderTop: `1px solid ${color.borderFaint}`, fontSize: '12px', color: color.faint }}>
      {sent ? (
        <span>{sent}</span>
      ) : (
        <>
          <span style={{ marginRight: '2px' }}>How did it turn out?</span>
          <button disabled={busy} onClick={() => void send('good')} style={small}>Good lead</button>
          <button disabled={busy} onClick={() => void send('bad')} style={small}>Bad lead</button>
          <button disabled={busy} onClick={() => void send('scam')} style={{ ...small, color: 'var(--pp-danger-text)' }}>Scam</button>
        </>
      )}
    </div>
  );
}

function ItemRow({ item, r, onTry, getAccessToken }: { item: ResearchItem; r: ResearchResult; onTry?: (text: string) => void; getAccessToken?: () => Promise<string | null> }) {
  const [copied, setCopied] = useState(false);
  const tone = TONE[item.verdict];
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(item.negotiation?.message ?? outreachMessage(r, item));
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
        <span style={{ marginLeft: 'auto', textAlign: 'right', whiteSpace: 'nowrap', lineHeight: 1.15 }}>
          {item.rating ? (
            <span style={{ display: 'block', color: tone.fg }}>
              <span style={{ fontSize: '20px', fontWeight: 700, letterSpacing: '-.03em', fontVariantNumeric: 'tabular-nums' }}>{fiveStars(item.rating.overall)}</span>
              <span style={{ fontSize: '11.5px', fontWeight: 500 }}> / 5</span>
            </span>
          ) : null}
          <span style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: tone.fg }}>{item.verdictLabel}</span>
        </span>
      </div>
      {item.headline ? <div style={{ fontSize: '12.5px', color: color.mutedStrong, marginTop: '5px', lineHeight: 1.45, wordBreak: 'break-word' }}>{item.headline}</div> : null}
      {item.stats.length ? <div style={{ fontFamily: MONO, fontSize: '11.5px', color: color.mutedStrong, marginTop: '7px' }}>{[PLATFORM_NAME[item.platform], ...item.stats].join(' · ')}</div> : null}
      {item.rating ? (
        <div style={{ fontFamily: MONO, fontSize: '11px', color: color.mutedStrong, marginTop: '6px' }}>
          {(['trust', 'fit', 'nearby', 'price'] as const)
            .filter((k) => item.rating![k] !== null)
            .map((k) => `${PART_NAME[k]} ${fiveStars(item.rating![k] as number)}`)
            .join(' · ')}
        </div>
      ) : null}
      {item.prices ? (
        <div style={{ fontSize: '13px', color: color.ink, marginTop: '8px' }}>
          <span style={{ fontWeight: 500 }}>{item.prices.matched ? 'Price for this' : 'Prices seen (mixed items)'} {item.prices.text}</span>
          {item.prices.vsMarket ? (
            <span style={{ color: item.prices.vsMarket.kind === 'above' ? 'var(--pp-danger-text)' : item.prices.vsMarket.kind === 'below' ? color.success : color.mutedStrong, fontWeight: 500 }}>
              {' '}· {item.prices.vsMarket.kind === 'near' ? 'about the usual price' : `${Math.abs(item.prices.vsMarket.percent)}% ${item.prices.vsMarket.kind === 'above' ? 'above' : 'below'} usual`}
            </span>
          ) : null}
        </div>
      ) : null}
      {item.location || item.distanceKm !== null || item.nearness === 'area' ? (
        <div style={{ fontSize: '13px', color: color.ink, marginTop: '8px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Icon kind="pin" />
          <span>{item.location ?? 'Your area'}
          {item.distanceKm !== null ? <span style={{ color: color.mutedStrong, fontWeight: 400 }}> · {distanceText(item.distanceKm)}</span> : item.nearness === 'area' ? <span style={{ color: color.mutedStrong, fontWeight: 400 }}> · in your area</span> : null}</span>
        </div>
      ) : null}
      {item.contact.phone || item.contact.email ? (
        <div style={{ fontSize: '13px', color: color.ink, marginTop: '5px', wordBreak: 'break-word', display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
          {item.contact.phone ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <Icon kind="phone" />
              {item.contact.phone}
            </span>
          ) : null}
          {item.contact.email ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <Icon kind="mail" />
              {item.contact.email}
            </span>
          ) : null}
        </div>
      ) : null}
      <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {item.signals.map((s) => (
          <li key={s.text} style={{ display: 'flex', gap: '7px', fontSize: '12.5px', lineHeight: 1.45, color: s.tone === 'warn' ? 'var(--pp-danger-text)' : color.ink }}>
            <span style={{ width: 12, flexShrink: 0, fontWeight: 700, color: s.tone === 'good' ? color.success : s.tone === 'warn' ? 'var(--pp-danger-text)' : color.faint }}>{SIGNAL_MARK[s.tone]}</span>
            <span>{s.text}</span>
          </li>
        ))}
      </ul>
      {item.negotiation ? (
        <div style={{ marginTop: '10px', background: color.surface, border: `1px solid ${color.borderFaint}`, borderRadius: '11px', padding: '10px 11px' }}>
          <div style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '.12em', color: color.faint }}>NEGOTIATE</div>
          <div style={{ fontSize: '12.5px', lineHeight: 1.5, color: color.ink, marginTop: '5px' }}>{item.negotiation.tip}</div>
          {item.negotiation.offer ? <div style={{ fontSize: '12.5px', color: color.mutedStrong, marginTop: '4px' }}>Opening offer: <strong style={{ color: color.ink }}>{item.negotiation.offer}</strong></div> : null}
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: '7px', flexWrap: 'wrap', marginTop: '11px' }}>
        {item.contact.tel ? (
          <a href={`tel:${item.contact.tel}`} style={{ ...btn, textDecoration: 'none', display: 'inline-block' }}>
            Call
          </a>
        ) : null}
        {item.contact.whatsapp ? (
          <a href={item.contact.whatsapp} target="_blank" rel="noopener noreferrer" style={{ ...btn, textDecoration: 'none', display: 'inline-block' }}>
            WhatsApp
          </a>
        ) : null}
        {item.url ? (
          <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ ...btn, textDecoration: 'none', display: 'inline-block' }}>
            Open profile
          </a>
        ) : null}
        <button onClick={copy} style={btn}>
          {copied ? 'Copied' : item.negotiation ? 'Copy negotiation message' : 'Copy a message to send'}
        </button>
        {item.handle && onTry ? (
          <button onClick={() => onTry(`Check the ${PLATFORM_NAME[item.platform]} account ${item.handle} before I pay: is it legit?`)} style={btn}>
            Check closer
          </button>
        ) : null}
      </div>
      <FeedbackRow item={item} getAccessToken={getAccessToken} />
    </div>
  );
}

export function ResearchResultCard({ m, onTry, getAccessToken }: { m: ChatMessage; onTry?: (text: string) => void; getAccessToken?: () => Promise<string | null> }) {
  const r = m.researchResult;
  if (!r) return null;
  if (r.stocks) return <StockResultCard r={r} />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '9px', maxWidth: '460px' }}>
      <div style={{ border: `1px solid ${color.border}`, background: color.surface, borderRadius: '16px', padding: '14px 16px' }}>
        <Label>{r.request.kind === 'hire' ? 'SHORTLIST · PEOPLE TO HIRE' : 'SHORTLIST · VENDORS'}</Label>
        <div style={{ fontSize: '14.5px', lineHeight: 1.5, marginTop: '8px', color: color.ink }}>{r.summary}</div>
        {r.market ? (
          <div style={{ fontSize: '13px', color: color.ink, marginTop: '10px', paddingTop: '10px', borderTop: `1px solid ${color.borderFaint}` }}>
            <span style={{ color: color.mutedStrong }}>Typical price for {r.request.what}: </span>
            <strong>{r.market.text}</strong>
            <span style={{ color: color.mutedStrong }}> · usually around {r.market.middle} (from {r.market.n} published prices)</span>
          </div>
        ) : null}
        <div style={{ fontFamily: MONO, fontSize: '11.5px', color: color.faint, marginTop: '8px' }}>Cost of this search: {r.spent} · receipts saved under Purchases</div>
      </div>
      {r.items.map((item) => (
        <ItemRow key={(item.handle ?? item.name) + (item.url ?? '')} item={item} r={r} onTry={onTry} getAccessToken={getAccessToken} />
      ))}
      {r.expand?.length && onTry ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '0 2px' }}>
          {r.expand.map((o) => (
            <button key={o.label} onClick={() => onTry(o.text)} style={{ border: `1px solid ${color.borderStrong}`, background: color.surface, color: color.ink, fontSize: '13px', padding: '7px 13px', borderRadius: '10px', cursor: 'pointer' }}>
              {o.label}
            </button>
          ))}
        </div>
      ) : null}
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
