/**
 * Turning what a profile shows into a plain verdict. Deliberately simple and explainable: every point on the card is a fact
 * read from the profile, and a verdict is only a count of good and worrying facts — never a claim that someone is honest or
 * a fraud. A public profile cannot prove that a seller delivers, and the card says so.
 *
 * Pure: `now` is passed in.
 */
import type { IgCandidate, IgProfile, LiPerson } from './read';
import type { ResearchItem, ResearchKind, Signal, Verdict } from './types';

export function compact(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (n >= 1e4) return `${Math.round(n / 1e3)}K`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return String(Math.round(n));
}

/** "today", "3 days ago", "2 months ago". */
export function agoText(at: Date, now: Date): string {
  const days = Math.max(0, Math.floor((now.getTime() - at.getTime()) / 86_400_000));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 45) return `${days} days ago`;
  const months = Math.round(days / 30);
  return months < 24 ? `${months} months ago` : `${Math.round(days / 365)} years ago`;
}

const LABELS: Record<ResearchKind, Record<Verdict, string>> = {
  vendors: { solid: 'Looks solid', mixed: 'Mixed signals', careful: 'Be careful', unknown: 'Not checked' },
  hire: { solid: 'Strong match', mixed: 'Possible match', careful: 'Weak match', unknown: 'Not checked' },
};

export const verdictLabel = (kind: ResearchKind, v: Verdict) => LABELS[kind][v];

/** Best first. */
export const verdictRank = (v: Verdict) => ({ solid: 0, mixed: 1, careful: 2, unknown: 3 })[v];

function decide(signals: readonly Signal[]): Verdict {
  const warns = signals.filter((s) => s.tone === 'warn').length;
  const goods = signals.filter((s) => s.tone === 'good').length;
  if (warns >= 2) return 'careful';
  if (warns === 1) return 'mixed';
  return goods >= 3 ? 'solid' : 'mixed';
}

const CONTACT = /(\+?\d[\d\s().-]{8,}\d|[\w.+-]+@[\w-]+\.[\w.]+|whats ?app|wa\.me|\bdm\b|\border\b|\bcall\b|\bbook\b)/i;

/** An Instagram account, from what its profile lookup showed. `profile` is null when the lookup couldn't be read. */
export function scoreInstagram(candidate: IgCandidate, profile: IgProfile | null, now: Date): ResearchItem {
  const handle = candidate.username;
  const base = { name: profile?.fullName ?? candidate.fullName ?? `@${handle}`, handle: `@${handle}`, url: `https://www.instagram.com/${handle}/`, headline: (profile?.bio ?? candidate.bio)?.slice(0, 140) ?? null };

  if (!profile) {
    const stats = candidate.followers !== null ? [`${compact(candidate.followers)} followers`] : [];
    return { ...base, verdict: 'unknown', verdictLabel: verdictLabel('vendors', 'unknown'), stats, signals: [{ tone: 'info', text: 'I didn’t look inside this account, so I can’t say how active or real it is.' }], checked: false };
  }

  const signals: Signal[] = [];
  const stats: string[] = [];
  const followers = profile.followers ?? candidate.followers;
  if (followers !== null) stats.push(`${compact(followers)} followers`);
  if (profile.posts !== null) stats.push(`${compact(profile.posts)} posts`);

  if (profile.isPrivate) signals.push({ tone: 'warn', text: 'Private account — you can’t see their posts or customers before paying.' });
  if (profile.verified) signals.push({ tone: 'good', text: 'Verified account.' });

  const dated = profile.recent.map((p) => p.at).filter((d): d is Date => d !== null).sort((a, b) => b.getTime() - a.getTime());
  if (dated.length) {
    const last = dated[0];
    const days = Math.floor((now.getTime() - last.getTime()) / 86_400_000);
    stats.push(`last post ${agoText(last, now)}`);
    if (days <= 30) signals.push({ tone: 'good', text: `Active — posted ${agoText(last, now)}.` });
    else if (days > 90) signals.push({ tone: 'warn', text: `Quiet — no new post for ${agoText(last, now).replace(' ago', '')}.` });
  } else if (!profile.isPrivate) {
    signals.push({ tone: 'info', text: 'I couldn’t see when they last posted.' });
  }

  if (profile.posts !== null) {
    if (profile.posts >= 30) signals.push({ tone: 'good', text: `${compact(profile.posts)} posts — an established page.` });
    else if (profile.posts < 6) signals.push({ tone: 'warn', text: `Only ${profile.posts} post${profile.posts === 1 ? '' : 's'} — very new or thin.` });
  }

  const liked = profile.recent.filter((p) => p.likes !== null);
  if (followers !== null && followers >= 2000 && liked.length >= 3) {
    const avg = liked.reduce((sum, p) => sum + (p.likes ?? 0) + (p.comments ?? 0), 0) / liked.length;
    const rate = avg / followers;
    if (rate < 0.002) signals.push({ tone: 'warn', text: `Few likes for ${compact(followers)} followers — the following may be inflated.` });
    else if (rate >= 0.01) signals.push({ tone: 'good', text: 'Real engagement — people like and comment on the posts.' });
  } else if (followers !== null && followers < 100 && (profile.posts ?? 0) < 10) {
    signals.push({ tone: 'warn', text: 'Very small and new — little to go on.' });
  }

  if (profile.business || profile.category) signals.push({ tone: 'good', text: `Set up as a business${profile.category ? ` (${profile.category})` : ''}.` });
  if (profile.bio && CONTACT.test(profile.bio)) signals.push({ tone: 'good', text: 'Contact or ordering details in the bio.' });
  if (followers !== null && profile.following !== null && followers < 1000 && profile.following > followers * 5) {
    signals.push({ tone: 'info', text: 'Follows far more accounts than follow them.' });
  }

  const verdict = decide(signals);
  return { ...base, verdict, verdictLabel: verdictLabel('vendors', verdict), stats, signals, checked: true };
}

const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !['and', 'the', 'for', 'with', 'who', 'sells', 'selling'].includes(w))
    .map((w) => (w.length > 4 ? w.replace(/(?:es|s)$/, '') : w)); // "designers" matches "designer"

/** A LinkedIn person, against what was asked for and where. */
export function scoreLinkedIn(p: LiPerson, ask: { what: string; place: string }): ResearchItem {
  const signals: Signal[] = [];
  const stats: string[] = [];
  const haystack = `${p.headline ?? ''} ${p.about ?? ''} ${p.currentRole ?? ''}`.toLowerCase();
  const wanted = words(ask.what);
  const hits = wanted.filter((w) => haystack.includes(w));

  if (wanted.length) {
    if (hits.length) signals.push({ tone: 'good', text: `Profile mentions ${hits.slice(0, 3).join(', ')}.` });
    else signals.push({ tone: 'warn', text: `Nothing in the profile says “${ask.what}”.` });
  }
  if (ask.place) {
    const loc = (p.location ?? '').toLowerCase();
    const placeWords = words(ask.place);
    if (loc && placeWords.some((w) => loc.includes(w))) signals.push({ tone: 'good', text: `Based in ${p.location}.` });
    else if (loc) signals.push({ tone: 'info', text: `Based in ${p.location}, not ${ask.place}.` });
  }
  if (p.location) stats.push(p.location);
  if (p.connections !== null) {
    stats.push(`${p.connections >= 500 ? '500+' : compact(p.connections)} connections`);
    if (p.connections >= 500) signals.push({ tone: 'good', text: 'Well connected (500+).' });
    else if (p.connections < 50) signals.push({ tone: 'warn', text: 'Very few connections — a thin or new profile.' });
  } else if (p.followers !== null) {
    stats.push(`${compact(p.followers)} followers`);
  }
  if (p.about && p.about.length > 60) signals.push({ tone: 'good', text: 'Has a written summary of their work.' });
  if (p.experienceCount !== null) {
    if (p.experienceCount >= 2) signals.push({ tone: 'good', text: `${p.experienceCount} past roles listed.` });
    else if (p.experienceCount === 0) signals.push({ tone: 'warn', text: 'No work history listed.' });
  }

  const verdict = decide(signals);
  return { name: p.name, handle: null, url: p.url, headline: p.headline?.slice(0, 140) ?? null, verdict, verdictLabel: verdictLabel('hire', verdict), stats, signals, checked: true };
}
