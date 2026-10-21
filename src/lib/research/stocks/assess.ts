import type { Heat } from './heat';
import type { PriceStats } from './prices';
import type { InvestorProfile } from '@/lib/profile/investor';

/**
 * What the evidence says about a ticker, in plain words, with nothing recommended. Each flag is a fact from the posts or the prices;
 * together they show whether the talk and the price agree, whether the move has already happened, and how bumpy the ride has been.
 * The person's own profile adds one line about how that sits with what they said they can take. Pure.
 */

export type FlagTone = 'good' | 'warn' | 'info';
export interface Flag {
  tone: FlagTone;
  text: string;
}

export interface StockAssessment {
  /** A short neutral label for the pattern, never a recommendation. */
  pattern: 'attention and momentum' | 'attention without price follow-through' | 'already ran hard' | 'looks coordinated' | 'thin evidence';
  flags: Flag[];
  /** How this sits with the person's stated profile, or null when they have none. */
  fit: string | null;
}

const pct = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;

export function assessStock(h: Heat, price: PriceStats | null, profile: InvestorProfile | null): StockAssessment {
  const flags: Flag[] = [];

  flags.push({ tone: 'info', text: `${h.authors} different people posted about it (${h.posts} posts${h.platforms.length > 1 ? ', on X and Reddit' : h.platforms[0] === 'x' ? ', on X' : ', on Reddit'})` });
  if (h.newestDays !== null) flags.push({ tone: 'info', text: h.newestDays < 1 ? 'The newest post is from today' : `The newest post is ${Math.round(h.newestDays)} day${Math.round(h.newestDays) === 1 ? '' : 's'} old` });

  const coordinated = h.copyShare > 0.4 || (h.tinyShare !== null && h.tinyShare > 0.6);
  if (h.copyShare > 0.4) flags.push({ tone: 'warn', text: `${Math.round(h.copyShare * 100)}% of the posts were copies of each other — a sign of promotion` });
  if (h.tinyShare !== null && h.tinyShare > 0.6) flags.push({ tone: 'warn', text: 'Most X posts came from very small accounts (under 200 followers)' });

  let ran = false;
  let noFollow = false;
  if (price) {
    const bits = [price.ret1w !== null ? `${pct(price.ret1w)} this week` : null, price.ret1m !== null ? `${pct(price.ret1m)} this month` : null, price.ret3m !== null ? `${pct(price.ret3m)} over 3 months` : null].filter(Boolean);
    if (bits.length) flags.push({ tone: price.ret1m !== null && price.ret1m < 0 ? 'warn' : 'info', text: `Price: ${bits.join(', ')}` });
    if (price.ret1m !== null && price.ret1m >= 40) {
      ran = true;
      flags.push({ tone: 'warn', text: `Already up ${price.ret1m.toFixed(0)}% this month — much of the move may have happened before the talk` });
    }
    if (price.ret1m !== null && price.ret1m < 0 && h.authors >= 5) {
      noFollow = true;
      flags.push({ tone: 'warn', text: `Lots of talk, but the price is down ${Math.abs(price.ret1m).toFixed(1)}% this month` });
    }
    if (price.vol !== null && price.vol >= 60) flags.push({ tone: 'warn', text: `Very bumpy: its price swings about ${price.vol.toFixed(0)}% a year` });
    if (price.drawdown3m !== null && price.drawdown3m >= 25) flags.push({ tone: 'warn', text: `It fell as much as ${price.drawdown3m.toFixed(0)}% from a recent peak` });
    if (price.last < 5) flags.push({ tone: 'warn', text: `Low-priced (about $${price.last.toFixed(2)}): such stocks swing hard and are a favourite of pump schemes` });
  } else {
    flags.push({ tone: 'warn', text: 'I couldn’t get price data for it, so I can’t say whether the talk matches the price' });
  }

  const pattern: StockAssessment['pattern'] = coordinated ? 'looks coordinated' : ran ? 'already ran hard' : noFollow ? 'attention without price follow-through' : price && price.ret1m !== null && price.ret1m > 0 && h.authors >= 4 ? 'attention and momentum' : 'thin evidence';

  let fit: string | null = null;
  if (profile && !profile.skipped) {
    const wild = (price?.vol ?? 0) >= 45 || (price?.last ?? 99) < 5 || ran;
    if (profile.risk === 'cautious' && wild) fit = 'More volatile than a “play it safe” profile usually wants.';
    else if (profile.risk === 'cautious') fit = 'Even calmer stocks can fall; for a cautious profile, size it small.';
    else if (profile.risk === 'bold' && coordinated) fit = 'Even a bold profile should treat promoted tickers with care.';
    else if (profile.horizon === 'short' && wild) fit = 'Short time frame plus big swings: a bad month could land right when you need the money.';
  }
  return { pattern, flags, fit };
}
