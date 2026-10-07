'use client';

import { color } from '@/lib/design/tokens';
import type { ChatMessage } from '@/components/auth/useAgentChat';

/**
 * Chat cards for a recurring payment. Setting one up authorizes FUTURE payments, so the card says in plain words
 * what will happen and when — including whether it will run by itself or only waits for the user — before the
 * user taps the button. Nothing is created until they do.
 */

const MONO = 'var(--font-geist-mono),monospace';

function money(n: string): string {
  const v = Number(n);
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

export function RecurringPreviewCard({ m, onConfirm, onCancel }: { m: ChatMessage; onConfirm: () => void; onCancel: () => void }) {
  const r = m.recurring;
  if (!r) return null;
  const awaiting = m.status === 'awaiting';
  const working = m.status === 'confirmed';

  return (
    <div style={{ border: `1px solid ${color.border}`, background: color.surface, borderRadius: '16px', padding: '16px', maxWidth: '400px' }}>
      <div style={{ fontFamily: MONO, fontSize: '10.5px', letterSpacing: '.12em', color: color.faint }}>RECURRING PAYMENT</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '7px', marginTop: '10px' }}>
        <span style={{ fontSize: '30px', fontWeight: 600, letterSpacing: '-.04em', fontVariantNumeric: 'tabular-nums' }}>${money(r.amount)}</span>
        <span style={{ fontFamily: MONO, fontSize: '12.5px', color: color.mutedStrong }}>{r.token}</span>
      </div>
      <div style={{ fontSize: '15px', fontWeight: 500, marginTop: '6px' }}>
        to {r.recipient}, <span style={{ color: color.primaryHover }}>{r.cadence.charAt(0).toLowerCase() + r.cadence.slice(1)}</span>
      </div>

      <div style={{ display: 'grid', gap: '8px', marginTop: '13px', paddingTop: '12px', borderTop: `1px solid ${color.borderFaint}`, fontSize: '13.5px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
          <span style={{ color: color.mutedStrong }}>First payment</span>
          <span style={{ fontWeight: 500 }}>{r.firstPayment}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
          <span style={{ color: color.mutedStrong }}>Network</span>
          <span style={{ fontWeight: 500 }}>{r.network}</span>
        </div>
      </div>

      <div
        style={{
          marginTop: '12px',
          borderRadius: '11px',
          padding: '10px 12px',
          fontSize: '12.5px',
          lineHeight: 1.5,
          border: `1px solid ${r.automatic && !r.needsApprovalEachTime ? color.primarySoftBorder : color.warningDot}`,
          background: r.automatic && !r.needsApprovalEachTime ? color.primarySoft : '#FEFBF0',
          color: r.automatic && !r.needsApprovalEachTime ? color.primaryHover : color.warning,
        }}
      >
        {!r.automatic
          ? 'Pexa can’t pay this by itself yet. Turn on Agent payments in Settings and it will run automatically; until then each payment waits for you.'
          : r.needsApprovalEachTime
            ? `Above $${r.autoLimit}, so each payment will wait for your approval before it goes out.`
            : 'Pexa will pay this automatically each time, from your wallet. You can pause or cancel it any time under Payments.'}
      </div>

      {awaiting ? (
        <div style={{ display: 'flex', gap: '8px', marginTop: '14px' }}>
          <button onClick={onConfirm} style={{ flex: 1, border: 'none', background: color.primary, color: '#fff', fontSize: '14px', fontWeight: 500, padding: '12px 15px', borderRadius: '11px', cursor: 'pointer' }}>
            Start recurring payment
          </button>
          <button onClick={onCancel} style={{ border: `1px solid ${color.borderStrong}`, background: color.surface, color: color.ink, fontSize: '14px', fontWeight: 500, padding: '12px 15px', borderRadius: '11px', cursor: 'pointer' }}>
            Cancel
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginTop: '14px', paddingTop: '13px', borderTop: `1px solid ${color.borderFaint}`, fontSize: '13px', color: m.status === 'cancelled' || m.status === 'failed' ? color.warning : color.mutedStrong }}>
          {working ? (
            <>
              <span style={{ width: 12, height: 12, border: `2px solid ${color.primarySoftBorder}`, borderTopColor: color.primary, borderRadius: '50%', animation: 'pp-spin .8s linear infinite', display: 'inline-block' }} />
              Setting it up…
            </>
          ) : m.status === 'cancelled' && m.restored ? (
            'From an earlier chat — ask again to set this up'
          ) : m.status === 'cancelled' ? (
            'Cancelled — nothing was set up'
          ) : (
            'Not set up'
          )}
        </div>
      )}
    </div>
  );
}

export function RecurringReceiptCard({ m }: { m: ChatMessage }) {
  const r = m.recurring;
  const res = m.recurringResult;
  if (!r || !res) return null;

  if (!res.ok) {
    return (
      <div style={{ border: '1px solid #F0DCD8', background: '#FDF8F7', borderRadius: '16px', padding: '15px 16px', maxWidth: '400px' }}>
        <div style={{ fontSize: '14.5px', fontWeight: 600, color: '#A8352A' }}>Couldn’t set it up</div>
        <div style={{ fontSize: '13px', color: '#A8352A', lineHeight: 1.5, marginTop: '6px' }}>{res.error ?? 'Something went wrong.'} Nothing was scheduled.</div>
      </div>
    );
  }
  return (
    <div style={{ border: `1px solid #CDE7DA`, background: color.successSoft, borderRadius: '16px', padding: '15px 16px', maxWidth: '400px' }}>
      <div style={{ fontSize: '14.5px', fontWeight: 600, color: color.success }}>Recurring payment set up</div>
      <div style={{ fontSize: '13.5px', color: color.ink, marginTop: '6px', lineHeight: 1.5 }}>
        ${money(r.amount)} {r.token} to {r.recipient}, {r.cadence.charAt(0).toLowerCase() + r.cadence.slice(1)}.
      </div>
      <div style={{ fontSize: '12.5px', color: color.mutedStrong, marginTop: '4px' }}>
        First payment: {res.next ?? r.firstPayment}. Manage it under Payments — you can pause or cancel any time.
      </div>
    </div>
  );
}
