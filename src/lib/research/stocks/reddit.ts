import type { Post } from './tickers';

/**
 * Reading Buy's Reddit search reply. The exact shape isn't known until the first real run, so this looks for lists of post-like
 * objects and tries the usual field names for each part (title, body, score, comments, author, time). Anything it can't read is
 * skipped, never guessed. Pure.
 */

type Json = unknown;
const isObj = (v: Json): v is Record<string, Json> => typeof v === 'object' && v !== null && !Array.isArray(v);

const pick = (o: Record<string, Json>, keys: string[]): Json => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
};
const text = (v: Json): string => (typeof v === 'string' ? v.trim() : '');
const num = (v: Json): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};
function date(v: Json): Date | null {
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v < 1e12 ? v * 1000 : v);
  if (typeof v === 'string' && v) {
    const d = new Date(/^\d+$/.test(v) ? (Number(v) < 1e12 ? Number(v) * 1000 : Number(v)) : v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** Every object in the reply that looks like a Reddit post (it has a title and something else post-like), however deeply nested. */
function postObjects(root: Json, depth = 0, out: Record<string, Json>[] = []): Record<string, Json>[] {
  if (depth > 7 || out.length > 200) return out;
  if (Array.isArray(root)) {
    for (const x of root) postObjects(x, depth + 1, out);
  } else if (isObj(root)) {
    const hasTitle = text(pick(root, ['title', 'post_title', 'postTitle'])) !== '';
    const postish = pick(root, ['score', 'ups', 'upvotes', 'upvote_count', 'num_comments', 'comments', 'commentCount', 'subreddit', 'subreddit_name_prefixed', 'permalink', 'selftext', 'created_utc']) !== undefined;
    if (hasTitle && postish) {
      out.push(root);
      return out;
    }
    for (const v of Object.values(root)) postObjects(v, depth + 1, out);
  }
  return out;
}

export function redditPosts(output: Json): Post[] {
  const posts: Post[] = [];
  for (const o of postObjects(output)) {
    const title = text(pick(o, ['title', 'post_title', 'postTitle']));
    const body = text(pick(o, ['selftext', 'body', 'text', 'content', 'description']));
    const author = text(pick(o, ['author', 'author_name', 'authorName', 'username'])) || (isObj(o.author) ? text(pick(o.author as Record<string, Json>, ['name', 'username'])) : '');
    if (!title || !author || /^\[?deleted\]?$/i.test(author)) continue;
    const comments = num(pick(o, ['num_comments', 'numComments', 'commentCount', 'comments']));
    const score = num(pick(o, ['score', 'ups', 'upvotes', 'upvote_count']));
    posts.push({
      platform: 'reddit',
      id: text(pick(o, ['id', 'post_id', 'name'])) || `${author}:${title.slice(0, 24)}`,
      author,
      text: body ? `${title}. ${body}`.slice(0, 600) : title,
      engagement: score + comments,
      at: date(pick(o, ['created_utc', 'created', 'createdAt', 'created_at', 'timestamp'])),
      followers: null,
    });
  }
  return posts;
}
