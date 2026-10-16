'use client';

import { useCallback } from 'react';
import { useAuth } from './AuthProvider';
import type { BuyResult, BuyTypedData } from './useBuy';
import type { ResearchResult } from '@/lib/research/types';

/**
 * Browser half of a research ("find me a vendor"). The user approved ONE budget; the server decides each next purchase
 * inside it and this loop carries them out: ask for the next step, have the user's own wallet sign it (headlessly — no
 * pop-up, no gas), pay, ask again — until the server hands back the finished shortlist. Every purchase is its own
 * payment signed by the user's wallet; the server refuses anything outside the budget or the allow-list.
 */

export interface ResearchProgress {
  label: string;
  /** Which lookup this is (1, 2, 3…). */
  step: number;
  spent: string;
  cap: string;
}

export type ResearchOutcome =
  | { ok: true; result: ResearchResult }
  /** `final`: the search is over (nothing more will happen); otherwise it paused and can be resumed. */
  | { ok: false; error: string; final: boolean };

type StepReply =
  | { kind: 'pay'; purchaseId: string; from: string; typedData: BuyTypedData; price: string; label: string; step: number; spent: string; cap: string }
  | { kind: 'wait'; message: string }
  | { kind: 'done'; result: ResearchResult }
  | { kind: 'failed'; message: string };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const MAX_LOOPS = 16;

export function useResearch(executeBuy: (args: { purchaseId: string; from: string; typedData: BuyTypedData }) => Promise<BuyResult>) {
  const { getAccessToken } = useAuth();

  const authed = useCallback(
    async (url: string, init?: RequestInit) => {
      const token = await getAccessToken();
      return fetch(url, { ...init, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) } });
    },
    [getAccessToken],
  );

  const executeResearch = useCallback(
    async (sessionId: string, onProgress: (p: ResearchProgress) => void): Promise<ResearchOutcome> => {
      try {
        let waits = 0;
        for (let loop = 0; loop < MAX_LOOPS + waits; loop++) {
          const res = await authed(`/api/research/${sessionId}/step`, { method: 'POST' });
          const data = (await res.json().catch(() => ({}))) as Partial<StepReply> & { message?: string };
          if (!res.ok) return { ok: false, error: data.message ?? 'I couldn’t continue the search just now. Nothing more was charged.', final: false };

          if (data.kind === 'done' && data.result) return { ok: true, result: data.result };
          if (data.kind === 'failed') return { ok: false, error: data.message ?? 'The search didn’t work out. Nothing was charged for what failed.', final: true };
          if (data.kind === 'wait') {
            waits++;
            if (waits > 40) return { ok: false, error: 'A lookup is taking longer than usual. It may still finish — check your receipts, then try again.', final: false };
            await sleep(2500);
            continue;
          }
          if (data.kind === 'pay' && data.purchaseId && data.typedData && data.from) {
            onProgress({ label: data.label ?? 'Working…', step: data.step ?? loop + 1, spent: data.spent ?? '', cap: data.cap ?? '' });
            const paid = await executeBuy({ purchaseId: data.purchaseId, from: data.from, typedData: data.typedData });
            // Never got as far as paying (signing declined, connection dropped): pause, don't guess.
            if (!paid.ok && !paid.purchase) return { ok: false, error: paid.error ?? 'The search paused before paying. Nothing was charged for this lookup.', final: false };
            continue; // a failed/uncertain lookup is the server's call: it skips it or stops, never retries a payment
          }
          return { ok: false, error: 'Something unexpected happened. Nothing more was charged.', final: false };
        }
        return { ok: false, error: 'The search took more steps than expected, so I stopped. Nothing more was charged.', final: true };
      } catch (e) {
        console.error('[research] failed:', e);
        return { ok: false, error: 'Something went wrong on the way. Anything already bought is in your receipts.', final: false };
      }
    },
    [authed, executeBuy],
  );

  const cancelResearch = useCallback(
    async (sessionId: string): Promise<void> => {
      try {
        await authed(`/api/research/${sessionId}/cancel`, { method: 'POST' });
      } catch {
        /* best effort — an unapproved plan never buys anything anyway */
      }
    },
    [authed],
  );

  return { executeResearch, cancelResearch };
}
