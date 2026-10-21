/**
 * Watching a pool: remember what it looked like, and say — in plain words — when something that matters changes. Every number
 * comes from the public pool data; nothing is predicted. Pure.
 *
 * What counts as worth telling someone, measured against the last values we told them about (or the values when they added it):
 *   - what the pool pays steadily moved a lot, up or down;
 *   - the temporary rewards ended, or new ones started;
 *   - the money in the pool fell sharply (people leaving is a warning sign);
 *   - the pool reached the rate they said they wanted;
 *   - the pool vanished from the data.
 */

export interface Snapshot {
  /** What it pays steadily (base interest or fees), percent. */
  apyBase: number;
  /** Temporary rewards, percent. */
  apyReward: number;
  tvlUsd: number;
}

export type AlertKind = 'rate_up' | 'rate_down' | 'rewards_ended' | 'rewards_started' | 'tvl_drop' | 'target_hit' | 'gone';

export interface WatchAlert {
  kind: AlertKind;
  title: string;
  detail: string;
}

export const ALERT_COOLDOWN_MS = 24 * 3600_000;
export const MAX_WATCHES = 20;

const pct = (n: number) => `${n >= 10 ? n.toFixed(1) : n.toFixed(2)}%`;
const usd = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}K`);

export function detectChanges(ref: Snapshot, now: Snapshot | null, opts: { label: string; targetApy?: number | null }): WatchAlert[] {
  const { label } = opts;
  if (now === null) {
    return [{ kind: 'gone', title: `${label} is no longer in the data`, detail: 'The data source stopped listing this pool. It may have closed or changed; check before relying on it.' }];
  }
  const out: WatchAlert[] = [];

  if (now.apyBase >= ref.apyBase + 1 && now.apyBase >= ref.apyBase * 1.3) {
    out.push({ kind: 'rate_up', title: `${label}: steady rate rose to ${pct(now.apyBase)}`, detail: `It was ${pct(ref.apyBase)} when I last told you. This is what the pool pays without rewards.` });
  } else if (now.apyBase <= ref.apyBase - 1 && now.apyBase <= ref.apyBase * 0.7) {
    out.push({ kind: 'rate_down', title: `${label}: steady rate fell to ${pct(now.apyBase)}`, detail: `It was ${pct(ref.apyBase)} when I last told you.` });
  }

  if (ref.apyReward >= 1 && now.apyReward <= ref.apyReward * 0.2) {
    out.push({ kind: 'rewards_ended', title: `${label}: temporary rewards ${now.apyReward <= 0.05 ? 'ended' : 'dropped'}`, detail: `Rewards went from ${pct(ref.apyReward)} to ${pct(now.apyReward)}, so the headline rate fell from about ${pct(ref.apyBase + ref.apyReward)} to ${pct(now.apyBase + now.apyReward)}.` });
  } else if (ref.apyReward < 0.5 && now.apyReward >= 2) {
    out.push({ kind: 'rewards_started', title: `${label}: new temporary rewards of ${pct(now.apyReward)}`, detail: `On top of ${pct(now.apyBase)} paid steadily. Rewards can end at any time.` });
  }

  if (ref.tvlUsd > 0 && now.tvlUsd <= ref.tvlUsd * 0.7) {
    out.push({ kind: 'tvl_drop', title: `${label}: money in the pool fell ${Math.round((1 - now.tvlUsd / ref.tvlUsd) * 100)}%`, detail: `From ${usd(ref.tvlUsd)} to ${usd(now.tvlUsd)}. People leaving a pool quickly is worth a look.` });
  }

  const target = opts.targetApy;
  if (typeof target === 'number' && target > 0 && now.apyBase >= target && ref.apyBase < target) {
    out.push({ kind: 'target_hit', title: `${label} now pays ${pct(now.apyBase)} steadily`, detail: `That is above the ${pct(target)} you asked me to watch for. Rates change daily, so check it before you act.` });
  }
  return out;
}

/** "since you added it": a short plain-words comparison of now against the baseline. */
export function sinceText(baseline: Snapshot, now: Snapshot | null): string {
  if (now === null) return 'no longer in the data';
  const d = now.apyBase - baseline.apyBase;
  const rate = Math.abs(d) < 0.05 ? `steady rate unchanged at ${pct(now.apyBase)}` : `steady rate ${d > 0 ? 'up' : 'down'} from ${pct(baseline.apyBase)} to ${pct(now.apyBase)}`;
  const t = baseline.tvlUsd > 0 ? Math.round((now.tvlUsd / baseline.tvlUsd - 1) * 100) : 0;
  const money = Math.abs(t) < 5 ? 'deposits about the same' : `deposits ${t > 0 ? 'up' : 'down'} ${Math.abs(t)}%`;
  return `${rate}; ${money}`;
}

/** Of the alerts, drop any kind already sent for this watch inside the cooldown. */
export function withoutRecent<T extends { kind: string }>(alerts: readonly T[], recent: readonly { kind: string; at: Date }[], now: Date): T[] {
  return alerts.filter((a) => !recent.some((r) => r.kind === a.kind && now.getTime() - r.at.getTime() < ALERT_COOLDOWN_MS));
}
