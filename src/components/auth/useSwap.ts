'use client';

import { useCallback } from 'react';
import { useWallets, useSendTransaction } from '@privy-io/react-auth';
import { useAuth } from './AuthProvider';
import { isExpectedSwapTx, isSwapToken, type SwapTx } from '@/lib/swap/route';
import type { SwapOutcome } from './useAgentChat';

/**
 * Runs a confirmed conversion with the person's own wallet. The server quotes, covers the network fee and checks every
 * step on-chain; this hook only signs what the server prepared — and only if it is exactly an approve of the paid coin to
 * the Uniswap router, or the router call itself. It never sends anything else.
 */

interface Prepared {
  ok: true;
  from: string;
  needsApproval: boolean;
  txs: SwapTx[];
}

const PENDING_POLLS = 6;

export function useSwap() {
  const { getAccessToken } = useAuth();
  const { wallets } = useWallets();
  const { sendTransaction } = useSendTransaction();

  const step = useCallback(
    async (swapId: string, body: Record<string, unknown>) => {
      const token = await getAccessToken();
      const res = await fetch(`/api/swaps/${swapId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      return { ok: res.ok, data };
    },
    [getAccessToken],
  );

  const executeSwap = useCallback(
    async (swapId: string, fromToken: string): Promise<SwapOutcome> => {
      if (!isSwapToken(fromToken)) return { ok: false, error: 'I can’t convert that coin.' };
      try {
        const prep = await step(swapId, { action: 'prepare' });
        if (!prep.ok) return { ok: false, error: String(prep.data.message ?? 'I couldn’t prepare that conversion.') };
        const prepared = prep.data as unknown as Prepared;

        // Sign with exactly the wallet the server prepared this for.
        const want = prepared.from.toLowerCase();
        const wallet = wallets.find((w) => w.address?.toLowerCase() === want);
        if (!wallet) return { ok: false, error: 'Your account wallet isn’t available to sign in this browser. Sign out and back in, then try again.' };

        for (const tx of prepared.txs) {
          if (!isExpectedSwapTx(tx, fromToken)) return { ok: false, error: 'That conversion didn’t look right, so I stopped. Nothing was converted.' };
        }

        let swapHash: string | null = null;
        for (const tx of prepared.txs) {
          const sent = await sendTransaction({ to: tx.to, data: tx.data, value: 0n, chainId: tx.chainId }, { address: wallet.address, uiOptions: { showWalletUIs: false } });
          if (!sent.hash) return { ok: false, error: 'The wallet didn’t return a transaction. Nothing was converted.' };
          if (tx.kind === 'approve') {
            const approved = await step(swapId, { action: 'approved', txHash: sent.hash });
            if (!approved.ok) return { ok: false, error: String(approved.data.message ?? 'The approval didn’t go through. Nothing was converted.') };
          } else {
            swapHash = sent.hash;
          }
        }
        if (!swapHash) return { ok: false, error: 'Nothing was sent.' };

        // The server waits for the chain and reads what arrived. If it is slow, ask again (it is safe to repeat).
        for (let i = 0; i < PENDING_POLLS; i++) {
          const fin = await step(swapId, { action: 'finalize', txHash: swapHash });
          if (!fin.ok) return { ok: false, error: String(fin.data.message ?? 'The conversion couldn’t be confirmed.') };
          const d = fin.data as { status: 'CONFIRMED' | 'PENDING'; amountOut: string | null; txHash: string; explorerUrl: string };
          if (d.status === 'CONFIRMED') return { ok: true, status: 'CONFIRMED', amountOut: d.amountOut, txHash: d.txHash, explorerUrl: d.explorerUrl };
          if (i === PENDING_POLLS - 1) return { ok: true, status: 'PENDING', amountOut: null, txHash: d.txHash, explorerUrl: d.explorerUrl };
          await new Promise((r) => setTimeout(r, 2000));
        }
        return { ok: false, error: 'The conversion couldn’t be confirmed.' };
      } catch (e) {
        const msg = e instanceof Error ? e.message.toLowerCase() : '';
        if (msg.includes('reject') || msg.includes('denied') || msg.includes('cancel')) return { ok: false, error: 'Cancelled. Nothing was converted.' };
        return { ok: false, error: 'Something went wrong signing that. If the wallet shows a pending transaction, check Activity before trying again.' };
      }
    },
    [step, wallets, sendTransaction],
  );

  const cancelSwap = useCallback(
    async (swapId: string) => {
      try {
        await step(swapId, { action: 'cancel' });
      } catch {
        /* best effort: an unused quote just expires */
      }
    },
    [step],
  );

  return { executeSwap, cancelSwap };
}
