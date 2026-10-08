'use client';

import { useEffect, useState } from 'react';
import { color } from '@/lib/design/tokens';
import type { ChatMessage } from '@/components/auth/useAgentChat';

/**
 * Chat cards for converting between the dollar coins (USDC ⇄ USDT ⇄ USAT). The preview shows the quote and the least the
 * person will get; the receipt reports what the chain says arrived — never an estimate, never before it is confirmed.
 */

const MONO = 'var(--font-geist-mono),monospace';

function Label({ children }: { children: string }) {
  return <div style={{ fontFamily: MONO, fontSize: '10.5px', letterSpacing: '.12em', color: color.faint }}>{children}</div>;
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', fontSize: '13px', padding: '5px 0' }}>
      <span style={{ color: color.mutedStrong }}>{k}</span>
      <span style={{ color: color.ink, fontWeight: 500, textAlign: 'right' }}>{v}</span>
    </div>
  );
}

export function SwapPreviewCard({ m, onConfirm, onCancel }: { m: ChatMessage; onConfirm: () => void; onCancel: () => void }) {
  const s = m.swap;
  if (!s) return null;
  const awaiting = m.status === 'awaiting';
  const working = m.status === 'confirmed' && !m.swapResult;

  return (
    <div style={{ border: `1px solid ${color.border}`, background: color.surface, borderRadius: '16px', padding: '16px', maxWidth: '400px' }}>
      <Label>{`CONVERT · ${s.network.toUpperCase()}`}</Label>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '7px', marginTop: '12px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 'clamp(22px, 7vw, 28px)', fontWeight: 600, letterSpacing: '-.04em', fontVariantNumeric: 'tabular-nums' }}>{s.amountIn}</span>
        <span style={{ fontFamily: MONO, fontSize: '12.5px', color: color.mutedStrong }}>{s.from}</span>
        <span style={{ color: color.faint, fontSize: '18px' }}>→</span>
        <span style={{ fontSize: 'clamp(22px, 7vw, 28px)', fontWeight: 600, letterSpacing: '-.04em', fontVariantNumeric: 'tabular-nums', color: color.primary }}>{s.expectedOut}</span>
        <span style={{ fontFamily: MONO, fontSize: '12.5px', color: color.mutedStrong }}>{s.to}</span>
      </div>

      <div style={{ marginTop: '12px', borderTop: `1px solid ${color.borderFaint}`, paddingTop: '8px' }}>
        <Row k="Rate" v={`1 ${s.from} ≈ ${s.rate} ${s.to}`} />
        <Row k="You’ll get at least" v={`${s.minOut} ${s.to}`} />
        <Row k="Route" v={`${s.routeLabel} · Uniswap`} />
        <Row k="Network fee" v="Covered by Pexa" />
        <Row k="Pexa fee" v="None" />
      </div>
      <div style={{ fontSize: '11.5px', color: color.faint, marginTop: '6px', lineHeight: 1.5 }}>
        The price can move up to {s.slippagePercent}% before it runs; if it moves further, nothing happens. The quote lasts a few minutes.
      </div>

      {awaiting ? (
        <div style={{ display: 'flex', gap: '8px', marginTop: '14px' }}>
          <button onClick={onConfirm} style={{ flex: 1, border: 'none', background: color.primary, color: '#fff', fontSize: '14px', fontWeight: 500, padding: 'var(--pp-btn-y) 15px', borderRadius: '11px', cursor: 'pointer' }}>
            Convert {s.amountIn} {s.from}
          </button>
          <button onClick={onCancel} style={{ border: `1px solid ${color.borderStrong}`, background: color.surface, color: color.ink, fontSize: '14px', fontWeight: 500, padding: 'var(--pp-btn-y) 15px', borderRadius: '11px', cursor: 'pointer' }}>
            Cancel
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginTop: '14px', paddingTop: '13px', borderTop: `1px solid ${color.borderFaint}`, fontSize: '13px', color: m.status === 'cancelled' || m.status === 'failed' ? color.warning : color.mutedStrong }}>
          {working ? (
            <>
              <span style={{ width: 12, height: 12, border: `2px solid ${color.primarySoftBorder}`, borderTopColor: color.primary, borderRadius: '50%', animation: 'pp-spin .8s linear infinite', display: 'inline-block' }} />
              Converting on Celo… keep this open
            </>
          ) : m.status === 'cancelled' && m.restored ? (
            'From an earlier chat — ask again to convert'
          ) : m.status === 'cancelled' ? (
            'Cancelled — nothing was converted'
          ) : m.status === 'failed' || (m.swapResult && !m.swapResult.ok) ? (
            'Didn’t complete — see below'
          ) : m.swapResult?.status === 'PENDING' ? (
            'Sent — still confirming'
          ) : (
            'Done'
          )}
        </div>
      )}
    </div>
  );
}

export function SwapReceiptCard({ m }: { m: ChatMessage }) {
  const s = m.swap;
  const r = m.swapResult;
  if (!s || !r) return null;

  if (!r.ok) {
    return (
      <div style={{ border: `1px solid ${color.dangerBorder}`, background: color.dangerTint, borderRadius: '16px', padding: '14px 16px', maxWidth: '400px' }}>
        <div style={{ fontSize: '14.5px', fontWeight: 600, color: color.dangerText }}>Conversion didn’t complete</div>
        <div style={{ fontSize: '13px', color: color.mutedStrong, marginTop: '5px', lineHeight: 1.5 }}>{r.error ?? 'Something went wrong.'}</div>
      </div>
    );
  }
  const pending = r.status === 'PENDING';
  return (
    <div style={{ border: `1px solid ${pending ? color.border : color.successBorder}`, background: pending ? color.surface : color.successSoft, borderRadius: '16px', padding: '14px 16px', maxWidth: '400px' }}>
      <Label>{pending ? 'CONVERSION SENT' : 'CONVERTED'}</Label>
      <div style={{ fontSize: '16px', fontWeight: 600, letterSpacing: '-.015em', marginTop: '8px', color: color.ink }}>
        {s.amountIn} {s.from} → {pending ? '…' : r.amountOut} {s.to}
      </div>
      <div style={{ fontSize: '12.5px', color: color.mutedStrong, marginTop: '5px', lineHeight: 1.5 }}>
        {pending ? 'Sent to Celo and still confirming. It will show in your balance once it lands.' : 'Confirmed on Celo. The amount is what actually arrived in your wallet.'}
      </div>
      {r.explorerUrl ? (
        <a href={r.explorerUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginTop: '9px', fontSize: '13px', fontWeight: 500 }}>
          View on Celoscan ↗
        </a>
      ) : null}
    </div>
  );
}

interface ConversionItem {
  id: string;
  from: string;
  to: string;
  amountIn: string;
  amountOut: string | null;
  explorerUrl: string | null;
  at: string;
}

/** Activity → Conversions: every finished conversion, with a link to its transaction. */
export function ConversionsPanel({ getAccessToken, onAsk }: { getAccessToken?: () => Promise<string | null>; onAsk: (text: string) => void }) {
  const [items, setItems] = useState<ConversionItem[] | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const token = getAccessToken ? await getAccessToken() : null;
        const res = await fetch('/api/swaps', { headers: token ? { authorization: `Bearer ${token}` } : {}, cache: 'no-store' });
        if (!res.ok) throw new Error('failed');
        const d = (await res.json()) as { swaps?: ConversionItem[] };
        if (alive) setItems(d.swaps ?? []);
      } catch {
        if (alive) setItems([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [getAccessToken]);

  return (
    <div style={{ background: color.surface, border: `1px solid ${color.border}`, borderRadius: '16px', overflow: 'hidden' }}>
      {items === null ? <div style={{ padding: '30px 18px', textAlign: 'center', fontSize: '14px', color: color.mutedStrong }}>Loading…</div> : null}
      {items && items.length === 0 ? (
        <div style={{ padding: '30px 18px', textAlign: 'center', fontSize: '14px', color: color.mutedStrong, lineHeight: 1.6 }}>
          No conversions yet.
          <div>
            <button onClick={() => onAsk('Convert $5 to USAT')} style={{ marginTop: '10px', border: `1px solid ${color.borderStrong}`, background: color.surface, color: color.ink, fontSize: '13px', fontWeight: 500, padding: 'var(--pp-btn-y) 14px', borderRadius: '10px', cursor: 'pointer' }}>
              Try “Convert $5 to USAT”
            </button>
          </div>
        </div>
      ) : null}
      {(items ?? []).map((c) => (
        <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: 'var(--pp-btn-y-lg) 16px', borderBottom: `1px solid ${color.neutral}` }}>
          <div style={{ width: 34, height: 34, borderRadius: '50%', background: color.primarySoft, color: color.primary, fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>⇄</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '14.5px', fontWeight: 500, letterSpacing: '-.012em' }}>
              {c.from} → {c.to}
            </div>
            <div style={{ fontSize: '12.5px', color: color.mutedStrong, marginTop: '2px' }}>{new Date(c.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
          </div>
          <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
            <div style={{ fontSize: '14.5px', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
              {c.amountIn} → {c.amountOut ?? '…'}
            </div>
            {c.explorerUrl ? (
              <a href={c.explorerUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: '12px' }}>
                Celoscan ↗
              </a>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
