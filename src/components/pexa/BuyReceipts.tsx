'use client';

import { useCallback, useEffect, useState } from 'react';
import { Modal } from '@/components/ui';
import { color } from '@/lib/design/tokens';
import type { BuyPurchaseView } from '@/components/auth/useBuy';

/**
 * Receipts and saved results for everything Pexa bought. The result of a purchase (the Reddit posts, the
 * profile, the browser output) is stored with it, so it can be reopened any time, copied, downloaded, or
 * handed back to the agent ("Ask Pexa about this").
 */

const MONO = 'var(--font-geist-mono),monospace';

export function purchaseTone(status: string): { fg: string; label: string } {
  switch (status) {
    case 'PAID':
      return { fg: color.success, label: 'Paid' };
    case 'UNCERTAIN':
      return { fg: color.warning, label: 'Needs checking' };
    case 'SUBMITTING':
      return { fg: color.primaryHover, label: 'Processing' };
    case 'QUOTED':
      return { fg: color.mutedStrong, label: 'Awaiting approval' };
    case 'CANCELLED':
      return { fg: color.mutedStrong, label: 'Cancelled' };
    case 'EXPIRED':
      return { fg: color.mutedStrong, label: 'Expired' };
    default:
      return { fg: 'var(--pp-danger-text)', label: 'Not charged' };
  }
}

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function resultText(output: unknown): string {
  if (output === null || output === undefined) return '';
  return typeof output === 'string' ? output : JSON.stringify(output, null, 2);
}

/** A plain-text receipt the user can keep. */
export function receiptText(p: BuyPurchaseView): string {
  const lines = [
    'PEXA RECEIPT',
    `Service:    ${p.service}`,
    `Amount:     ${p.price} ${p.token}`,
    `Status:     ${purchaseTone(p.status).label}`,
    `Date:       ${new Date(p.createdAt).toLocaleString()}`,
    p.mode ? `Approved:   ${p.mode === 'autonomous' ? 'automatically, within your limits' : 'by you'}` : '',
    p.txHash ? `Transaction: ${p.txHash}` : '',
    p.receiptUrl ? `On-chain:   ${p.receiptUrl}` : '',
    p.correlationId ? `Reference:  ${p.correlationId}` : '',
    `Purchase:   ${p.id}`,
  ];
  return lines.filter(Boolean).join('\n');
}

export function PurchaseRow({ p, onOpen, last }: { p: BuyPurchaseView; onOpen: () => void; last?: boolean }) {
  const tone = purchaseTone(p.status);
  return (
    <button
      onClick={onOpen}
      style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '12px', padding: '13px 16px', border: 'none', borderBottom: last ? 'none' : `1px solid ${color.borderFaint}`, background: 'transparent', cursor: 'pointer' }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '14px', fontWeight: 500, color: color.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.service}</div>
        <div style={{ fontSize: '12px', color: color.mutedStrong, marginTop: '2px' }}>
          {when(p.createdAt)}
          {p.mode === 'autonomous' ? ' · bought automatically' : p.mode === 'confirmed' ? ' · you approved' : ''}
        </div>
      </div>
      <div style={{ marginLeft: 'auto', textAlign: 'right', flex: 'none' }}>
        <div style={{ fontFamily: MONO, fontSize: '12.5px', fontVariantNumeric: 'tabular-nums', color: color.ink }}>
          {p.price} {p.token}
        </div>
        <div style={{ fontSize: '12px', fontWeight: 500, color: tone.fg, marginTop: '2px' }}>{tone.label}</div>
      </div>
    </button>
  );
}

/** The receipt + saved result for one purchase. */
export function ReceiptSheet({
  purchase,
  onClose,
  getAccessToken,
  onAsk,
}: {
  purchase: BuyPurchaseView | null;
  onClose: () => void;
  getAccessToken?: () => Promise<string | null>;
  /** Hand a question about this purchase to the chat agent. */
  onAsk?: (text: string) => void;
}) {
  const [output, setOutput] = useState<string>('');
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<'receipt' | 'result' | null>(null);

  const id = purchase?.id ?? null;
  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const token = getAccessToken ? await getAccessToken() : null;
      const res = await fetch(`/api/buy/purchases/${id}`, { cache: 'no-store', headers: token ? { authorization: `Bearer ${token}` } : {} });
      if (res.ok) {
        const data = (await res.json()) as { output?: unknown; outputTruncated?: boolean };
        setOutput(resultText(data.output));
        setTruncated(Boolean(data.outputTruncated));
      }
    } catch {
      /* the receipt still shows without the saved result */
    } finally {
      setLoading(false);
    }
  }, [id, getAccessToken]);

  useEffect(() => {
    if (!id) return;
    const t = setTimeout(() => {
      setOutput('');
      setTruncated(false);
      setCopied(null);
      void load();
    }, 0);
    return () => clearTimeout(t);
  }, [id, load]);

  if (!purchase) return null;
  const p = purchase;
  const tone = purchaseTone(p.status);

  const copy = async (what: 'receipt' | 'result') => {
    try {
      await navigator.clipboard.writeText(what === 'receipt' ? receiptText(p) : output);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard can be blocked; the download button still works */
    }
  };

  const download = () => {
    const body = receiptText(p) + (output ? `\n\n--- RESULT ---\n${output}` : '');
    const url = URL.createObjectURL(new Blob([body], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `pexa-receipt-${p.id.slice(0, 8)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const small = { border: `1px solid ${color.borderStrong}`, background: color.surface, color: color.ink, fontSize: '13px', fontWeight: 500, padding: '8px 12px', borderRadius: '10px', cursor: 'pointer' } as const;

  return (
    <Modal open onClose={onClose} placement="bottom" title="Receipt" maxWidth={520}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '70dvh', overflowY: 'auto' }}>
        <div>
          <div style={{ fontSize: '16px', fontWeight: 600, letterSpacing: '-.015em' }}>{p.service}</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '6px' }}>
            <span style={{ fontSize: '26px', fontWeight: 600, letterSpacing: '-.03em', fontVariantNumeric: 'tabular-nums' }}>{p.price}</span>
            <span style={{ fontFamily: MONO, fontSize: '12.5px', color: color.mutedStrong }}>{p.token}</span>
            <span style={{ marginLeft: 'auto', fontSize: '13px', fontWeight: 600, color: tone.fg }}>{tone.label}</span>
          </div>
          <div style={{ fontSize: '12.5px', color: color.mutedStrong, marginTop: '4px' }}>
            {when(p.createdAt)}
            {p.mode === 'autonomous' ? ' · bought automatically' : p.mode === 'confirmed' ? ' · approved by you' : ''}
          </div>
        </div>

        {p.error ? <div style={{ fontSize: '13px', color: p.status === 'UNCERTAIN' ? color.warning : 'var(--pp-danger-text)', lineHeight: 1.5 }}>{p.error.message}</div> : null}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', fontSize: '12.5px' }}>
          {p.receiptUrl ? (
            <a href={p.receiptUrl} target="_blank" rel="noopener noreferrer" style={{ color: color.primary, textDecoration: 'underline' }}>
              View on Celoscan
            </a>
          ) : null}
          {p.correlationId ? <span style={{ fontFamily: MONO, color: color.faint }}>ref {p.correlationId.slice(0, 14)}</span> : null}
        </div>

        <div>
          <div style={{ fontFamily: MONO, fontSize: '10.5px', letterSpacing: '.12em', color: color.faint, marginBottom: '6px' }}>SAVED RESULT</div>
          {loading ? (
            <div style={{ fontSize: '13px', color: color.mutedStrong }}>Loading…</div>
          ) : output ? (
            <pre style={{ margin: 0, maxHeight: '260px', overflow: 'auto', background: color.surfaceMuted, border: `1px solid ${color.borderFaint}`, borderRadius: '10px', padding: '10px 11px', fontFamily: MONO, fontSize: '11.5px', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: color.ink }}>
              {output}
              {truncated ? '\n… (shortened)' : ''}
            </pre>
          ) : (
            <div style={{ fontSize: '13px', color: color.mutedStrong }}>{p.status === 'PAID' ? 'No result was saved for this purchase.' : 'Nothing to show — no result came back.'}</div>
          )}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          <button onClick={() => void copy('receipt')} style={small}>
            {copied === 'receipt' ? 'Copied' : 'Copy receipt'}
          </button>
          {output ? (
            <button onClick={() => void copy('result')} style={small}>
              {copied === 'result' ? 'Copied' : 'Copy result'}
            </button>
          ) : null}
          <button onClick={download} style={small}>
            Download
          </button>
          {onAsk && p.status === 'PAID' ? (
            <button
              onClick={() => {
                onAsk(`Tell me about my "${p.service}" purchase from ${new Date(p.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} (purchase ${p.id}) — summarize what it found.`);
                onClose();
              }}
              style={{ ...small, borderColor: color.primarySoftBorder, background: color.primarySoft, color: color.primaryHover }}
            >
              Ask Pexa about this
            </button>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}

/** Everything Pexa has bought, as tappable receipts. Used in Activity. */
export function PurchasesPanel({ getAccessToken, onAsk }: { getAccessToken?: () => Promise<string | null>; onAsk?: (text: string) => void }) {
  const [items, setItems] = useState<BuyPurchaseView[] | null>(null);
  const [open, setOpen] = useState<BuyPurchaseView | null>(null);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      try {
        const token = getAccessToken ? await getAccessToken() : null;
        const res = await fetch('/api/buy/purchases', { cache: 'no-store', headers: token ? { authorization: `Bearer ${token}` } : {} });
        if (!res.ok) return;
        const data = (await res.json()) as { purchases?: BuyPurchaseView[] };
        if (alive) setItems(data.purchases ?? []);
      } catch {
        if (alive) setItems((prev) => prev ?? []);
      }
    };
    const first = setTimeout(() => void run(), 0);
    const id = setInterval(() => void run(), 15_000);
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(id);
    };
  }, [getAccessToken]);

  return (
    <>
      <div style={{ background: color.surface, border: `1px solid ${color.border}`, borderRadius: '16px', overflow: 'hidden' }}>
        {items === null ? <div style={{ padding: '30px 18px', textAlign: 'center', fontSize: '14px', color: color.mutedStrong }}>Loading…</div> : null}
        {items && items.length === 0 ? (
          <div style={{ padding: '30px 18px', textAlign: 'center', fontSize: '14px', color: color.mutedStrong, lineHeight: 1.5 }}>
            Nothing bought yet. When Pexa buys something for you, the receipt and what it found are saved here.
          </div>
        ) : null}
        {items?.map((p, i) => <PurchaseRow key={p.id} p={p} last={i === items.length - 1} onOpen={() => setOpen(p)} />)}
      </div>
      <ReceiptSheet purchase={open} onClose={() => setOpen(null)} getAccessToken={getAccessToken} onAsk={onAsk} />
    </>
  );
}
