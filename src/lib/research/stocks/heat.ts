import { normalizeText, type Post } from './tickers';

/**
 * How much real attention a ticker is getting, and how trustworthy that attention looks. Attention is not quality — this only
 * measures who is talking, how many different people, how much it spread, and how fresh it is, and flags talk that looks copy-pasted
 * or comes from tiny accounts. Pure.
 */

export interface Heat {
  symbol: string;
  /** Distinct posts after removing copies. */
  posts: number;
  authors: number;
  engagement: number;
  platforms: ('x' | 'reddit')[];
  /** Newest post, in days ago (null when no post had a date). */
  newestDays: number | null;
  /** Share of the posts that were copies of another post (0–1). */
  copyShare: number;
  /** Share of X posts that came from accounts under 200 followers (null when there were none). */
  tinyShare: number | null;
  /** The score used for ordering. */
  score: number;
  /** A couple of the highest-engagement posts, trimmed, as evidence. */
  examples: { platform: 'x' | 'reddit'; author: string; text: string }[];
}

const DAY = 86_400_000;

export function heatOf(symbol: string, posts: readonly Post[], now: Date): Heat {
  const seen = new Set<string>();
  const unique: Post[] = [];
  for (const p of posts) {
    const key = normalizeText(p.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(p);
  }
  const authors = new Set(unique.map((p) => `${p.platform}:${p.author.toLowerCase()}`)).size;
  const engagement = unique.reduce((a, p) => a + Math.max(0, p.engagement), 0);
  const platforms = [...new Set(unique.map((p) => p.platform))];
  const dates = unique.map((p) => p.at?.getTime()).filter((t): t is number => typeof t === 'number' && Number.isFinite(t));
  const newestDays = dates.length ? Math.max(0, (now.getTime() - Math.max(...dates)) / DAY) : null;
  const xPosts = unique.filter((p) => p.platform === 'x');
  const tiny = xPosts.filter((p) => p.followers !== null && p.followers < 200);
  const tinyShare = xPosts.length ? tiny.length / xPosts.length : null;
  const copyShare = posts.length ? 1 - unique.length / posts.length : 0;

  // Different voices matter most, then how far it spread, then being on more than one platform, then being fresh.
  let score = Math.sqrt(authors) * 2 + Math.log10(1 + engagement) * 1.5;
  if (platforms.length > 1) score += 2;
  if (newestDays !== null && newestDays <= 1) score += 1;
  if (copyShare > 0.4) score *= 0.6;
  if (tinyShare !== null && tinyShare > 0.6) score *= 0.75;

  const examples = [...unique]
    .sort((a, b) => b.engagement - a.engagement)
    .slice(0, 2)
    .map((p) => ({ platform: p.platform, author: p.author, text: p.text.replace(/\s+/g, ' ').slice(0, 200) }));
  return { symbol, posts: unique.length, authors, engagement, platforms, newestDays, copyShare, tinyShare, score: Math.round(score * 100) / 100, examples };
}

/** Tickers ranked by attention. A ticker only one voice is talking about is noise, so it needs at least two distinct authors. */
export function rankHeat(mentions: ReadonlyMap<string, readonly Post[]>, now: Date, minAuthors = 2): Heat[] {
  return [...mentions.entries()]
    .map(([symbol, posts]) => heatOf(symbol, posts, now))
    .filter((h) => h.authors >= minAuthors)
    .sort((a, b) => b.score - a.score || b.authors - a.authors);
}
