'use client';

import { useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { PexaApp } from '@/components/pexa/PexaApp';
import { useAuth } from '@/components/auth/AuthProvider';
import { useProfile } from '@/components/auth/useProfile';
import { useWallet } from '@/components/auth/useWallet';
import { useBalance } from '@/components/auth/useBalance';
import { usePayment } from '@/components/auth/usePayment';
import { useActivity } from '@/components/auth/useActivity';
import { useRequests } from '@/components/auth/useRequests';
import { useRecurring } from '@/components/auth/useRecurring';
import type { PendingActionView } from '@/components/auth/useAgentChat';
import { Spinner, Text } from '@/components/ui';
import { color } from '@/lib/design/tokens';

/**
 * Protected application route (§134 Stage 3–4).
 *
 * Unauthenticated visitors go to the marketing landing; signed-in users without a username go
 * to onboarding; the dashboard renders only for a signed-in user who has a profile. Server-side
 * data endpoints are additionally protected by `getSessionUser`. When the database isn't
 * configured (`unavailable`), the app still renders so local work isn't blocked — onboarding
 * simply can't gate.
 * (Data shown here is still the in-memory demo until Stages 6–13 wire real balances.)
 */
export default function AppGate() {
  const { configured, ready, authenticated, logout, getAccessToken } = useAuth();
  const { loading: profileLoading, profile, wallet, unavailable } = useProfile();
  const { address: walletAddress } = useWallet();
  const { balance, refresh: refreshBalance } = useBalance(walletAddress ?? wallet?.address ?? null);
  const { pay } = usePayment();
  const { items: activity, refresh: refreshActivity } = useActivity();
  const { items: requests, markPaid: markRequestPaid } = useRequests();
  const { items: recurring, setPaused: setRecurringPaused, cancel: cancelRecurring } = useRecurring();
  const router = useRouter();

  // The real hooks the agent + screens drive. The chat itself is now a server-side tool-calling
  // agent (sendToAgent/executeAction); crypto sends still settle via the client-sign path.
  const hooks = useMemo(
    () => ({
      // Crypto send — client-sign path (real on-chain settlement), used when the agent's confirm
      // card is a payment.
      executeSend: async (args: { recipient: string; amount: string }) => {
        const res = await pay(args);
        if (res.status === 'confirmed' || res.status === 'pending') {
          refreshBalance();
          refreshActivity();
          return { ok: true as const, status: res.status, txHash: res.txHash, explorerUrl: res.explorerUrl };
        }
        return { ok: false as const, error: res.error ?? 'Payment failed.' };
      },
      // Pay a received request from the Payments screen.
      payRequest: async (args: { requestId: string; recipient: string; amount: string }) => {
        const res = await pay({ recipient: args.recipient, amount: args.amount });
        if (res.status === 'confirmed' || res.status === 'pending') {
          await markRequestPaid(args.requestId, res.paymentId ?? null);
          refreshBalance();
          refreshActivity();
          return { ok: true as const };
        }
        return { ok: false as const, error: res.error ?? 'Payment failed.' };
      },
      setRecurringPaused: (id: string, paused: boolean) => setRecurringPaused(id, paused),
      cancelRecurring: (id: string) => cancelRecurring(id),
      // The tool-calling agent: one message + recent history in, a reply (+ optional pending action) out.
      sendToAgent: async (args: { message: string; history: { role: 'user' | 'assistant'; content: string }[] }) => {
        try {
          const token = await getAccessToken();
          const res = await fetch('/api/agent/chat', {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
            body: JSON.stringify(args),
          });
          if (!res.ok) return null;
          return (await res.json()) as { reply: string; action?: PendingActionView };
        } catch {
          return null;
        }
      },
      // Execute a user-confirmed fiat action (buy/sell/withdraw) server-side via the policy engine.
      executeAction: async (args: { tool: string; args: Record<string, unknown> }) => {
        try {
          const token = await getAccessToken();
          const res = await fetch('/api/agent/execute', {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
            body: JSON.stringify(args),
          });
          const data = (await res.json().catch(() => ({}))) as { result?: { order?: { orderId: string; status: string } }; message?: string };
          if (res.ok) {
            refreshBalance();
            refreshActivity();
            return { ok: true as const, result: data.result };
          }
          return { ok: false as const, error: data.message ?? 'Action failed.' };
        } catch {
          return { ok: false as const, error: 'Network error.' };
        }
      },
    }),
    [pay, refreshBalance, refreshActivity, markRequestPaid, setRecurringPaused, cancelRecurring, getAccessToken],
  );

  useEffect(() => {
    if (ready && (!configured || !authenticated)) {
      router.replace('/');
    }
  }, [ready, configured, authenticated, router]);

  // Signed-in but no username yet → onboarding (unless the DB is unavailable, where we can't
  // tell and fall through to the app).
  useEffect(() => {
    if (ready && authenticated && !profileLoading && !profile && !unavailable) {
      router.replace('/onboarding');
    }
  }, [ready, authenticated, profileLoading, profile, unavailable, router]);

  const gating = !ready || !configured || !authenticated || profileLoading || (!profile && !unavailable);
  if (gating) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: color.background }}>
        <div style={{ display: 'grid', gap: '12px', justifyItems: 'center' }}>
          <Spinner size={22} />
          <Text variant="caption" tone="muted">
            {ready && !authenticated ? 'Redirecting…' : 'Loading your account…'}
          </Text>
        </div>
      </div>
    );
  }

  return (
    <PexaApp
      username={profile?.username}
      address={walletAddress ?? wallet?.address}
      balance={balance ?? '0'}
      activity={activity}
      requests={requests}
      recurring={recurring}
      onSignOut={() => logout()}
      sendToAgent={hooks.sendToAgent}
      executeAction={hooks.executeAction}
      executeSend={hooks.executeSend}
      payRequest={hooks.payRequest}
      setRecurringPaused={hooks.setRecurringPaused}
      cancelRecurring={hooks.cancelRecurring}
      getAccessToken={getAccessToken}
    />
  );
}
