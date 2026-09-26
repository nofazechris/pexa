'use client';

import { useState } from 'react';
import { usePrivy, useDelegatedActions } from '@privy-io/react-auth';
import { color } from '@/lib/design/tokens';

/**
 * "Agent payments" consent on the Connected screen. Delegating the embedded wallet lets an agent
 * (via MCP) settle a payment server-side after confirm_payment — without switching to the app.
 * Keys stay in Privy's TEE; every delegated payment still passes policy (per-payment + daily
 * caps), single-use authorization and idempotency. Off by default; one tap to enable/disable.
 */
export function AgentPayments() {
  const { user } = usePrivy();
  const { delegateWallet, revokeWallets } = useDelegatedActions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wallet = user?.linkedAccounts?.find(
    (a) => a.type === 'wallet' && a.walletClientType === 'privy' && a.chainType === 'ethereum',
  ) as { address?: string; delegated?: boolean } | undefined;
  const address = wallet?.address;
  const delegated = wallet?.delegated === true;

  if (!address) {
    // No embedded wallet yet — say so instead of rendering nothing (which looks broken).
    return (
      <div style={{ background: color.surface, border: `1px solid ${color.border}`, borderRadius: '16px', padding: '22px', marginTop: '16px' }}>
        <div style={{ fontSize: '15px', fontWeight: 600 }}>Agent payments</div>
        <p style={{ fontSize: '13.5px', color: color.muted, lineHeight: 1.6, margin: '8px 0 0' }}>
          Your wallet is still being set up. Once it’s ready you can let Pexa settle confirmed payments on its own.
        </p>
      </div>
    );
  }

  const enable = async () => {
    setBusy(true);
    setError(null);
    try {
      await delegateWallet({ address, chainType: 'ethereum' });
    } catch (e) {
      // Distinguish a user cancel (fine, stay silent) from a real failure the user should see.
      const msg = e instanceof Error ? e.message : '';
      if (!/cancel|dismiss|reject|denied|closed/i.test(msg)) {
        setError(
          msg
            ? `Couldn’t enable agent payments: ${msg}`
            : 'Couldn’t enable agent payments. Please try again — and if it keeps failing, this device or browser may not support it yet.',
        );
      }
    } finally {
      setBusy(false);
    }
  };
  const disable = async () => {
    setBusy(true);
    setError(null);
    try {
      await revokeWallets();
    } catch (e) {
      setError(e instanceof Error ? `Couldn’t disable: ${e.message}` : 'Couldn’t disable agent payments. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ background: color.surface, border: `1px solid ${color.border}`, borderRadius: '16px', padding: '22px', marginTop: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <div style={{ fontSize: '15px', fontWeight: 600 }}>Agent payments</div>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '11.5px',
            color: delegated ? color.success : color.mutedStrong,
            background: delegated ? color.successSoft : color.surfaceMuted,
            border: `1px solid ${delegated ? '#CDE7DA' : color.borderFaint}`,
            padding: '4px 9px',
            borderRadius: '999px',
          }}
        >
          <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: delegated ? color.success : color.warningDot, display: 'inline-block' }} />
          {delegated ? 'Enabled' : 'Off'}
        </span>
      </div>
      <p style={{ fontSize: '13.5px', color: color.muted, lineHeight: 1.6, margin: '8px 0 0', maxWidth: '620px' }}>
        {delegated
          ? 'Pexa can settle a payment right after you confirm it, without opening the app. It settles amounts up to $100 on its own; anything larger (like a big recurring payment) waits for you to approve it. Every payment still passes your limits ($500 per payment, $1,000 per day), a one-time authorization, and on-chain confirmation. Your keys never leave Privy.'
          : 'Off by default: payments Pexa starts are prepared and wait for you to approve here. Turn this on to let Pexa settle on its own up to $100 per payment — larger ones still ask you first. Keys stay in Privy, and every payment still passes policy and a one-time authorization.'}
      </p>
      {error ? (
        <div style={{ marginTop: '12px', border: '1px solid #F0DCD8', background: '#FDF8F7', borderRadius: '11px', padding: '11px 13px', fontSize: '13px', color: '#A8352A', lineHeight: 1.5 }}>{error}</div>
      ) : null}
      <div style={{ marginTop: '16px' }}>
        {delegated ? (
          <button
            onClick={disable}
            disabled={busy}
            style={{ border: `1px solid ${color.borderStrong}`, background: color.surface, color: color.ink, fontSize: '14px', fontWeight: 500, borderRadius: '10px', padding: '10px 18px', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}
          >
            {busy ? 'Working…' : 'Disable agent payments'}
          </button>
        ) : (
          <button
            onClick={enable}
            disabled={busy}
            style={{ border: 'none', background: color.primary, color: '#fff', fontSize: '14px', fontWeight: 500, borderRadius: '10px', padding: '10px 18px', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}
          >
            {busy ? 'Working…' : 'Enable agent payments'}
          </button>
        )}
      </div>
    </div>
  );
}
