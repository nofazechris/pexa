'use client';

import { color } from '@/lib/design/tokens';
import type { ChatMessage } from '@/components/auth/useAgentChat';

/**
 * Chat cards for Buy purchases. The Approve card is the human checkpoint for a price the agent found;
 * the receipt card reports exactly what the server recorded — paid, refused before charging, or
 * "needs checking" when we can't prove a payment didn't go through.
 */

const MONO = 'var(--font-geist-mono),monospace';

function Label({ children }: { children: string }) {
  return <div style={{ fontFamily: MONO, fontSize: '10.5px', letterSpacing: '.12em', color: color.faint }}>{children}</div>;
}

export function BuyQuoteCard({ m, onConfirm, onCancel }: { m: ChatMessage; onConfirm: () => void; onCancel: () => void }) {
  const buy = m.buy;
  if (!buy) return null;
  const awaiting = m.status === 'awaiting';
  const paying = m.status === 'confirmed';

  return (
    <div style={{ border: `1px solid ${color.border}`, background: color.surface, borderRadius: '16px', padding: '16px', maxWidth: '400px' }}>
      <Label>{`BUY · CELO · ${buy.token}`}</Label>
      <div style={{ fontSize: '16px', fontWeight: 600, letterSpacing: '-.015em', marginTop: '10px' }}>{buy.service}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '7px', marginTop: '8px' }}>
        <span style={{ fontSize: '30px', fontWeight: 600, letterSpacing: '-.04em', fontVariantNumeric: 'tabular-nums' }}>{buy.price}</span>
        <span style={{ fontFamily: MONO, fontSize: '12.5px', color: color.mutedStrong }}>{buy.token}</span>
      </div>
      {buy.note ? <div style={{ fontSize: '13px', color: color.mutedStrong, lineHeight: 1.5, marginTop: '8px' }}>{buy.note}</div> : null}

      {awaiting ? (
        <>
          <div style={{ display: 'flex', gap: '8px', marginTop: '14px' }}>
            <button onClick={onConfirm} style={{ flex: 1, border: 'none', background: color.primary, color: '#fff', fontSize: '14px', fontWeight: 500, padding: '12px 15px', borderRadius: '11px', cursor: 'pointer' }}>
              Approve & pay {buy.price}
            </button>
            <button onClick={onCancel} style={{ border: `1px solid ${color.borderStrong}`, background: color.surface, color: color.ink, fontSize: '14px', fontWeight: 500, padding: '12px 15px', borderRadius: '11px', cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
          <div style={{ fontSize: '11.5px', color: color.faint, marginTop: '10px', lineHeight: 1.5 }}>
            Payments on Buy can’t be reversed. You sign once, for exactly this price — no gas needed.
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginTop: '14px', paddingTop: '13px', borderTop: `1px solid ${color.borderFaint}`, fontSize: '13px', color: m.status === 'cancelled' || m.status === 'failed' ? color.warning : color.mutedStrong }}>
          {paying ? (
            <>
              <span style={{ width: 12, height: 12, border: `2px solid ${color.primarySoftBorder}`, borderTopColor: color.primary, borderRadius: '50%', animation: 'pp-spin .8s linear infinite', display: 'inline-block' }} />
              Paying and waiting for the result…
            </>
          ) : m.status === 'cancelled' && m.restored ? (
            'From an earlier chat — ask again to buy this'
          ) : m.status === 'cancelled' ? (
            'Cancelled — nothing was charged'
          ) : (
            'Not completed — nothing was charged'
          )}
        </div>
      )}
    </div>
  );
}

function prettyOutput(output: unknown): string {
  if (output === null || output === undefined) return '';
  const text = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
  return text.length > 3000 ? text.slice(0, 3000) + '\n… (shortened)' : text;
}

export function BuyResultCard({ m }: { m: ChatMessage }) {
  const r = m.buyResult;
  if (!r) return null;
  const p = r.purchase;

  const paid = p?.status === 'PAID';
  const uncertain = p?.status === 'UNCERTAIN';
  const tone = paid
    ? { fg: color.success, bg: color.successSoft, border: '#CDE7DA', label: 'Paid' }
    : uncertain
      ? { fg: color.warning, bg: '#FEFBF0', border: color.warningDot, label: 'Needs checking' }
      : { fg: '#A8352A', bg: '#FDF8F7', border: '#F0DCD8', label: 'Not charged' };

  const out = prettyOutput(r.output);

  return (
    <div style={{ border: `1px solid ${tone.border}`, background: tone.bg, borderRadius: '16px', padding: '15px 16px', maxWidth: '440px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
        <span style={{ fontSize: '14.5px', fontWeight: 600, color: tone.fg }}>{tone.label}</span>
        {p ? <span style={{ marginLeft: 'auto', fontFamily: MONO, fontSize: '12.5px', color: color.mutedStrong }}>{p.price} {p.token}</span> : null}
      </div>
      {p ? <div style={{ fontSize: '13.5px', color: color.ink, marginTop: '6px' }}>{p.service}</div> : null}

      {uncertain ? (
        <div style={{ fontSize: '13px', color: color.warning, lineHeight: 1.5, marginTop: '9px' }}>
          {p?.error?.message ?? 'The payment may have gone through.'} <strong>Please don’t retry</strong> — check the receipt first.
        </div>
      ) : null}
      {!paid && !uncertain ? (
        <div style={{ fontSize: '13px', color: '#A8352A', lineHeight: 1.5, marginTop: '9px' }}>{p?.error?.message ?? r.error ?? 'The purchase didn’t complete. Nothing was charged.'}</div>
      ) : null}

      {out ? (
        <details style={{ marginTop: '10px' }}>
          <summary style={{ fontSize: '13px', fontWeight: 500, color: color.primaryHover, cursor: 'pointer' }}>View result</summary>
          <pre style={{ margin: '8px 0 0', maxHeight: '240px', overflow: 'auto', background: color.surface, border: `1px solid ${color.borderFaint}`, borderRadius: '10px', padding: '10px 11px', fontFamily: MONO, fontSize: '11.5px', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: color.ink }}>{out}</pre>
        </details>
      ) : null}

      {p?.receiptUrl || p?.correlationId ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginTop: '11px', paddingTop: '10px', borderTop: `1px solid ${tone.border}`, fontSize: '12px' }}>
          {p.receiptUrl ? (
            <a href={p.receiptUrl} target="_blank" rel="noopener noreferrer" style={{ color: color.primary, textDecoration: 'underline' }}>
              View receipt on Celoscan
            </a>
          ) : null}
          {p.correlationId ? <span style={{ fontFamily: MONO, color: color.faint }}>ref {p.correlationId.slice(0, 12)}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
