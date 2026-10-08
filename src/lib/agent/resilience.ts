/**
 * Keeping the agent useful when its AI provider is slow or down.
 *
 * The AI stays the brain for everything: it is always asked first. These helpers only decide what happens when it can't
 * answer — try a backup model, stop hammering a provider that is clearly down, and still answer the basics (balance,
 * recent payments, your wallet address) straight from the app so a bad day at the provider is never a dead app.
 */

/** Models to try, in order, without repeats: the one picked for this conversation, the normal one, then the backup. */
export function modelChain(...models: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of models) {
    if (m && !seen.has(m)) {
      seen.add(m);
      out.push(m);
    }
  }
  return out;
}

/**
 * Remembers "the AI provider is down" for a short while so every message doesn't wait out the full timeouts again.
 * Opens after a whole chain of models has failed; closes by itself after `holdMs`, or the moment anything succeeds.
 */
export class AiBreaker {
  private openUntil = 0;
  constructor(private readonly holdMs = 30_000) {}
  isOpen(now: number): boolean {
    return now < this.openUntil;
  }
  recordFailure(now: number): void {
    this.openUntil = now + this.holdMs;
  }
  recordSuccess(): void {
    this.openUntil = 0;
  }
}

/** Shared by everything on this server (the agent, the health check). */
export const aiBreaker = new AiBreaker(30_000);

export type FastLane = 'balance' | 'recent' | 'receive';

/** The few things the app can answer without the AI (used only when the AI can't). */
export function fastLane(text: string): FastLane | null {
  const t = text.trim().toLowerCase();
  if (!t || t.length > 140) return null;
  if (/\b(add money|deposit|fund my|top[- ]?up|receive (some )?(money|usdc)|my (wallet )?address|where (do|can) i (send|deposit)|wallet address)\b/.test(t)) return 'receive';
  if (/\b(recent|latest|last)\b.*\b(payments?|transactions?|activity|transfers?)\b|\b(transaction|payment) history\b|\bmy activity\b|\bwhat did i (spend|send|pay)\b/.test(t)) return 'recent';
  if (/\b(balance|how much (money |usdc |cash )?(do i have|have i got|is in my)|what do i have|my funds)\b/.test(t)) return 'balance';
  return null;
}

const money = (v: string | number) => Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatBalanceReply(b: { balance: string; available: string; savedInVaults: string }): string {
  const saved = Number(b.savedInVaults);
  return saved > 0
    ? `You have $${money(b.available)} USDC available ($${money(b.balance)} in total, $${money(saved)} set aside in your vaults).`
    : `Your balance is $${money(b.balance)} USDC.`;
}

export interface RecentRow {
  direction: 'in' | 'out';
  counterparty: string;
  amount: string;
  status: string;
  createdAt: Date | string;
}

export function formatRecentReply(rows: RecentRow[], max = 5): string {
  if (!rows.length) return 'You haven’t had any payments yet.';
  const lines = rows.slice(0, max).map((r) => {
    const when = new Date(r.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const state = r.status === 'CONFIRMED' ? '' : ` (${r.status.toLowerCase()})`;
    return `• ${r.direction === 'out' ? 'Sent' : 'Received'} $${money(r.amount)} ${r.direction === 'out' ? 'to' : 'from'} ${r.counterparty} — ${when}${state}`;
  });
  return `Your most recent payments:\n${lines.join('\n')}`;
}

/** Said when the AI can't answer and the message isn't one of the basics. */
export const AI_DOWN_REPLY =
  'My AI side isn’t responding right now, so I can only do the basics until it’s back: your balance, recent payments, your wallet address, or a payment to a @username. Try one of those, or ask me again in a minute.';
