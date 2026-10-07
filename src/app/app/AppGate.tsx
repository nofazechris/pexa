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
import { useBuy, type BuyTypedData } from '@/components/auth/useBuy';
import { useConversations } from '@/components/auth/useConversations';
import type { PendingActionView, AgentFailReason } from '@/components/auth/useAgentChat';
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
  const { loading: profileLoading, profile, wallet, unavailable, error: profileError, refresh: refreshProfile } = useProfile();
  const { address: walletAddress } = useWallet();
  // The wallet our database has pinned for this user is authoritative; the browser's own view of
  // it (walletAddress) is only a fallback until the server answers.
  const canonicalAddress = wallet?.address ?? walletAddress ?? null;
  const { balance, refresh: refreshBalance } = useBalance(canonicalAddress);
  const { pay } = usePayment();
  const { items: activity, refresh: refreshActivity } = useActivity();
  const { items: requests, markPaid: markRequestPaid, refresh: refreshRequests, cancel: cancelRequest, decline: declineRequest } = useRequests();
  const { items: recurring, setPaused: setRecurringPaused, cancel: cancelRecurring, refresh: refreshRecurring } = useRecurring();
  const { executeBuy, cancelBuy } = useBuy();
  const conversations = useConversations();
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
      // Approve a Buy purchase: sign with the user's wallet, pay, and wait for the recorded result.
      executeBuy: async (args: { purchaseId: string; from: string; typedData: BuyTypedData }) => {
        const r = await executeBuy(args);
        refreshBalance();
        refreshActivity();
        return r;
      },
      cancelBuy,
      // Set up a confirmed recurring payment; the server re-validates the person, amount and schedule.
      createRecurring: async (args: { payee: string; amount: string; cadence: string }) => {
        try {
          const token = await getAccessToken();
          const res = await fetch('/api/recurring', {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
            body: JSON.stringify(args),
          });
          const data = (await res.json().catch(() => ({}))) as { recurring?: { next?: string }; message?: string };
          if (res.ok) {
            refreshRecurring();
            return { ok: true as const, next: data.recurring?.next };
          }
          return { ok: false as const, error: data.message ?? 'Couldn’t set that up.' };
        } catch {
          return { ok: false as const, error: 'Network error.' };
        }
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
          if (!res.ok) {
            // Map the HTTP failure to a plain reason the chat can explain in human terms.
            let code = '';
            try {
              code = ((await res.json()) as { error?: string })?.error ?? '';
            } catch {
              /* no JSON body */
            }
            const reason: AgentFailReason =
              res.status === 503
                ? code === 'database_not_configured' || code === 'temporarily_unavailable'
                  ? 'account' // our database/servers, not the AI
                  : 'unavailable'
                : 'server';
            return { ok: false as const, reason };
          }
          const data = (await res.json()) as { reply: string; action?: PendingActionView };
          // The agent may have created a request, set up a recurring payment, or moved money in this
          // turn — reflect it right away so the user never has to reload to see it.
          refreshRequests();
          refreshRecurring();
          refreshActivity();
          refreshBalance();
          return { ok: true as const, reply: data.reply, action: data.action };
        } catch {
          // Network error / offline / request never reached the server.
          return { ok: false as const, reason: 'network' as const };
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
    [pay, refreshBalance, refreshActivity, refreshRequests, refreshRecurring, markRequestPaid, setRecurringPaused, cancelRecurring, getAccessToken, executeBuy, cancelBuy],
  );

  useEffect(() => {
    if (ready && (!configured || !authenticated)) {
      router.replace('/');
    }
  }, [ready, configured, authenticated, router]);

  // Live updates without a manual reload: refresh the app's data on an interval and whenever the
  // tab regains focus, so an incoming request, a new recurring payment, a received payment, and the
  // balance all appear on their own.
  useEffect(() => {
    if (!ready || !authenticated) return;
    const refreshAll = () => {
      refreshBalance();
      refreshActivity();
      refreshRequests();
      refreshRecurring();
    };
    const id = setInterval(refreshAll, 15000);
    const onFocus = () => refreshAll();
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshAll();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [ready, authenticated, refreshBalance, refreshActivity, refreshRequests, refreshRecurring]);

  // Signed-in but no username yet → onboarding. Only when we KNOW there's no profile (a successful
  // load): never on a transient error (would skip username setup) and never when the DB is simply
  // not configured (the local escape hatch below).
  useEffect(() => {
    if (ready && authenticated && !profileLoading && !profile && !unavailable && !profileError) {
      router.replace('/onboarding');
    }
  }, [ready, authenticated, profileLoading, profile, unavailable, profileError, router]);

  // A signed-in user whose profile couldn't be loaded (a DB/network blip) must NOT land in the app
  // without a username — show a clear retry instead of guessing.
  if (ready && configured && authenticated && !profileLoading && !profile && profileError) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: color.background, padding: '24px' }}>
        <div style={{ display: 'grid', gap: '14px', justifyItems: 'center', textAlign: 'center', maxWidth: 340 }}>
          <Text variant="body">We couldn’t load your account just now.</Text>
          <Text variant="caption" tone="muted">This is usually a brief connection hiccup. Try again in a moment.</Text>
          <button
            onClick={refreshProfile}
            style={{ border: 'none', background: color.primary, color: '#fff', fontSize: '14px', fontWeight: 500, padding: '11px 22px', borderRadius: '11px', cursor: 'pointer' }}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

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
      uid={profile?.uid ?? undefined}
      address={canonicalAddress ?? undefined}
      balance={balance ?? '0'}
      activity={activity}
      requests={requests}
      recurring={recurring}
      onSignOut={() => logout()}
      sendToAgent={hooks.sendToAgent}
      executeAction={hooks.executeAction}
      executeSend={hooks.executeSend}
      executeBuy={hooks.executeBuy}
      cancelBuy={hooks.cancelBuy}
      createRecurring={hooks.createRecurring}
      conversations={conversations}
      payRequest={hooks.payRequest}
      cancelRequest={cancelRequest}
      declineRequest={declineRequest}
      setRecurringPaused={hooks.setRecurringPaused}
      cancelRecurring={hooks.cancelRecurring}
      getAccessToken={getAccessToken}
    />
  );
}
