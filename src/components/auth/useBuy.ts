'use client';

import { useCallback } from 'react';
import { useSignTypedData, useWallets } from '@privy-io/react-auth';
import { useAuth } from './AuthProvider';

/**
 * Browser half of a Buy purchase. When the agent finds a price the user must approve, the user taps
 * Approve and this runs: the user's own wallet signs ONE USDC transfer authorization for exactly that
 * quote (Privy signs headlessly in its secure enclave — no gas, no pop-up), we hand the signature to the
 * server (which verifies it, claims the purchase so it can't be paid twice, and sends the payment), and
 * then we poll until the purchase reaches a final state. Success is only ever reported from the server's
 * recorded state — never assumed.
 */

export interface BuyTypedData {
  domain: { name: string; version: string; chainId: number; verifyingContract: string };
  types: Record<string, { name: string; type: string }[]>;
  primaryType: 'TransferWithAuthorization';
  message: { from: string; to: string; value: string; validAfter: string; validBefore: string; nonce: string; [k: string]: unknown };
}

export interface BuyPurchaseView {
  id: string;
  service: string;
  capabilityId: string;
  status: string; // QUOTED | SUBMITTING | PAID | UNCERTAIN | FAILED | CANCELLED | EXPIRED
  mode: string | null;
  price: string;
  priceAtomic: string;
  /** Stablecoin it was paid in: USDC | USDT | USAT. */
  token: string;
  txHash: string | null;
  receiptUrl: string | null;
  correlationId: string | null;
  error: { code: string; message: string } | null;
  createdAt: string;
  paidAt: string | null;
  expiresAt: string;
}

export interface BuyResult {
  ok: boolean;
  purchase?: BuyPurchaseView;
  output?: unknown;
  outputTruncated?: boolean;
  error?: string;
}

const FINAL = new Set(['PAID', 'FAILED', 'UNCERTAIN', 'CANCELLED', 'EXPIRED']);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function useBuy() {
  const { getAccessToken } = useAuth();
  const { wallets } = useWallets();
  const { signTypedData } = useSignTypedData();

  const authed = useCallback(
    async (url: string, init?: RequestInit) => {
      const token = await getAccessToken();
      return fetch(url, { ...init, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) } });
    },
    [getAccessToken],
  );

  const executeBuy = useCallback(
    async (args: { purchaseId: string; from: string; typedData: BuyTypedData }): Promise<BuyResult> => {
      try {
        // Sign with EXACTLY the wallet the quote was made for — never "whichever wallet is first".
        const want = args.from.toLowerCase();
        const wallet = wallets.find((w) => w.address?.toLowerCase() === want);
        if (!wallet) {
          return { ok: false, error: 'Your account wallet isn’t available to sign in this browser. Sign out and back in, then try again.' };
        }
        const { signature } = await signTypedData(args.typedData, { address: wallet.address, uiOptions: { showWalletUIs: false } });

        const payRes = await authed('/api/buy/pay', { method: 'POST', body: JSON.stringify({ purchaseId: args.purchaseId, signature }) });
        const payData = (await payRes.json().catch(() => ({}))) as { message?: string };
        if (!payRes.ok) return { ok: false, error: payData.message ?? 'The purchase couldn’t be started. Nothing was charged.' };

        // Poll the recorded state until it's final. A VM purchase can take a few minutes.
        const deadline = Date.now() + 5 * 60 * 1000;
        while (Date.now() < deadline) {
          await sleep(2000);
          const res = await authed(`/api/buy/purchases/${args.purchaseId}`);
          if (!res.ok) continue;
          const data = (await res.json()) as { purchase: BuyPurchaseView; output?: unknown; outputTruncated?: boolean };
          if (FINAL.has(data.purchase.status)) return { ok: data.purchase.status === 'PAID', purchase: data.purchase, output: data.output, outputTruncated: data.outputTruncated };
        }
        // Still running after 5 minutes: it has NOT failed. Point at the receipt instead of guessing.
        return { ok: false, error: 'This is taking longer than usual. It may still complete — check your receipts before trying again.' };
      } catch (e) {
        console.error('[buy] approve failed:', e);
        const msg = e instanceof Error ? e.message.toLowerCase() : '';
        if (msg.includes('reject') || msg.includes('denied') || msg.includes('cancel')) return { ok: false, error: 'Signing was cancelled, so nothing was charged.' };
        return { ok: false, error: 'Something went wrong before the payment was sent. Nothing was charged.' };
      }
    },
    [wallets, signTypedData, authed],
  );

  const cancelBuy = useCallback(
    async (purchaseId: string): Promise<void> => {
      try {
        await authed(`/api/buy/purchases/${purchaseId}/cancel`, { method: 'POST' });
      } catch {
        /* best effort — an unused quote expires on its own */
      }
    },
    [authed],
  );

  return { executeBuy, cancelBuy };
}
