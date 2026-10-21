'use client';

import { color } from '@/lib/design/tokens';
import type { ChatMessage } from '@/components/auth/useAgentChat';
import { AgentOrb } from '@/components/pexa/AgentOrb';

/**
 * Chat cards for putting money into Aave on Celo and taking it back out. The preview says plainly what is being done, what Aave
 * pays (and how much of any headline is temporary rewards), and the risk; the receipt reports what the chain says moved —
 * never an estimate, never before it is confirmed.
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

export function EarnPreviewCard({ m, onConfirm, onCancel }: { m: ChatMessage; onConfirm: () => void; onCancel: () => void }) {
  const e = m.earn;
  if (!e) return null;
  const deposit = e.action === 'deposit';
  const awaiting = m.status === 'awaiting';
  const working = m.status === 'confirmed' && !m.earnResult;

  return (
    <div style={{ border: `1px solid ${color.border}`, background: color.surface, borderRadius: '16px', padding: '16px', maxWidth: '400px' }}>
      <Label>{`${deposit ? 'DEPOSIT' : 'WITHDRAW'} · AAVE ON ${e.network.toUpperCase()}`}</Label>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '7px', marginTop: '12px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 'clamp(22px, 7vw, 28px)', fontWeight: 600, letterSpacing: '-.04em', fontVariantNumeric: 'tabular-nums' }}>{e.amount}</span>
        <span style={{ fontFamily: MONO, fontSize: '12.5px', color: color.mutedStrong }}>{e.token}</span>
        <span style={{ color: color.faint, fontSize: '18px' }}>{deposit ? '→' : '←'}</span>
        <span style={{ fontSize: '15px', fontWeight: 500, color: color.primary }}>{deposit ? 'Aave' : 'your wallet'}</span>
      </div>
      {!deposit && e.isMax ? <div style={{ fontSize: '12.5px', color: color.mutedStrong, marginTop: '4px' }}>Everything, including what it has earned.</div> : null}

      <div style={{ marginTop: '12px', borderTop: `1px solid ${color.borderFaint}`, paddingTop: '8px' }}>
        <Row k="Aave pays" v={`${e.baseApy}% a year`} />
        {e.rewardApy ? <Row k="Temporary rewards" v={`+ ${e.rewardApy}% (can end any time)`} /> : null}
        {Number(e.position) > 0 ? <Row k={deposit ? 'Already in Aave' : 'In Aave now'} v={`${e.position} ${e.token}`} /> : null}
        <Row k="Network fee" v="Covered by Pexa" />
        <Row k="Pexa fee" v="None" />
      </div>
      <div style={{ fontSize: '11.5px', color: color.faint, marginTop: '6px', lineHeight: 1.5 }}>
        {deposit
          ? 'Your money goes into Aave, a third-party lending protocol. You can withdraw whenever Aave has cash available, but smart contracts can fail, the rate changes daily and it is not insured. Not financial advice.'
          : 'This takes your money back to your own wallet. If Aave has lent most of it out, a large withdrawal may have to wait.'}
      </div>

      {awaiting ? (
        <div style={{ display: 'flex', gap: '8px', marginTop: '14px' }}>
          <button onClick={onConfirm} style={{ flex: 1, border: 'none', background: color.primary, color: '#fff', fontSize: '14px', fontWeight: 500, padding: 'var(--pp-btn-y) 15px', borderRadius: '11px', cursor: 'pointer' }}>
            {deposit ? `Deposit ${e.amount} ${e.token}` : `Withdraw ${e.amount} ${e.token}`}
          </button>
          <button onClick={onCancel} style={{ border: `1px solid ${color.borderStrong}`, background: color.surface, color: color.ink, fontSize: '14px', fontWeight: 500, padding: 'var(--pp-btn-y) 15px', borderRadius: '11px', cursor: 'pointer' }}>
            Cancel
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginTop: '14px', paddingTop: '13px', borderTop: `1px solid ${color.borderFaint}`, fontSize: '13px', color: m.status === 'cancelled' || m.status === 'failed' ? color.warning : color.mutedStrong }}>
          {working ? (
            <>
              <AgentOrb stage="walking" size={20} />
              {deposit ? 'Depositing on Celo… keep this open' : 'Withdrawing on Celo… keep this open'}
            </>
          ) : m.status === 'cancelled' && m.restored ? (
            'From an earlier chat — ask again'
          ) : m.status === 'cancelled' ? (
            `Cancelled — nothing was ${deposit ? 'deposited' : 'withdrawn'}`
          ) : m.status === 'failed' || (m.earnResult && !m.earnResult.ok) ? (
            'Didn’t complete — see below'
          ) : m.earnResult?.status === 'PENDING' ? (
            'Sent — still confirming'
          ) : (
            'Done'
          )}
        </div>
      )}
    </div>
  );
}

export function EarnReceiptCard({ m }: { m: ChatMessage }) {
  const e = m.earn;
  const r = m.earnResult;
  if (!e || !r) return null;
  const deposit = e.action === 'deposit';

  if (!r.ok) {
    return (
      <div style={{ border: `1px solid ${color.dangerBorder}`, background: color.dangerTint, borderRadius: '16px', padding: '14px 16px', maxWidth: '400px' }}>
        <div style={{ fontSize: '14.5px', fontWeight: 600, color: color.dangerText }}>{deposit ? 'Deposit didn’t complete' : 'Withdrawal didn’t complete'}</div>
        <div style={{ fontSize: '13px', color: color.mutedStrong, marginTop: '5px', lineHeight: 1.5 }}>{r.error ?? 'Something went wrong.'}</div>
      </div>
    );
  }
  const pending = r.status === 'PENDING';
  return (
    <div style={{ border: `1px solid ${pending ? color.border : color.successBorder}`, background: pending ? color.surface : color.successSoft, borderRadius: '16px', padding: '14px 16px', maxWidth: '400px' }}>
      <Label>{pending ? (deposit ? 'DEPOSIT SENT' : 'WITHDRAWAL SENT') : deposit ? 'DEPOSITED' : 'WITHDRAWN'}</Label>
      <div style={{ fontSize: '16px', fontWeight: 600, letterSpacing: '-.015em', marginTop: '8px', color: color.ink }}>
        {pending ? e.amount : (r.amount ?? e.amount)} {e.token} {deposit ? '→ Aave' : '→ your wallet'}
      </div>
      <div style={{ fontSize: '12.5px', color: color.mutedStrong, marginTop: '5px', lineHeight: 1.5 }}>
        {pending ? 'Sent to Celo and still confirming.' : 'Confirmed on Celo. The amount is what the chain says moved.'}
        {!pending && r.position !== undefined && r.position !== null ? ` You now have ${r.position} ${e.token} in Aave.` : ''}
      </div>
      {r.explorerUrl ? (
        <a href={r.explorerUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginTop: '9px', fontSize: '13px', fontWeight: 500 }}>
          View on Celoscan ↗
        </a>
      ) : null}
    </div>
  );
}
