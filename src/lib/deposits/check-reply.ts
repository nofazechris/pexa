/**
 * The answer to "did my deposit arrive?": built only from facts read from the chain and from Relay's own status, never guessed.
 * Pure, so every branch is tested.
 */

export type BridgeState = 'waiting' | 'processing' | 'done' | 'problem' | 'unknown';

/** Relay's status words → what they mean to the person. */
export function mapRelayStatus(status: string | null | undefined): BridgeState {
  switch ((status ?? '').toLowerCase()) {
    case 'waiting':
    case 'pending_deposit':
      return 'waiting';
    case 'depositing':
    case 'pending':
    case 'submitted':
    case 'delayed':
    case 'processing':
      return 'processing';
    case 'success':
    case 'completed':
      return 'done';
    case 'failure':
    case 'failed':
    case 'refunded':
    case 'refund':
      return 'problem';
    default:
      return 'unknown';
  }
}

export interface DepositFact {
  amount: string;
  token: string;
  /** ISO time the money arrived on Celo. */
  at: string;
}

export interface BridgeFact {
  chain: string;
  state: BridgeState;
}

export interface CheckFacts {
  recent: DepositFact[];
  bridges: BridgeFact[];
  /** Human USDC balance on Celo right now, or null if it couldn't be read. */
  balance: string | null;
  now: number;
}

/** How long ago, in words. */
export function agoWords(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

/** A deposit this recent is the one the person is most likely asking about. */
export const FRESH_DEPOSIT_MS = 45 * 60_000;

const money = (v: string) => Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const list = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? '') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);

export function composeDepositCheck(f: CheckFacts): string {
  const latest = f.recent[0];
  const age = latest ? f.now - new Date(latest.at).getTime() : Infinity;
  const bal = f.balance !== null ? ` Your balance is now $${money(f.balance)} USDC.` : '';

  if (latest && age <= FRESH_DEPOSIT_MS) {
    return `Yes — your deposit arrived: $${money(latest.amount)} ${latest.token}, ${agoWords(age)}.${bal}`;
  }

  const processing = f.bridges.filter((b) => b.state === 'processing').map((b) => b.chain);
  if (processing.length) {
    return `I can see your deposit on ${list(processing)} — it’s being converted into USDC on Celo and should land within a minute or two. Ask me to check again in a moment.`;
  }

  const problems = f.bridges.filter((b) => b.state === 'problem').map((b) => b.chain);
  if (problems.length) {
    return `Relay reports a problem with a transfer on ${list(problems)}. Your money isn’t lost — a transfer that can’t complete is returned to the wallet it was sent from. Tell me the amount and the network and I’ll look closer.`;
  }

  const waiting = f.bridges.filter((b) => b.state === 'waiting').map((b) => b.chain);
  const older = latest ? ` Your last deposit was $${money(latest.amount)} ${latest.token}, ${agoWords(age)}.` : '';
  const where = waiting.length ? ` Relay is still waiting for a deposit on ${list(waiting)}.` : '';
  return `Not yet — I don’t see a new deposit on Celo.${where}${older} A transfer from another network usually lands a minute or two after that network confirms it. If you sent it just now, ask me to check again; if it’s been a while, make sure you sent USDC (not another token) on the same network as the address I gave you.`;
}
