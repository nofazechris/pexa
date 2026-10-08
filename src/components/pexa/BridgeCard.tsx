'use client';

import { useState } from 'react';
import { color } from '@/lib/design/tokens';
import type { BridgeCardData } from '@/components/auth/useAgentChat';

/**
 * "Bring USDC from <network>": the deposit address to send to. Nothing to confirm here — Pexa never moves anything on the
 * other network; the person sends from their own wallet or exchange, and the app tells them when it lands.
 */

export function BridgeCard({ data }: { data: BridgeCardData }) {
  const [copied, setCopied] = useState<'address' | 'message' | null>(null);
  const copy = (what: 'address' | 'message') => {
    const text = what === 'address' ? data.address : `Please send USDC on ${data.chain} to this address: ${data.address}
Only USDC, and only on ${data.chain}. It reaches me automatically in my Pexa wallet.`;
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(what);
        setTimeout(() => setCopied(null), 1600);
      },
      () => {},
    );
  };
  const fee = Number(data.estimateFeeUsd);
  const pricey = fee >= 0.5;
  return (
    <div style={{ background: color.surface, border: `1px solid ${color.border}`, borderRadius: '16px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '13px' }}>
      <div style={{ fontFamily: 'var(--font-geist-mono),monospace', fontSize: '10.5px', letterSpacing: '.12em', color: color.faint }}>GET PAID FROM {data.chain.toUpperCase()}</div>

      <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
        {data.qr ? (
          // eslint-disable-next-line @next/next/no-img-element -- a generated data URL, nothing to optimise
          <img src={data.qr} alt={`QR code for the ${data.chain} deposit address`} width={112} height={112} style={{ borderRadius: '10px', background: '#fff', flex: 'none' }} />
        ) : null}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '12.5px', color: color.mutedStrong }}>USDC sent on {data.chain} to this address</div>
          <div style={{ fontFamily: 'var(--font-geist-mono),monospace', fontSize: '12.5px', marginTop: '5px', wordBreak: 'break-all', lineHeight: 1.5 }}>{data.address}</div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '9px' }}>
            <button onClick={() => copy('message')} style={{ border: 'none', background: color.primary, color: '#fff', fontSize: '13px', fontWeight: 500, padding: 'var(--pp-btn-y) 14px', borderRadius: '10px', cursor: 'pointer' }}>
              {copied === 'message' ? 'Copied' : 'Copy message for sender'}
            </button>
            <button onClick={() => copy('address')} style={{ border: `1px solid ${color.borderStrong}`, background: color.surface, color: color.ink, fontSize: '13px', fontWeight: 500, padding: 'var(--pp-btn-y) 14px', borderRadius: '10px', cursor: 'pointer' }}>
              {copied === 'address' ? 'Copied' : 'Copy address'}
            </button>
          </div>
        </div>
      </div>

      <div style={{ borderTop: `1px solid ${color.borderFaint}`, paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '7px', fontSize: '13px', lineHeight: 1.5, color: color.mutedStrong }}>
        <div>
          <b style={{ color: color.ink, fontWeight: 600 }}>It arrives as USDC on Celo</b> in your Pexa wallet, usually within a minute. I’ll notify you.
        </div>
        <div>
          Fee: about <b style={{ color: color.ink, fontWeight: 600 }}>${data.estimateFeeUsd}</b> for $10{pricey ? ` — ${data.chain} network fees are high, so it’s better for larger amounts` : ', a bit more on very small amounts'}.
        </div>
        <div style={{ color: color.warning }}>Send only USDC, and only on {data.chain}. Other tokens or networks may be delayed or need manual recovery.</div>
        <div>Same address every time you use {data.chain}. If a transfer ever fails, it’s refunded to the wallet you sent it from.</div>
      </div>
    </div>
  );
}
