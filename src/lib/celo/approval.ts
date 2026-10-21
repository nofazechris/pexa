import { decodeEventLog, erc20Abi, type Address, type Hex } from 'viem';

/**
 * Did an approval transaction really cover what we need? The receipt of the approval itself says so (its own Approval log), and
 * that cannot be out of date. Reading the allowance afterwards CAN be: the server's RPC may answer from a node a block or two
 * behind, and then a perfectly good approval looks like it didn't happen. So the log is trusted first, and the allowance read is
 * a fallback that is retried a few times before giving up.
 */

interface LogLike {
  address: string;
  data: Hex;
  topics: readonly Hex[];
}

const APPROVAL_EVENT = erc20Abi.filter((x) => x.type === 'event' && x.name === 'Approval');

/** True when one of these logs is the token's own Approval from `owner` to `spender` for at least `amount`. */
export function approvalInLogs(logs: readonly LogLike[], token: Address, owner: Address, spender: Address, amount: bigint): boolean {
  for (const log of logs) {
    if (log.address.toLowerCase() !== token.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: APPROVAL_EVENT, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      const a = ev.args as { owner: string; spender: string; value: bigint };
      if (a.owner.toLowerCase() === owner.toLowerCase() && a.spender.toLowerCase() === spender.toLowerCase() && a.value >= amount) return true;
    } catch {
      /* not an Approval */
    }
  }
  return false;
}

interface Reader {
  readContract: (args: { address: Address; abi: typeof erc20Abi; functionName: 'allowance'; args: [Address, Address] }) => Promise<unknown>;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Is the approval good? The receipt's log first; else the allowance, read up to `tries` times to ride out a node that is behind. */
export async function approvalCovers(client: Reader, opts: { token: Address; owner: Address; spender: Address; amount: bigint; logs: readonly LogLike[]; tries?: number; waitMs?: number }): Promise<boolean> {
  if (approvalInLogs(opts.logs, opts.token, opts.owner, opts.spender, opts.amount)) return true;
  const tries = opts.tries ?? 6;
  for (let i = 0; i < tries; i++) {
    const allowance = (await client.readContract({ address: opts.token, abi: erc20Abi, functionName: 'allowance', args: [opts.owner, opts.spender] }).catch(() => 0n)) as bigint;
    if (allowance >= opts.amount) return true;
    if (i < tries - 1) await sleep(opts.waitMs ?? 700);
  }
  return false;
}
