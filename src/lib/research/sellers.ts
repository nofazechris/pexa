/**
 * From tweets to sellers. X returns tweets, so a seller is worked out from everything one author posted in the results: do they
 * actually sell the thing (not a cleaning service, a charity, a news account), how many different ads, do they show prices and a
 * phone number, and how old and established is the account. Pure.
 */
import { readText, type TextKind, type Theme } from './commerce';
import { currencyForPlace, extractPrices, type PricePoint } from './price';
import { NO_CONTACT, contactFrom, type Contact, type XTweet } from './read';

export interface XSeller {
  username: string;
  name: string | null;
  followers: number | null;
  joined: Date | null;
  verified: boolean | null;
  location: string | null;
  /** seller = sells the thing; adjacent = sells/does something nearby; mention/unrelated = not a seller of it. */
  kind: TextKind;
  /** Why it was judged that way, in plain words. */
  evidence: string[];
  /** The words that made it "adjacent" (cleaning, repair…), when it was. */
  adjacentWord: string | null;
  /** How many of their results were selling posts, and how many of those were different from each other. */
  ads: number;
  distinctAds: number;
  lastAdAt: Date | null;
  prices: PricePoint[];
  contact: Contact;
  /** One of their selling posts, shortened — what they say they sell. */
  headline: string | null;
}

const RANK: Record<TextKind, number> = { seller: 3, adjacent: 2, mention: 1, unrelated: 0 };

/** A tweet reduced to what makes it "the same ad": no links, no punctuation, no case. */
const fingerprint = (text: string) =>
  text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, 80);

/** Every author in the results, judged. Order: first appearance. */
export function groupSellers(tweets: readonly XTweet[], theme: Theme, place: string): XSeller[] {
  const currency = currencyForPlace(place);
  const byAuthor = new Map<string, XTweet[]>();
  for (const t of tweets) byAuthor.set(t.author, [...(byAuthor.get(t.author) ?? []), t]);

  const out: XSeller[] = [];
  for (const [username, posts] of byAuthor) {
    const reads = posts.map((p) => ({ p, r: readText(p.text, theme, currency) }));
    const best = reads.reduce<TextKind>((k, x) => (RANK[x.r.kind] > RANK[k] ? x.r.kind : k), 'unrelated');
    const ads = reads.filter((x) => x.r.kind === 'seller');
    const first = posts[0];
    const adjacentText = reads.find((x) => x.r.kind === 'adjacent')?.p.text ?? '';
    const adTexts = ads.map((x) => x.p.text).join(' \n ');
    const dates = ads.map((x) => x.p.at).filter((d): d is Date => d !== null).sort((a, b) => b.getTime() - a.getTime());
    out.push({
      username,
      name: first.name,
      followers: first.followers,
      joined: first.joined,
      verified: first.verified,
      location: first.location,
      kind: best,
      evidence: [...new Set(ads.flatMap((x) => x.r.evidence))],
      adjacentWord: best === 'adjacent' ? (theme.adjacent.exec(adjacentText)?.[0]?.toLowerCase() ?? null) : null,
      ads: ads.length,
      distinctAds: new Set(ads.map((x) => fingerprint(x.p.text))).size,
      lastAdAt: dates[0] ?? null,
      prices: ads.flatMap((x) => extractPrices(x.p.text, currency)),
      contact: ads.length ? contactFrom({}, adTexts, null) : NO_CONTACT,
      headline: ads.length ? ads[0].p.text.replace(/\s+/g, ' ').replace(/https?:\/\/\S+/g, '').trim().slice(0, 140) : null,
    });
  }
  return out;
}
