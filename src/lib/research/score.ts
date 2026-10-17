/**
 * Turning what a profile shows into a plain verdict. Deliberately simple and explainable: every point on the card is a fact
 * read from the profile, and a verdict is only a count of good and worrying facts — never a claim that someone is honest or
 * a fraud. A public profile cannot prove that a seller delivers, and the card says so.
 *
 * Pure: `now` is passed in.
 */
import { nearness as nearnessOf, placeParts, type Nearness } from '@/lib/geo/place';
import { NO_CONTACT, type Contact, type IgCandidate, type IgProfile, type LiPerson, type XPerson } from './read';
import { currencyForPlace, extractPrices, rangeText, summarize, type PricePoint } from './price';
import { fitScore, initialRating, trustScore } from './rate';
import type { ItemPrices, ResearchItem, ResearchKind, Signal, Verdict } from './types';

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

/** Words that mean something in a request ("designers" → "designer"). */
const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !['and', 'the', 'for', 'with', 'who', 'sells', 'selling'].includes(w))
    .map((w) => (w.length > 4 ? w.replace(/(?:es|s)$/, '') : w));

/** The prices found in some text, summarised (null when there are none). */
export function itemPrices(points: readonly PricePoint[], matched: boolean): ItemPrices | null {
  const s = summarize(points);
  if (!s) return null;
  return { currency: s.currency, low: s.low, median: s.median, high: s.high, n: s.n, points: points.filter((p) => p.currency === s.currency).map((p) => p.amount).slice(0, 24), matched, text: rangeText(s), vsMarket: null };
}

/** How many of the words asked for appear in the text. */
function wordHits(text: string, what: string): { hits: number; wanted: number } {
  const wanted = words(what);
  const hay = text.toLowerCase();
  return { hits: wanted.filter((w) => hay.includes(w)).length, wanted: wanted.length };
}

// --- where they are ------------------------------------------------------------------------------------------

interface Where {
  location: string | null;
  nearness: Nearness;
  signals: Signal[];
}

/**
 * Where someone is, by name: the place they wrote down if they wrote one, otherwise whether their bio mentions the person's
 * area or city. Distance comes later (it needs a lookup); this part only compares names.
 */
export function whereIs(explicit: string | null, bio: string | null, place: string): Where {
  const city = placeParts(place).slice(-1)[0] ?? place;
  if (explicit) {
    const n = nearnessOf(explicit, place);
    const text = n === 'area' ? `Based in ${explicit} — your area.` : n === 'city' ? `Based in ${explicit}.` : `Based in ${explicit}, not ${city}.`;
    return { location: explicit, nearness: n, signals: [{ tone: 'info', text }] };
  }
  const fromBio = nearnessOf(bio, place);
  if (fromBio === 'area' || fromBio === 'city') {
    return { location: null, nearness: fromBio, signals: [{ tone: 'info', text: `Bio mentions ${fromBio === 'area' ? 'your area' : city}.` }] };
  }
  return { location: null, nearness: 'unknown', signals: [{ tone: 'info', text: 'No location on the profile — ask where they are.' }] };
}

const asContact = (c: Contact | undefined) => c ?? NO_CONTACT;

// --- Instagram -----------------------------------------------------------------------------------------------

/** An Instagram account, from what its profile lookup showed. `profile` is null when the lookup couldn't be read. */
export function scoreInstagram(candidate: IgCandidate, profile: IgProfile | null, now: Date, place = '', what = ''): ResearchItem {
  const handle = candidate.username;
  const base = {
    platform: 'instagram' as const,
    name: profile?.fullName ?? candidate.fullName ?? `@${handle}`,
    handle: `@${handle}`,
    url: `https://www.instagram.com/${handle}/`,
    headline: (profile?.bio ?? candidate.bio)?.slice(0, 140) ?? null,
  };

  if (!profile) {
    const stats = candidate.followers !== null ? [`${compact(candidate.followers)} followers`] : [];
    return { ...base, verdict: 'unknown', verdictLabel: verdictLabel('vendors', 'unknown'), location: null, nearness: 'unknown', distanceKm: null, contact: NO_CONTACT, stats, signals: [{ tone: 'info', text: 'I didn’t look inside this account, so I can’t say how active or real it is.' }], checked: false, rating: null, prices: null, negotiation: null };
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
  const contact = asContact(profile.contact);
  if (contact.phone || contact.email || (profile.bio && CONTACT.test(profile.bio))) signals.push({ tone: 'good', text: 'Contact or ordering details are published.' });
  if (followers !== null && profile.following !== null && followers < 1000 && profile.following > followers * 5) {
    signals.push({ tone: 'info', text: 'Follows far more accounts than follow them.' });
  }

  const verdict = decide(signals); // location notes are information only: they never change the verdict
  const where = whereIs(profile.location, profile.bio ?? candidate.bio, place);
  const captions = profile.recent.map((p) => p.caption).filter((c): c is string => Boolean(c));
  // Prices in posts that name what was asked for are comparable between sellers; a seller's other items (slides next to sneakers) are not.
  const cur = currencyForPlace(place);
  const wantedWords = words(what);
  const fromCaptions = captions.map((c) => ({ pts: extractPrices(c, cur), hit: wantedWords.length > 0 && wantedWords.some((w) => c.toLowerCase().includes(w)) }));
  const matchedPts = fromCaptions.filter((c) => c.hit).flatMap((c) => c.pts);
  const allPts = [...fromCaptions.flatMap((c) => c.pts), ...extractPrices(profile.bio, cur)];
  const prices = itemPrices(matchedPts.length ? matchedPts : allPts, matchedPts.length > 0);
  const { hits, wanted } = wordHits(`${handle} ${profile.fullName ?? candidate.fullName ?? ''} ${profile.bio ?? ''} ${profile.category ?? ''} ${captions.join(' ')}`, what);
  return { ...base, verdict, verdictLabel: verdictLabel('vendors', verdict), location: where.location, nearness: where.nearness, distanceKm: null, contact, stats, signals: [...signals, ...where.signals], checked: true, rating: initialRating(trustScore(signals), fitScore(hits, wanted)), prices, negotiation: null };
}

// --- X -------------------------------------------------------------------------------------------------------

/** An X account, from what the people search showed (it carries the profile, so no extra lookup is needed). */
export function scoreX(p: XPerson, ask: { what: string; place: string }, kind: ResearchKind, now: Date): ResearchItem {
  const signals: Signal[] = [];
  const stats: string[] = [];
  if (p.followers !== null) stats.push(`${compact(p.followers)} followers`);
  if (p.posts !== null) stats.push(`${compact(p.posts)} posts`);
  if (p.joined) stats.push(`on X since ${p.joined.getUTCFullYear()}`);

  const wanted = words(ask.what);
  const hay = `${p.bio ?? ''} ${p.name ?? ''}`.toLowerCase();
  const hits = wanted.filter((w) => hay.includes(w));
  if (wanted.length) {
    if (hits.length) signals.push({ tone: 'good', text: `Bio mentions ${hits.slice(0, 3).join(', ')}.` });
    else signals.push({ tone: 'info', text: `Bio doesn’t say “${ask.what}”.` });
  }
  if (p.verified) signals.push({ tone: 'good', text: 'Verified account.' });
  if (p.joined) {
    const days = Math.floor((now.getTime() - p.joined.getTime()) / 86_400_000);
    if (days >= 365) signals.push({ tone: 'good', text: `Account is ${Math.floor(days / 365)}+ year${days >= 730 ? 's' : ''} old.` });
    else if (days < 90) signals.push({ tone: 'warn', text: 'Brand-new account.' });
  }
  if (p.posts !== null) {
    if (p.posts >= 200) signals.push({ tone: 'good', text: `${compact(p.posts)} posts — actively used.` });
    else if (p.posts < 10) signals.push({ tone: 'warn', text: `Only ${p.posts} post${p.posts === 1 ? '' : 's'}.` });
  }
  if (p.followers !== null && p.followers < 20) signals.push({ tone: 'warn', text: 'Hardly any followers.' });
  else if (p.followers !== null && p.followers >= 1000) signals.push({ tone: 'good', text: `${compact(p.followers)} followers.` });
  if (p.contact.phone || p.contact.email) signals.push({ tone: 'good', text: 'Contact details are published.' });

  const verdict = decide(signals);
  const where = whereIs(p.location, p.bio, ask.place);
  return {
    platform: 'x',
    name: p.name ?? `@${p.username}`,
    handle: `@${p.username}`,
    url: `https://x.com/${p.username}`,
    headline: p.bio?.slice(0, 140) ?? null,
    verdict,
    verdictLabel: verdictLabel(kind, verdict),
    location: where.location,
    nearness: where.nearness,
    distanceKm: null,
    contact: p.contact,
    stats,
    signals: [...signals, ...where.signals],
    checked: true,
    rating: initialRating(trustScore(signals), fitScore(hits.length, wanted.length)),
    prices: itemPrices(extractPrices(p.bio, currencyForPlace(ask.place)), wanted.length > 0 && hits.length > 0),
    negotiation: null,
  };
}

// --- LinkedIn ------------------------------------------------------------------------------------------------

/** A LinkedIn person, against what was asked for and where. */
export function scoreLinkedIn(p: LiPerson, ask: { what: string; place: string }, now: Date = new Date()): ResearchItem {
  const signals: Signal[] = [];
  const stats: string[] = [];
  const haystack = `${p.headline ?? ''} ${p.about ?? ''} ${p.currentRole ?? ''} ${p.services.join(' ')} ${p.skills.join(' ')}`.toLowerCase();
  const wanted = words(ask.what);
  const hits = wanted.filter((w) => haystack.includes(w));

  if (wanted.length) {
    if (hits.length) signals.push({ tone: 'good', text: `Profile mentions ${hits.slice(0, 3).join(', ')}.` });
    else signals.push({ tone: 'warn', text: `Nothing in the profile says “${ask.what}”.` });
  }
  const near = nearnessOf(p.location, ask.place);
  if (near === 'area' || near === 'city') signals.push({ tone: 'good', text: `Based in ${p.location}.` });
  else if (p.location) signals.push({ tone: 'info', text: `Based in ${p.location}, not ${placeParts(ask.place).slice(-1)[0] ?? ask.place}.` });
  if (p.location) stats.push(p.location);
  if (p.connections !== null) {
    stats.push(`${p.connections >= 500 ? '500+' : compact(p.connections)} connections`);
    if (p.connections >= 500) signals.push({ tone: 'good', text: 'Well connected (500+).' });
    else if (p.connections < 50) signals.push({ tone: 'warn', text: 'Very few connections — a thin or new profile.' });
  } else if (p.followers !== null) {
    stats.push(`${compact(p.followers)} followers`);
  }
  if (p.about && p.about.length > 60) signals.push({ tone: 'good', text: 'Has a written summary of their work.' });
  if (p.verified) signals.push({ tone: 'good', text: 'Verified profile.' });
  if (p.joined) {
    const years = (now.getTime() - p.joined.getTime()) / (365 * 86_400_000);
    if (years >= 2) signals.push({ tone: 'good', text: `On LinkedIn since ${p.joined.getUTCFullYear()}.` });
    else if (years < 0.5) signals.push({ tone: 'warn', text: 'Brand-new profile.' });
  }
  if (p.recommendations !== null && p.recommendations > 0) signals.push({ tone: 'good', text: `${p.recommendations} recommendation${p.recommendations === 1 ? '' : 's'} from colleagues or clients.` });
  if (p.services.length) signals.push({ tone: 'info', text: `Offers: ${p.services.slice(0, 4).join(', ')}.` });
  if (p.openToWork) signals.push({ tone: 'good', text: 'Open to work — likely available.' });
  if (p.experienceCount !== null) {
    if (p.experienceCount >= 2) signals.push({ tone: 'good', text: `${p.experienceCount} past roles listed.` });
    else if (p.experienceCount === 0) signals.push({ tone: 'warn', text: 'No work history listed.' });
  }

  const verdict = decide(signals);
  return {
    platform: 'linkedin',
    name: p.name,
    handle: null,
    url: p.url,
    headline: p.headline?.slice(0, 140) ?? null,
    verdict,
    verdictLabel: verdictLabel('hire', verdict),
    location: p.location,
    nearness: near,
    distanceKm: null,
    contact: NO_CONTACT,
    stats,
    signals,
    checked: true,
    rating: initialRating(trustScore(signals), fitScore(hits.length, wanted.length)),
    prices: null,
    negotiation: null,
  };
}

// --- ordering ------------------------------------------------------------------------------------------------

/** How near, as one number: a measured distance if there is one, else a guess from names alone. Unknown places sort last. */
function proximity(i: ResearchItem): number {
  if (i.distanceKm !== null) return i.distanceKm;
  return { area: 2, city: 15, unknown: 9_000, other: 5_000 }[i.nearness];
}

/**
 * Best first. Anything that doesn't look worrying (solid or mixed) comes before anything that does, and unchecked accounts come
 * last. Among the decent ones the closest wins: same neighbourhood or a few km, then the wider city, then farther or unknown —
 * and within each of those, the stronger verdict, then the shorter distance.
 */
export function rankItems(items: readonly ResearchItem[]): ResearchItem[] {
  const tier = (i: ResearchItem) => (i.verdict === 'careful' ? 1 : i.verdict === 'unknown' ? 2 : 0);
  const bucket = (i: ResearchItem) => {
    const d = proximity(i);
    return d < 6 ? 0 : d < 30 ? 1 : 2;
  };
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => tier(a.item) - tier(b.item) || bucket(a.item) - bucket(b.item) || verdictRank(a.item.verdict) - verdictRank(b.item.verdict) || proximity(a.item) - proximity(b.item) || a.i - b.i)
    .map((x) => x.item);
}
