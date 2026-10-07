/**
 * Finding deposits — money that arrived in a wallet from OUTSIDE Pexa — from the token contracts' on-chain
 * Transfer events. Pure helpers: how much of the chain to read each run, and which events count.
 *
 * The blockchain connection only answers log searches over 5,000 blocks at a time (Celo makes about one block a
 * second, so ~83 minutes). So each run reads a few 5,000-block slices after the last block it finished, then
 * remembers where it stopped; a wallet that hasn't been checked for a while catches up over a few runs.
 */

export const SLICE_BLOCKS = 5000;
/** A wallet scanned for the first time looks back this far (~2.8 hours), not through all of history. */
export const INITIAL_LOOKBACK = 10_000;
/** Cap per run so one request never turns into a long crawl. */
export const MAX_SLICES_PER_RUN = 6;

export interface ScanPlan {
  /** Inclusive [from, to] block ranges to search, oldest first. */
  slices: Array<[number, number]>;
  /** Where the cursor should be saved after these slices succeed (null when there is nothing to do). */
  endBlock: number | null;
  /** True when these slices reach the chain tip (nothing left to catch up on). */
  caughtUp: boolean;
}

export function planScan(lastBlock: number | null, latest: number): ScanPlan {
  const from = lastBlock === null ? Math.max(0, latest - INITIAL_LOOKBACK) : lastBlock + 1;
  if (from > latest) return { slices: [], endBlock: null, caughtUp: true };
  const slices: Array<[number, number]> = [];
  let a = from;
  while (a <= latest && slices.length < MAX_SLICES_PER_RUN) {
    const b = Math.min(a + SLICE_BLOCKS - 1, latest);
    slices.push([a, b]);
    a = b + 1;
  }
  const endBlock = slices[slices.length - 1][1];
  return { slices, endBlock, caughtUp: endBlock === latest };
}

/** An ERC-20 Transfer event as decoded by the chain client. */
export interface DecodedTransfer {
  address: string;
  args: { from: string; to: string; value: bigint };
  blockNumber: bigint;
  logIndex: number | null;
  transactionHash: string;
}

export interface Deposit {
  token: string;
  amountAtomic: string;
  from: string;
  txHash: string;
  logIndex: number;
  blockNumber: number;
}

/**
 * Is this transfer a deposit INTO `wallet`? It must come from one of the known token contracts, go to the wallet,
 * carry a real amount, and not be the wallet paying itself.
 */
export function toDeposit(ev: DecodedTransfer, wallet: string, tokens: Record<string, string>): Deposit | null {
  const w = wallet.toLowerCase();
  const symbol = Object.entries(tokens).find(([, addr]) => addr.toLowerCase() === ev.address.toLowerCase())?.[0];
  if (!symbol) return null;
  if (ev.args.to.toLowerCase() !== w) return null;
  if (ev.args.from.toLowerCase() === w) return null;
  if (ev.args.value <= 0n) return null;
  if (ev.logIndex === null || ev.logIndex === undefined) return null;
  return {
    token: symbol,
    amountAtomic: ev.args.value.toString(),
    from: ev.args.from.toLowerCase(),
    txHash: ev.transactionHash.toLowerCase(),
    logIndex: ev.logIndex,
    blockNumber: Number(ev.blockNumber),
  };
}
