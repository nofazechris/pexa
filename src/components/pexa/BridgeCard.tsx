'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { color } from '@/lib/design/tokens';
import type { BridgeCardData } from '@/components/auth/useAgentChat';
import { BRIDGE_CHAINS } from '@/lib/bridge/chains';
import { AgentOrb } from '@/components/pexa/AgentOrb';

/**
 * "Get paid from <network>": the deposit address to send to. Nothing to confirm here — Pexa never moves anything on the
 * other network; the person sends from their own wallet or exchange. While the card is the live one in the chat it watches for
 * the money by itself (and has a "Check now" button), then says plainly when it has arrived.
 */

type Phase = 'idle' | 'watching' | 'processing' | 'arrived' | 'stopped';

const POLL_MS = 6_000;
const MAX_WATCH_MS = 20 * 60_000;

export function BridgeCard({ data, watch = false, getAccessToken }: { data: BridgeCardData; watch?: boolean; getAccessToken?: () => Promise<string | null> }) {
  const [copied, setCopied] = useState<'address' | 'message' | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [arrived, setArrived] = useState<{ amount: string; token: string } | null>(null);
  const [checking, setChecking] = useState(false);
  // Cards saved before the network id was stored still know their network's name.
  const chainId = data.chainId ?? BRIDGE_CHAINS.find((c) => c.label.toLowerCase() === data.chain.toLowerCase())?.chainId;
  const sinceRef = useRef<string>('');
  const startedRef = useRef<number>(0);
  const doneRef = useRef(false);

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

  /** One look: has money landed on Celo since the card appeared, and what does the bridge say? Returns true when finished. */
  const check = useCallback(async (): Promise<boolean> => {
    if (doneRef.current || !sinceRef.current || typeof chainId !== 'number') return doneRef.current;
    try {
      const token = getAccessToken ? await getAccessToken() : null;
      const res = await fetch(`/api/bridge/status?chainId=${chainId}&since=${encodeURIComponent(sinceRef.current)}`, { headers: token ? { authorization: `Bearer ${token}` } : {}, cache: 'no-store' });
      if (!res.ok) return false;
      const d = (await res.json()) as { deposits?: Array<{ amount: string; token: string }>; state?: string };
      const first = d.deposits?.[0];
      if (first) {
        doneRef.current = true;
        setArrived({ amount: first.amount, token: first.token });
        setPhase('arrived');
        return true;
      }
      setPhase(d.state === 'processing' ? 'processing' : 'watching');
    } catch {
      /* try again on the next tick */
    }
    return false;
  }, [chainId, getAccessToken]);

  // Start watching when this is the live card; stop after it arrives or 20 minutes.
  useEffect(() => {
    if (!watch) return;
    sinceRef.current = new Date().toISOString();
    startedRef.current = Date.now();
    doneRef.current = false;
    const first = setTimeout(() => setPhase('watching'), 0);
    const timer = setInterval(async () => {
      if (Date.now() - startedRef.current > MAX_WATCH_MS) {
        clearInterval(timer);
        if (!doneRef.current) setPhase('stopped');
        return;
      }
      if (await check()) clearInterval(timer);
    }, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [watch, check]);

  const checkNow = async () => {
    setChecking(true);
    if (phase === 'stopped') {
      // Start a fresh 20 minutes from now.
      startedRef.current = Date.now();
      setPhase('watching');
    }
    await check();
    setChecking(false);
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

      {watch ? (
        <div role="status" aria-live="polite" style={{ borderTop: `1px solid ${color.borderFaint}`, paddingTop: '12px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {phase === 'arrived' && arrived ? (
            <span style={{ flex: 1, minWidth: '180px', fontSize: '13.5px', fontWeight: 600, color: color.success }}>
              ✓ Deposit arrived: ${arrived.amount} {arrived.token} is in your wallet.
            </span>
          ) : (
            <>
              {phase === 'stopped' ? null : <AgentOrb stage="searching" size={20} />}
              <span style={{ flex: 1, minWidth: '160px', fontSize: '13px', color: color.mutedStrong, lineHeight: 1.45 }}>
                {phase === 'processing'
                  ? `Deposit detected on ${data.chain} — converting it to USDC on Celo…`
                  : phase === 'stopped'
                    ? 'Stopped watching after 20 minutes. Tap Check now any time.'
                    : `Waiting for your deposit on ${data.chain}… this updates by itself.`}
              </span>
              <button onClick={() => void checkNow()} disabled={checking} style={{ border: `1px solid ${color.borderStrong}`, background: color.surface, color: color.ink, fontSize: '13px', fontWeight: 500, padding: 'var(--pp-btn-y) 14px', borderRadius: '10px', cursor: 'pointer', flex: 'none' }}>
                {checking ? 'Checking…' : 'Check now'}
              </button>
            </>
          )}
        </div>
      ) : null}

      <div style={{ borderTop: `1px solid ${color.borderFaint}`, paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '7px', fontSize: '13px', lineHeight: 1.5, color: color.mutedStrong }}>
        <div>
          <b style={{ color: color.ink, fontWeight: 600 }}>It arrives as USDC on Celo</b> in your Pexa wallet, usually within a minute. I’ll notify you.
        </div>
        <div>
          Network &amp; bridge fee: about <b style={{ color: color.ink, fontWeight: 600 }}>${data.estimateFeeUsd}</b> per $10, so $10 sent arrives as about <b style={{ color: color.ink, fontWeight: 600 }}>${(10 - fee).toFixed(2)}</b>. That fee goes to the networks, not to Pexa — Pexa adds no fee.{pricey ? ` ${data.chain} gas is expensive, so it suits larger amounts.` : ' It’s mostly a flat cost, so bigger transfers lose a smaller share.'}
        </div>
        <div style={{ color: color.warning }}>Send only USDC, and only on {data.chain}. Other tokens or networks may be delayed or need manual recovery.</div>
        <div>Same address every time you use {data.chain}. If a transfer ever fails, it’s refunded to the wallet you sent it from.</div>
      </div>
    </div>
  );
}
