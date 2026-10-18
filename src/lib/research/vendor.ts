/**
 * Is this seller real, and do they sell what was asked for? Two separate questions, answered from facts on the profile.
 *
 * RELEVANCE decides whether an account is shown at all. A page that only cleans sneakers, repairs phones or teaches a course is
 * not a seller of sneakers or phones; a clothes seller who mentions sneakers as a styling tip is not a sneaker seller; an author whose
 * tweet merely mentions Lagos is not a vendor — those are left out and the result says so.
 *
 * TRUST decides how far to rely on one that is shown. Beyond counting good and worrying facts, RED FLAGS put a ceiling on the score
 * however much else looks fine: no posts, a tiny following, a brand-new account, a bio that says it replaces a disabled page, asking
 * for payment before delivery ("no payment on delivery"), a long silence. And "Established" needs real proof, not just the absence of
 * problems.
 *
 * Careful with what the data can't say: Instagram's profile lookup returns "0 posts" for plenty of big, verified accounts, so a count of
 * zero only counts against a page when nothing else vouches for it.
 *
 * None of this proves a seller delivers; the cards say so. Pure: `now` is passed in.
 */
import { paymentTerms, readText, sellsSomethingElse, themeFor } from './commerce';
import { currencyForPlace, extractPrices } from './price';
import { memoryEffect } from './learn';
import { fitScore, initialRating, trustScore } from './rate';
import type { IgCandidate, IgProfile } from './read';
import { NO_CONTACT } from './read';
import { agoText, compact, itemPrices, verdictLabel, whereIs, words } from './score';
import type { XSeller } from './sellers';
import type { ResearchItem, ResearchKind, Signal, Verdict, VendorMemoryView } from './types';

/** A red flag: what to tell the person, and the highest the trust score may go with it. Caps of 55+ are "soft" (they cost 10 points, not 20). */
interface Flag {
  text: string;
  cap: number;
}

/**
 * Trust → verdict for sellers. Below 55 is a risk. "Established" needs a score of 78+ AND real proof — verification, a real following, a
 * long posting history, or prices and a phone number in the ads — because a page with no problems we can see has still proved nothing.
 */
export function vendorVerdict(trust: number, strong: boolean): Verdict {
  return trust < 55 ? 'careful' : trust >= 78 && strong ? 'solid' : 'mixed';
}

const REPLACEMENT_BIO = /\b(?:old (?:account|page|handle)|new (?:account|page|handle)|(?:back ?up|second|main|previous|former) (?:account|page)|account (?:was )?(?:disabled|banned|hacked|suspended|deleted)|(?:disabled|banned|hacked|suspended|deleted) (?:account|page)|(?:we|i) (?:got|were|was) (?:banned|hacked|disabled))\b/i;
const RETAIL_CATEGORY = /\b(?:shop|store|retail|clothing|apparel|fashion|jewel|shoe|footwear|bag|electronic|boutique|brand|e-?commerce|product|merchant|market|gadget|phone|computer)/i;
const DAY = 86_400_000;

/** A name written as search words ("BAGS AND SNEAKERS IN YABA LAGOS"). Common for real Lagos shops, so only information — never a flag by itself. */
export function isKeywordStuffed(fullName: string | null | undefined, what: string, place: string): boolean {
  if (!fullName) return false;
  const theme = themeFor(what);
  const tokens = fullName.trim().split(/\s+/);
  const lower = fullName.toLowerCase();
  const productHits = (lower.match(new RegExp(theme.product.source, 'gi')) ?? []).length;
  const placeWords = place.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3);
  const placeHit = placeWords.some((w) => lower.includes(w));
  const shouting = fullName === fullName.toUpperCase() && /[A-Z]{3}/.test(fullName);
  return productHits >= 1 && placeHit && (tokens.length >= 5 || (shouting && tokens.length >= 4));
}

type SocialPlatform = 'instagram' | 'tiktok';

const profileUrl = (platform: SocialPlatform, handle: string) => (platform === 'instagram' ? `https://www.instagram.com/${handle}/` : `https://www.tiktok.com/@${handle}`);

/** An Instagram or TikTok account, from what its profile lookup showed. `profile` is null when the lookup couldn't be read. */
function scoreSocial(platform: SocialPlatform, candidate: IgCandidate, profile: IgProfile | null, now: Date, place: string, what: string, mem: VendorMemoryView | null): ResearchItem {
  const handle = candidate.username;
  const base = {
    platform,
    name: profile?.fullName ?? candidate.fullName ?? `@${handle}`,
    handle: `@${handle}`,
    url: profileUrl(platform, handle),
    headline: (profile?.bio ?? candidate.bio)?.slice(0, 140) ?? null,
  };

  if (!profile) {
    const stats = candidate.followers !== null ? [`${compact(candidate.followers)} followers`] : [];
    return { ...base, verdict: 'unknown', verdictLabel: verdictLabel('vendors', 'unknown'), location: null, nearness: 'unknown', distanceKm: null, contact: NO_CONTACT, stats, signals: [{ tone: 'info', text: 'I didn’t look inside this account, so I can’t say how active or real it is.' }], checked: false, rating: null, prices: null, negotiation: null, memory: null, relevance: 'match', skipReason: null };
  }

  const theme = themeFor(what || 'item');
  const captions = profile.recent.map((p) => p.caption).filter((c): c is string => Boolean(c));
  const bio = profile.bio ?? candidate.bio ?? '';
  const fullName = profile.fullName ?? candidate.fullName ?? '';
  const ownWords = `${bio} ${profile.category ?? ''} ${captions.join(' ')}`;
  const cur = currencyForPlace(place);

  // 1. Relevance — does this account sell what was asked for?
  const read = readText(`${ownWords} ${fullName}`, theme, cur);
  const adjacentWord = theme.adjacent.exec(ownWords)?.[0]?.toLowerCase() ?? null;
  const productInOwnWords = theme.product.test(ownWords);
  const productInName = theme.product.test(fullName) || theme.product.test(handle.replace(/[._]/g, ' '));
  const somethingElse = sellsSomethingElse(`${ownWords} ${fullName}`, theme);
  const relevance: ResearchItem['relevance'] = read.kind === 'adjacent' ? 'adjacent' : somethingElse ? 'unrelated' : productInOwnWords || productInName ? 'match' : 'unrelated';
  const skipReason = relevance === 'adjacent' ? `Looks like a ${adjacentWord ?? 'related'} service, not a seller of ${what}` : relevance === 'unrelated' ? (somethingElse ? `Sells something other than ${what}` : `Doesn’t mention ${what}`) : null;

  // 2. Trust — good and worrying facts, with red flags that put a ceiling on the score.
  const signals: Signal[] = [];
  const flags: Flag[] = [];
  const silentCaps: number[] = [];
  const stats: string[] = [];
  const flag = (f: Flag) => {
    flags.push(f);
    signals.push({ tone: 'warn', text: f.text });
  };

  const followers = profile.followers ?? candidate.followers;
  const verified = Boolean(profile.verified || profile.metaVerified);
  if (followers !== null) stats.push(`${compact(followers)} followers`);

  // Instagram's profile lookup often returns no posts for big accounts: zero only counts against a page that nothing else vouches for.
  const postsUnreadable = platform === 'instagram' && profile.posts === 0 && (verified || (followers ?? 0) >= 1000);
  const posts = postsUnreadable ? null : profile.posts;
  if (posts !== null) stats.push(`${compact(posts)} ${platform === 'tiktok' ? 'videos' : 'posts'}`);

  if (profile.isPrivate) flag({ text: 'Private account — you can’t see their posts or customers before paying.', cap: 50 });
  if (profile.verified) signals.push({ tone: 'good', text: 'Verified account.' });
  if (profile.metaVerified) signals.push({ tone: 'good', text: 'Meta Verified business.' });

  if (postsUnreadable) {
    signals.push({ tone: 'info', text: 'Instagram didn’t return their posts, so I can’t check how active they are.' });
    if (!verified) silentCaps.push(76);
  } else if (posts === 0) flag({ text: `No ${platform === 'tiktok' ? 'videos' : 'posts'} at all — nothing to show it has ever sold anything.`, cap: 30 });
  else if (posts !== null && posts < 6) flag({ text: `Only ${posts} ${platform === 'tiktok' ? 'video' : 'post'}${posts === 1 ? '' : 's'} — very new or thin.`, cap: 45 });
  else if (posts !== null && posts >= 30) signals.push({ tone: 'good', text: `${compact(posts)} ${platform === 'tiktok' ? 'videos' : 'posts'} — an established page.` });

  if (followers !== null) {
    if (followers < 100) flag({ text: `Fewer than 100 followers (${followers}) — too small to trust with your money.`, cap: 45 });
    else if (followers < 300) signals.push({ tone: 'info', text: 'Small following.' });
    else if (followers >= 1000) signals.push({ tone: 'good', text: `${compact(followers)} followers.` });
  }
  if (profile.joinedRecently) flag({ text: 'Instagram says this account was created recently.', cap: 60 });
  if (profile.createdAt) {
    const days = Math.floor((now.getTime() - profile.createdAt.getTime()) / DAY);
    stats.push(`on ${platform === 'tiktok' ? 'TikTok' : 'Instagram'} since ${profile.createdAt.getUTCFullYear()}`);
    if (days < 90) flag({ text: 'Account was created less than 3 months ago.', cap: 60 });
    else if (days < 365) flag({ text: 'Account is under a year old.', cap: 70 });
    else if (days >= 730) signals.push({ tone: 'good', text: `Account is ${Math.floor(days / 365)}+ years old.` });
  }

  const replacement = REPLACEMENT_BIO.exec(bio);
  if (replacement) {
    const established = (followers ?? 0) >= 1000 && (posts ?? 0) >= 30;
    flag(established ? { text: `Mentions an earlier account (“${replacement[0]}”) — ask what happened to it.`, cap: 74 } : { text: `Bio says this replaces an earlier account (“${replacement[0]}”) — pages that were shut down often come back this way.`, cap: 35 });
  }
  if (isKeywordStuffed(fullName, what, place)) signals.push({ tone: 'info', text: 'Name is written as search words (common for shops here, but anyone can do it).' });

  const terms = paymentTerms(`${bio} ${captions.join(' ')}`);
  if (terms.upfrontOnly) flag({ text: `States “${terms.upfrontOnly}” — asking for payment before delivery is a common scam pattern (it may be innocent, but pay on delivery where you can).`, cap: 70 });
  else if (terms.podOffered) signals.push({ tone: 'good', text: 'Offers pay on delivery — safer for you.' });

  const dated = profile.recent.map((p) => p.at).filter((d): d is Date => d !== null).sort((a, b) => b.getTime() - a.getTime());
  if (dated.length) {
    const last = dated[0];
    const days = Math.floor((now.getTime() - last.getTime()) / DAY);
    stats.push(`last post ${agoText(last, now)}`);
    if (days <= 30) signals.push({ tone: 'good', text: `Active — posted ${agoText(last, now)}.` });
    else if (days > 90) flag({ text: `Quiet — no new post for ${agoText(last, now).replace(' ago', '')}.`, cap: 60 });
  }

  const liked = profile.recent.filter((p) => p.likes !== null);
  if (followers !== null && followers >= 2000 && liked.length >= 3) {
    const avg = liked.reduce((sum, p) => sum + (p.likes ?? 0) + (p.comments ?? 0), 0) / liked.length;
    const rate = avg / followers;
    if (rate < 0.002) flag({ text: `Few likes for ${compact(followers)} followers — the following may be inflated.`, cap: 55 });
    else if (rate >= 0.01) signals.push({ tone: 'good', text: 'Real engagement — people like and comment on the posts.' });
  }

  if (profile.category && RETAIL_CATEGORY.test(profile.category)) signals.push({ tone: 'good', text: `Set up as a shop (${profile.category}).` });
  else if (profile.business) signals.push({ tone: 'good', text: 'Set up as a business.' });
  const contact = profile.contact;
  if (contact.phone || contact.email) signals.push({ tone: 'good', text: 'Phone or email published.' });
  if (read.selling) signals.push({ tone: 'good', text: `Shows how to buy (${read.evidence.join(', ') || 'selling language'}).` });
  else if (relevance === 'match') signals.push({ tone: 'info', text: 'Doesn’t say how to order or what things cost.' });
  if (followers !== null && profile.following !== null && followers < 1000 && profile.following > followers * 5) signals.push({ tone: 'info', text: 'Follows far more accounts than follow them.' });

  // What earlier searches and Pexa users have said about this account.
  const learned = memoryEffect(mem);
  signals.push(...learned.signals);
  learned.flags.forEach(flag);

  const where = whereIs(profile.location, bio, place);
  const cap = Math.min(100, ...flags.map((f) => f.cap), ...silentCaps);
  const trust = trustScore(signals, cap, flags.filter((f) => f.cap >= 55).length);
  const strong = Boolean(verified || ((followers ?? 0) >= 1000 && posts !== null) || (followers ?? 0) >= 5000 || (posts ?? 0) >= 30 || (contact.phone && read.selling));
  const verdict = vendorVerdict(trust, strong);

  // Prices: only posts that name what the person asked for are comparable between sellers.
  const wantedWords = words(what);
  // (the person's own words, not the whole category: slides are footwear, but their price says nothing about sneakers)
  const fromCaptions = captions.map((c) => ({ pts: extractPrices(c, cur), hit: wantedWords.length > 0 && wantedWords.some((w) => c.toLowerCase().includes(w)) }));
  const matchedPts = fromCaptions.filter((c) => c.hit).flatMap((c) => c.pts);
  const allPts = [...fromCaptions.flatMap((c) => c.pts), ...extractPrices(bio, cur)];
  const prices = itemPrices(matchedPts.length ? matchedPts : allPts, matchedPts.length > 0);

  // Fit: product words in the account's OWN words (bio, captions) count most; in its name, less.
  const fit = productInOwnWords ? (read.selling ? 95 : 75) : productInName ? 70 : 40;

  return {
    ...base,
    verdict,
    verdictLabel: verdictLabel('vendors', verdict),
    location: where.location,
    nearness: where.nearness,
    distanceKm: null,
    contact,
    stats,
    signals: [...signals, ...where.signals],
    checked: true,
    rating: initialRating(trust, fit),
    prices,
    negotiation: null,
    memory: mem,
    relevance,
    skipReason,
  };
}

/** An Instagram account, from what its profile lookup showed. */
export const scoreInstagram = (candidate: IgCandidate, profile: IgProfile | null, now: Date, place = '', what = '', mem: VendorMemoryView | null = null): ResearchItem => scoreSocial('instagram', candidate, profile, now, place, what, mem);

/** A TikTok account, from its search entry and profile lookup. */
export const scoreTikTok = (candidate: IgCandidate, profile: IgProfile | null, now: Date, place = '', what = '', mem: VendorMemoryView | null = null): ResearchItem => scoreSocial('tiktok', candidate, profile, now, place, what, mem);

/** An X author, judged from everything they posted in the results (their selling posts, prices, phone, payment terms, account age and size). */
export function scoreXSeller(s: XSeller, ask: { what: string; place: string }, kind: ResearchKind, now: Date, mem: VendorMemoryView | null = null): ResearchItem {
  const handle = `@${s.username}`;
  const relevance: ResearchItem['relevance'] = s.kind === 'seller' ? 'match' : s.kind === 'adjacent' ? 'adjacent' : 'unrelated';
  const skipReason = relevance === 'adjacent' ? `Looks like a ${s.adjacentWord ?? 'related'} service, not a seller of ${ask.what}` : relevance === 'unrelated' ? (s.somethingElse ? `Sells something other than ${ask.what}` : `Posts that mention ${ask.what} aren’t selling it`) : null;

  const signals: Signal[] = [];
  const flags: Flag[] = [];
  const stats: string[] = [];
  const flag = (f: Flag) => {
    flags.push(f);
    signals.push({ tone: 'warn', text: f.text });
  };

  if (s.followers !== null) stats.push(`${compact(s.followers)} followers`);
  if (s.joined) stats.push(`on X since ${s.joined.getUTCFullYear()}`);
  if (s.ads > 0) stats.push(`${s.ads} selling post${s.ads === 1 ? '' : 's'}`);

  if (s.verified) signals.push({ tone: 'good', text: 'Verified account.' });
  if (s.followers !== null) {
    if (s.followers < 30) flag({ text: `Hardly any followers (${s.followers}).`, cap: 45 });
    else if (s.followers < 100) flag({ text: `Under 100 followers (${s.followers}).`, cap: 55 });
    else if (s.followers >= 1000) signals.push({ tone: 'good', text: `${compact(s.followers)} followers.` });
  }
  let ageYears = 0;
  if (s.joined) {
    const days = Math.floor((now.getTime() - s.joined.getTime()) / DAY);
    ageYears = days / 365;
    if (days < 90) flag({ text: 'Brand-new account (under 3 months).', cap: 50 });
    else if (days < 365) flag({ text: 'Account is under a year old.', cap: 65 });
    else if (days >= 730) signals.push({ tone: 'good', text: `Account is ${Math.floor(days / 365)}+ years old.` });
  }
  if (s.distinctAds >= 3) signals.push({ tone: 'good', text: `${s.distinctAds} different selling posts.` });
  if (s.ads >= 3 && s.distinctAds / s.ads <= 0.7) flag({ text: 'Posts the same ad over and over — often a sign of spam.', cap: 60 });
  if (s.prices.length) signals.push({ tone: 'good', text: 'Shows prices in its posts.' });
  if (s.contact.phone || s.contact.email) signals.push({ tone: 'good', text: 'Phone or email published in its posts.' });
  if (s.upfrontOnly) flag({ text: `States “${s.upfrontOnly}” — asking for payment before delivery is a common scam pattern (it may be innocent, but pay on delivery where you can).`, cap: 70 });
  else if (s.podOffered) signals.push({ tone: 'good', text: 'Offers pay on delivery — safer for you.' });
  if (s.lastAdAt) {
    const days = Math.floor((now.getTime() - s.lastAdAt.getTime()) / DAY);
    if (days <= 60) signals.push({ tone: 'good', text: `Selling recently — last post ${agoText(s.lastAdAt, now)}.` });
    else if (days > 365) flag({ text: `No selling post for over a year (last ${agoText(s.lastAdAt, now)}).`, cap: 55 });
    else stats.push(`last selling post ${agoText(s.lastAdAt, now)}`);
  }
  if (s.confirmed) signals.push({ tone: 'info', text: `Checked their own recent posts too (${s.postsRead} read).` });
  if (!s.prices.length && !s.contact.phone && !s.contact.email) signals.push({ tone: 'info', text: 'No price or contact in these posts — ask for both.' });

  const learned = memoryEffect(mem);
  signals.push(...learned.signals);
  learned.flags.forEach(flag);

  const where = whereIs(s.location, s.headline, ask.place);
  const cap = Math.min(100, ...flags.map((f) => f.cap));
  const trust = trustScore(signals, cap, flags.filter((f) => f.cap >= 55).length);
  const strong = Boolean(s.verified || ((s.followers ?? 0) >= 1000 && ageYears >= 1) || (s.prices.length > 0 && (s.contact.phone || s.contact.email) && ageYears >= 1));
  const verdict = vendorVerdict(trust, strong);
  return {
    platform: 'x',
    name: s.name ?? handle,
    handle,
    url: `https://x.com/${s.username}`,
    headline: s.headline,
    verdict,
    verdictLabel: verdictLabel(kind, verdict),
    location: where.location,
    nearness: where.nearness,
    distanceKm: null,
    contact: s.contact,
    stats,
    signals: [...signals, ...where.signals],
    checked: true,
    rating: initialRating(trust, s.ads > 0 ? fitScore(1, 1) : 40),
    prices: itemPrices(s.prices, true),
    negotiation: null,
    memory: mem,
    relevance,
    skipReason,
  };
}
