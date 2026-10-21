'use client';

import { useCallback } from 'react';
import { useWallets, useSendTransaction } from '@privy-io/react-auth';
import { useAuth } from './AuthProvider';
import { isEarnToken, isExpectedEarnTx, type EarnAction, type EarnTx } from '@/lib/earn/aave';
import type { EarnOutcome } from './useAgentChat';

/**
 * Runs a confirmed Aave deposit or withdrawal with the person's own wallet. The server reads the market, covers the network
 * fee and checks every step on-chain; this hook only signs what the server prepared — and only if it is exactly an approve of
 * the coin to the Aave pool, a deposit credited to the person's OWN address, or a withdrawal sent to their OWN address.
 */

interface Prepared {
  ok: true;
  from: string;
  action: EarnAction;
  token: string;
  needsApproval: boolean;
  txs: EarnTx[];
}

const PENDING_POLLS = 6;

export function useEarn() {
  const { getAccessToken } = useAuth();
  const { wallets } = useWallets();
  const { sendTransaction } = useSendTransaction();

  const step = useCallback(
    async (earnId: string, body: Record<string, unknown>) => {
      const token = await getAccessToken();
      const res = await fetch(`/api/earn/${earnId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      return { ok: res.ok, data };
    },
    [getAccessToken],
  );

  const executeEarn = useCallback(
    async (earnId: string, token: string, action: string): Promise<EarnOutcome> => {
      if (!isEarnToken(token) || (action !== 'deposit' && action !== 'withdraw')) return { ok: false, error: 'I can’t do that with this coin.' };
      const verb = action === 'deposit' ? 'deposited' : 'withdrawn';
      try {
        const prep = await step(earnId, { action: 'prepare' });
        if (!prep.ok) return { ok: false, error: String(prep.data.message ?? 'I couldn’t prepare that.') };
        const prepared = prep.data as unknown as Prepared;

        // Sign with exactly the wallet the server prepared this for.
        const want = prepared.from.toLowerCase();
        const wallet = wallets.find((w) => w.address?.toLowerCase() === want);
        if (!wallet) return { ok: false, error: 'Your account wallet isn’t available to sign in this browser. Sign out and back in, then try again.' };

        // Refuse anything that is not exactly this coin, this action, and only ever the person's own address.
        for (const tx of prepared.txs) {
          if (!isExpectedEarnTx(tx, { token, action, wallet: wallet.address })) return { ok: false, error: `That didn’t look right, so I stopped. Nothing was ${verb}.` };
        }

        let mainHash: string | null = null;
        for (const tx of prepared.txs) {
          const sent = await sendTransaction({ to: tx.to, data: tx.data, value: 0n, chainId: tx.chainId }, { address: wallet.address, uiOptions: { showWalletUIs: false } });
          if (!sent.hash) return { ok: false, error: `The wallet didn’t return a transaction. Nothing was ${verb}.` };
          if (tx.kind === 'approve') {
            const approved = await step(earnId, { action: 'approved', txHash: sent.hash });
            if (!approved.ok) return { ok: false, error: String(approved.data.message ?? `The approval didn’t go through. Nothing was ${verb}.`) };
          } else {
            mainHash = sent.hash;
          }
        }
        if (!mainHash) return { ok: false, error: 'Nothing was sent.' };

        // The server waits for the chain and reads what moved. If it is slow, ask again (it is safe to repeat).
        for (let i = 0; i < PENDING_POLLS; i++) {
          const fin = await step(earnId, { action: 'finalize', txHash: mainHash });
          if (!fin.ok) return { ok: false, error: String(fin.data.message ?? 'It couldn’t be confirmed.') };
          const d = fin.data as { status: 'CONFIRMED' | 'PENDING'; amount: string | null; position: string | null; txHash: string; explorerUrl: string };
          if (d.status === 'CONFIRMED') return { ok: true, status: 'CONFIRMED', amount: d.amount, position: d.position, txHash: d.txHash, explorerUrl: d.explorerUrl };
          if (i === PENDING_POLLS - 1) return { ok: true, status: 'PENDING', amount: null, position: null, txHash: d.txHash, explorerUrl: d.explorerUrl };
          await new Promise((r) => setTimeout(r, 2000));
        }
        return { ok: false, error: 'It couldn’t be confirmed.' };
      } catch (e) {
        const msg = e instanceof Error ? e.message.toLowerCase() : '';
        if (msg.includes('reject') || msg.includes('denied') || msg.includes('cancel')) return { ok: false, error: `Cancelled. Nothing was ${verb}.` };
        return { ok: false, error: 'Something went wrong signing that. If the wallet shows a pending transaction, check Activity before trying again.' };
      }
    },
    [step, wallets, sendTransaction],
  );

  const cancelEarn = useCallback(
    async (earnId: string) => {
      try {
        await step(earnId, { action: 'cancel' });
      } catch {
        /* best effort: an unused quote just expires */
      }
    },
    [step],
  );

  return { executeEarn, cancelEarn };
}
