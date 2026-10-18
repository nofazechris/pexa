/**
 * Readers for what Buy's social-data services send back. Those services wrap very different providers, so field names
 * differ ("follower_count", "followersCount", "edge_followed_by": {"count": n}…) and the data may be nested one or two
 * levels down. Rather than trust one shape, each reader looks for any of several names, ignoring case and punctuation,
 * and returns null for what it cannot find — a missing fact is never guessed.
 *
 * Pure: no network, no database.
 */

export type Json = unknown;

const isObj = (v: Json): v is Record<string, Json> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** "Follower_Count", "followerCount" and "follower-count" all become "followercount". */
const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * The first value stored under any of `aliases`, searching the object and then the objects inside it (breadth
 * first, up to `depth` levels). Arrays are not entered: the caller picks which list item to read.
 */
export function findKey(obj: Json, aliases: readonly string[], depth = 3): Json {
  if (!isObj(obj)) return undefined;
  const want = new Set(aliases.map(norm));
  let level: Record<string, Json>[] = [obj];
  for (let d = 0; d <= depth && level.length; d++) {
    const next: Record<string, Json>[] = [];
    for (const o of level) {
      for (const [k, v] of Object.entries(o)) {
        if (want.has(norm(k)) && v !== null && v !== undefined && v !== '') return v;
      }
      for (const v of Object.values(o)) if (isObj(v)) next.push(v);
    }
    level = next;
  }
  return undefined;
}

/** A number from 1234, "1,234", "12.5K", "3M", or an object like { count: 1234 }. */
export function asNumber(v: Json): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (isObj(v)) return asNumber(v.count ?? v.total ?? v.value);
  if (typeof v !== 'string') return null;
  const m = v.trim().replace(/,/g, '').match(/^(-?\d+(?:\.\d+)?)\s*([kKmMbB])?\+?$/);
  if (!m) return null;
  const n = Number(m[1]);
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] ?? '').toLowerCase() as 'k' | 'm' | 'b'] ?? 1;
  return n * mult;
}

export function asText(v: Json): string | null {
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number') return String(v);
  if (isObj(v)) {
    // Locations and similar often arrive as { text: "Lagos, Nigeria" } or { linkedinText: … }.
    for (const k of ['text', 'linkedinText', 'name', 'title', 'label', 'value', 'full']) {
      const t = asText(v[k]);
      if (t) return t;
    }
  }
  return null;
}

export function asBool(v: Json): boolean | null {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    if (/^(true|yes|1)$/i.test(v)) return true;
    if (/^(false|no|0)$/i.test(v)) return false;
  }
  if (typeof v === 'number') return v !== 0;
  return null;
}

/** A moment from epoch seconds, epoch milliseconds, or an ISO / date string. */
export function asDate(v: Json): Date | null {
  if (typeof v === 'number' || (typeof v === 'string' && /^\d{9,13}$/.test(v.trim()))) {
    const n = Number(v);
    const d = new Date(n < 1e11 ? n * 1000 : n);
    return Number.isNaN(d.getTime()) || d.getUTCFullYear() < 2005 ? null : d;
  }
  if (typeof v === 'string' && v.trim()) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) || d.getUTCFullYear() < 2005 ? null : d;
  }
  return null;
}

/** Every array in the value (any depth) whose items mostly satisfy `isItem`; the longest wins. */
export function findList(value: Json, isItem: (item: Record<string, Json>) => boolean, maxDepth = 6): Record<string, Json>[] {
  let best: Record<string, Json>[] = [];
  const walk = (v: Json, depth: number) => {
    if (depth > maxDepth) return;
    if (Array.isArray(v)) {
      const objs = v.filter(isObj);
      const good = objs.filter(isItem);
      if (good.length && good.length * 2 >= objs.length && good.length > best.length) best = good;
      for (const x of v.slice(0, 40)) walk(x, depth + 1);
    } else if (isObj(v)) {
      for (const x of Object.values(v)) walk(x, depth + 1);
    }
  };
  walk(value, 0);
  return best;
}

// --- Contact details and places the account published itself ------------------------------------------------

export interface Contact {
  /** As written, e.g. "+234 801 234 5678". */
  phone: string | null;
  /** Digits for a tel: link ("+2348012345678"). */
  tel: string | null;
  /** A wa.me link, only when the number is international or the account gave a WhatsApp link. */
  whatsapp: string | null;
  email: string | null;
  website: string | null;
}

export const NO_CONTACT: Contact = { phone: null, tel: null, whatsapp: null, email: null, website: null };

const PHONE_KEYS = ['publicPhoneNumber', 'contactPhoneNumber', 'businessPhoneNumber', 'phoneNumber', 'phone', 'mobile'] as const;
const PHONE_CC_KEYS = ['publicPhoneCountryCode', 'phoneCountryCode'] as const;
const EMAIL_KEYS = ['publicEmail', 'businessEmail', 'contactEmail', 'email'] as const;
const PHONE_RE = /(?<![\d,.])\+?\d[\d \t().-]{7,18}\d/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/;
const WA_RE = /(?:wa\.me\/|api\.whatsapp\.com\/send\?phone=|whatsapp\.com\/send\?phone=)\+?(\d{8,15})/i;

interface Phone {
  shown: string;
  digits: string;
  intl: boolean;
}

/** A string that is really a phone number — not a date, a count, or a run of one digit. */
function plausiblePhone(raw: string): Phone | null {
  const shown = raw.trim().replace(/\s+/g, ' ');
  if (/^\d{4}[-./]\d{1,2}[-./]\d{1,2}/.test(shown)) return null;
  const digits = shown.replace(/\D/g, '');
  if (digits.length < 9 || digits.length > 15 || /^(\d)\1+$/.test(digits)) return null;
  const intl = shown.startsWith('+');
  if (!intl && !digits.startsWith('0') && digits.length < 10) return null;
  return { shown, digits, intl };
}

/** What an account published for being contacted: fields first (business accounts), then what its bio says. */
export function contactFrom(obj: Json, bio: string | null, website: string | null): Contact {
  const field = asText(findKey(obj, PHONE_KEYS, 4));
  const cc = asText(findKey(obj, PHONE_CC_KEYS, 4))?.replace(/\D/g, '');
  let phone: Phone | null = null;
  if (field) {
    const withCc = cc && !field.startsWith('+') && !field.replace(/\D/g, '').startsWith(cc) ? `+${cc} ${field}` : field;
    phone = plausiblePhone(withCc);
  }
  if (!phone && bio) {
    for (const m of bio.matchAll(PHONE_RE)) {
      phone = plausiblePhone(m[0]);
      if (phone) break;
    }
  }
  const email = asText(findKey(obj, EMAIL_KEYS, 4)) ?? bio?.match(EMAIL_RE)?.[0] ?? null;
  const waDigits = `${website ?? ''} ${bio ?? ''}`.match(WA_RE)?.[1];
  const whatsapp = waDigits ? `https://wa.me/${waDigits}` : phone?.intl ? `https://wa.me/${phone.digits}` : null;
  const site = website && /^https?:\/\//i.test(website) && !WA_RE.test(website) ? website.slice(0, 200) : null;
  return {
    phone: phone?.shown ?? null,
    tel: phone ? (phone.intl ? `+${phone.digits}` : phone.digits) : null,
    whatsapp,
    email: email && EMAIL_RE.test(email) ? email.slice(0, 120) : null,
    website: site,
  };
}

const CITY_KEYS = ['cityName', 'city', 'publicCity', 'addressCity'] as const;
const STREET_KEYS = ['addressStreet', 'street', 'streetAddress'] as const;
const LOC_KEYS = ['location', 'locationName', 'geoLocationName'] as const;
const BIO_PLACE_RE = /(?:📍|📌|located (?:in|at)|based in|find us (?:in|at)|we are (?:in|at)|shop (?:in|at)|available in)\s*:?\s*([^\n|•·#@]{3,60})/i;

/** Where an account says it is: a business address or city field, else a 📍 / "based in" line in the bio. */
export function placeFrom(obj: Json, bio: string | null): string | null {
  // Instagram sends a business address as a JSON *string* ({"city_name":null,"street_address":null,…}): read it when it holds anything.
  let address: Json = null;
  const rawAddress = findKey(obj, ['businessAddressJson', 'business_address_json'], 4);
  if (typeof rawAddress === 'string' && rawAddress.trim().startsWith('{')) {
    try {
      address = JSON.parse(rawAddress);
    } catch {
      address = null;
    }
  }
  const parts = [asText(findKey(address, STREET_KEYS, 1)), asText(findKey(address, CITY_KEYS, 1)), asText(findKey(obj, STREET_KEYS, 4)), asText(findKey(obj, CITY_KEYS, 4)), asText(findKey(obj, LOC_KEYS, 4))].filter((p): p is string => Boolean(p));
  const fromFields = parts.length ? [...new Set(parts)].join(', ').slice(0, 100) : null;
  if (fromFields) return fromFields;
  const m = bio?.match(BIO_PLACE_RE);
  return m ? m[1].replace(/[\s.,;:!-]+$/, '').trim().slice(0, 60) || null : null;
}

// --- Instagram ----------------------------------------------------------------------------------------------

const USERNAME = ['username', 'userName', 'handle', 'screenName', 'uniqueId'] as const;
const FULLNAME = ['fullName', 'full_name', 'name', 'displayName'] as const;
const BIO = ['biography', 'bio', 'description', 'about'] as const;
const FOLLOWERS = ['followerCount', 'followersCount', 'followers', 'edge_followed_by', 'follower_count'] as const;
const FOLLOWING = ['followingCount', 'followsCount', 'following', 'edge_follow', 'following_count'] as const;
const POSTS = ['mediaCount', 'postsCount', 'posts', 'edge_owner_to_timeline_media', 'media_count', 'postCount'] as const;
const VERIFIED = ['isVerified', 'verified', 'is_verified'] as const;
const PRIVATE = ['isPrivate', 'private', 'is_private'] as const;
const BUSINESS = ['isBusinessAccount', 'isBusiness', 'isProfessionalAccount', 'is_business_account', 'is_professional_account'] as const;
const CATEGORY = ['category', 'categoryName', 'businessCategoryName', 'category_name'] as const;
const WEBSITE = ['externalUrl', 'external_url', 'website', 'bioLink', 'link'] as const;

export interface IgCandidate {
  username: string;
  fullName: string | null;
  verified: boolean | null;
  isPrivate: boolean | null;
  followers: number | null;
  bio: string | null;
}

const cleanHandle = (s: string) => s.trim().replace(/^@/, '').toLowerCase();

/** Accounts found by an Instagram search, in the order the search gave them, without duplicates. */
export function igCandidates(output: Json): IgCandidate[] {
  const list = findList(output, (o) => typeof findKey(o, USERNAME, 2) === 'string');
  const seen = new Set<string>();
  const out: IgCandidate[] = [];
  for (const o of list) {
    const raw = asText(findKey(o, USERNAME, 2));
    if (!raw) continue;
    const username = cleanHandle(raw);
    if (!/^[a-z0-9._]{1,30}$/.test(username) || seen.has(username)) continue;
    seen.add(username);
    out.push({
      username,
      fullName: asText(findKey(o, FULLNAME, 2)),
      verified: asBool(findKey(o, VERIFIED, 2)) ?? null,
      isPrivate: asBool(findKey(o, PRIVATE, 2)) ?? null,
      followers: asNumber(findKey(o, FOLLOWERS, 2)),
      bio: asText(findKey(o, BIO, 2)),
    });
  }
  return out;
}

export interface IgPost {
  at: Date | null;
  likes: number | null;
  comments: number | null;
  /** The post's caption — where sellers write their prices. */
  caption: string | null;
}

export interface IgProfile {
  username: string | null;
  fullName: string | null;
  bio: string | null;
  followers: number | null;
  following: number | null;
  posts: number | null;
  verified: boolean | null;
  isPrivate: boolean | null;
  business: boolean | null;
  category: string | null;
  website: string | null;
  /** Where the account says it is (a business address, city, or a 📍 line in the bio). */
  location: string | null;
  /** Phone, email and links the account itself published. */
  contact: Contact;
  /** When the account was created, if the network says (TikTok does). */
  createdAt?: Date | null;
  /** Instagram says the account was created recently. */
  joinedRecently: boolean | null;
  /** Verified through Meta Verified (paid business verification), separate from the blue tick. */
  metaVerified: boolean | null;
  professional: boolean | null;
  recent: IgPost[];
}

/** A post's caption, in the plain field or in Instagram's graph shape (edge_media_to_caption.edges[0].node.text). */
function captionOf(post: Record<string, Json>): string | null {
  const plain = asText(findKey(post, ['caption', 'captionText', 'text', 'title', 'description'], 2));
  if (plain) return plain.slice(0, 600);
  const node = findKey(post, ['edge_media_to_caption'], 2);
  const edges = isObj(node) && Array.isArray(node.edges) ? node.edges : [];
  const first = edges[0];
  const text = isObj(first) && isObj(first.node) ? asText(first.node.text) : null;
  return text ? text.slice(0, 600) : null;
}

const TIME_KEYS = ['takenAt', 'taken_at', 'taken_at_timestamp', 'timestamp', 'createdAt', 'created_at', 'deviceTimestamp', 'postedAt', 'date'] as const;
const LIKE_KEYS = ['likeCount', 'like_count', 'likes', 'edge_liked_by', 'edge_media_preview_like'] as const;
const COMMENT_KEYS = ['commentCount', 'comment_count', 'comments', 'edge_media_to_comment'] as const;

/** What a profile lookup said about one account. `null` when nothing in the reply looks like an account. */
export function igProfile(output: Json): IgProfile | null {
  const followers = asNumber(findKey(output, FOLLOWERS, 4));
  const username = asText(findKey(output, USERNAME, 4));
  const posts = asNumber(findKey(output, POSTS, 4));
  if (followers === null && !username && posts === null) return null;

  const media = findList(output, (o) => asDate(findKey(o, TIME_KEYS, 1)) !== null || asNumber(findKey(o, LIKE_KEYS, 1)) !== null, 6);
  return {
    username: username ? cleanHandle(username) : null,
    fullName: asText(findKey(output, FULLNAME, 4)),
    bio: asText(findKey(output, BIO, 4)),
    followers,
    following: asNumber(findKey(output, FOLLOWING, 4)),
    posts,
    verified: asBool(findKey(output, VERIFIED, 4)),
    isPrivate: asBool(findKey(output, PRIVATE, 4)),
    business: asBool(findKey(output, BUSINESS, 4)),
    category: asText(findKey(output, CATEGORY, 4)),
    website: asText(findKey(output, WEBSITE, 4)),
    location: placeFrom(output, asText(findKey(output, BIO, 4))),
    contact: contactFrom(output, asText(findKey(output, BIO, 4)), asText(findKey(output, WEBSITE, 4))),
    joinedRecently: asBool(findKey(output, ['isJoinedRecently', 'is_joined_recently'], 4)),
    metaVerified: asBool(findKey(output, ['isVerifiedByMv4b', 'is_verified_by_mv4b'], 4)),
    professional: asBool(findKey(output, ['isProfessionalAccount', 'is_professional_account'], 4)),
    recent: media.slice(0, 12).map((m) => ({
      at: asDate(findKey(m, TIME_KEYS, 1)),
      likes: asNumber(findKey(m, LIKE_KEYS, 1)),
      comments: asNumber(findKey(m, COMMENT_KEYS, 1)),
      caption: captionOf(m),
    })),
  };
}

// --- LinkedIn -----------------------------------------------------------------------------------------------

export interface LiPerson {
  name: string;
  headline: string | null;
  location: string | null;
  url: string | null;
  about: string | null;
  connections: number | null;
  followers: number | null;
  experienceCount: number | null;
  currentRole: string | null;
  /** When the profile was created (LinkedIn's own record). */
  joined: Date | null;
  verified: boolean | null;
  openToWork: boolean | null;
  /** Services they list, and skills — what they say they do. */
  services: string[];
  skills: string[];
  recommendations: number | null;
}

const stringList = (v: Json): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 12) : []);
const namedList = (v: Json): string[] => (Array.isArray(v) ? v.map((x) => (isObj(x) ? asText(x.name) : typeof x === 'string' ? x : null)).filter((x): x is string => Boolean(x)).slice(0, 12) : []);

const LI_URL = ['linkedinUrl', 'profileUrl', 'url', 'link', 'publicProfileUrl'] as const;

/** People found by a LinkedIn search. */
export function liPeople(output: Json): LiPerson[] {
  const nameOf = (o: Record<string, Json>): string | null => {
    const full = asText(findKey(o, ['fullName', 'name', 'displayName'], 1));
    if (full) return full;
    const first = asText(findKey(o, ['firstName', 'first_name'], 1));
    const last = asText(findKey(o, ['lastName', 'last_name'], 1));
    return first ? [first, last].filter(Boolean).join(' ') : null;
  };
  const list = findList(output, (o) => nameOf(o) !== null && (findKey(o, ['headline', 'position', 'title', 'occupation', ...LI_URL], 2) !== undefined));
  const seen = new Set<string>();
  const out: LiPerson[] = [];
  for (const o of list) {
    const name = nameOf(o);
    if (!name) continue;
    const urlRaw = asText(findKey(o, LI_URL, 2));
    const url = urlRaw && /^https?:\/\/([a-z]+\.)?linkedin\.com\//i.test(urlRaw) ? urlRaw : null;
    const key = (url ?? name).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const exp = findKey(o, ['experience', 'experiences', 'positions'], 1);
    out.push({
      name,
      headline: asText(findKey(o, ['headline', 'occupation', 'position', 'title'], 2)),
      location: asText(findKey(o, ['location', 'locationName', 'geoLocationName', 'geo', 'city'], 2)),
      url,
      about: asText(findKey(o, ['about', 'summary'], 2)),
      connections: asNumber(findKey(o, ['connectionsCount', 'connections', 'connectionCount'], 2)),
      followers: asNumber(findKey(o, ['followerCount', 'followersCount', 'followers'], 2)),
      experienceCount: Array.isArray(exp) ? exp.length : null,
      currentRole: asText(findKey(o, ['currentPosition', 'currentJob', 'currentRole', 'currentCompany', 'companyName'], 2)),
      joined: asDate(findKey(o, ['registeredAt'], 1)),
      verified: asBool(findKey(o, ['verified'], 1)),
      openToWork: asBool(findKey(o, ['openToWork'], 1)),
      services: stringList(findKey(o, ['servicesList'], 2)),
      skills: namedList(findKey(o, ['skills'], 1)),
      recommendations: asNumber(findKey(o, ['receivedRecommendations'], 2)),
    });
  }
  return out;
}

// --- X (Twitter) posts -----------------------------------------------------------------------------------------
//
// X's search returns TWEETS, each with a small profile of its author attached (followers, join date, verified, location) but no bio —
// even when asked for "people". So the unit here is a tweet, and a seller is worked out by looking at everything an author posted.

export interface XTweet {
  /** The tweet's own id (empty when the reply didn't give one). */
  id: string;
  author: string;
  name: string | null;
  text: string;
  at: Date | null;
  likes: number | null;
  replies: number | null;
  views: number | null;
  followers: number | null;
  /** When the author's account was created. */
  joined: Date | null;
  verified: boolean | null;
  /** The location the author typed into their profile. */
  location: string | null;
}

/** The tweets in an X search reply, newest-first as given. Items without an author or text (X sometimes sends a blank one) are skipped. */
export function xTweets(output: Json, defaultAuthor?: string): XTweet[] {
  const list = findList(output, (o) => (typeof o.screen_name === 'string' || Boolean(defaultAuthor)) && typeof o.text === 'string');
  const out: XTweet[] = [];
  for (const o of list) {
    const handle = cleanHandle(String(typeof o.screen_name === 'string' ? o.screen_name : defaultAuthor));
    const text = String(o.text).trim();
    if (!/^[a-z0-9_]{1,15}$/.test(handle) || !text || text === 'undefined') continue;
    const ui = isObj(o.user_info) ? o.user_info : {};
    out.push({
      id: typeof o.tweet_id === 'string' || typeof o.tweet_id === 'number' ? String(o.tweet_id) : '',
      author: handle,
      name: asText(ui.name),
      text,
      at: asDate(o.created_at),
      likes: asNumber(o.favorites),
      replies: asNumber(o.replies),
      views: asNumber(o.views),
      followers: asNumber(ui.followers_count),
      joined: asDate(ui.created_at),
      verified: asBool(ui.verified),
      location: asText(ui.location),
    });
  }
  return out;
}

// --- TikTok ---------------------------------------------------------------------------------------------------
//
// TikTok's search returns accounts WITH a bio ("signature") and follower count, so a search already says a lot; a profile lookup
// adds the account's creation date and video count. Field names vary by provider, so several are tried for each.

/** Accounts from a TikTok user search, in order, without duplicates. */
export function tiktokCandidates(output: Json): IgCandidate[] {
  const list = findList(output, (o) => typeof findKey(o, ['uniqueId', 'unique_id', 'username'], 3) === 'string');
  const seen = new Set<string>();
  const out: IgCandidate[] = [];
  for (const o of list) {
    const raw = asText(findKey(o, ['uniqueId', 'unique_id', 'username'], 3));
    if (!raw) continue;
    const username = cleanHandle(raw);
    if (!/^[a-z0-9._]{1,40}$/.test(username) || seen.has(username)) continue;
    seen.add(username);
    out.push({
      username,
      fullName: asText(findKey(o, ['nickname', 'nick_name', 'fullName', 'name'], 3)),
      verified: asBool(findKey(o, ['verified', 'isVerified', 'is_verified'], 3)) ?? null,
      isPrivate: asBool(findKey(o, ['privateAccount', 'isPrivate', 'is_private', 'secret'], 3)) ?? null,
      followers: asNumber(findKey(o, ['followerCount', 'follower_count', 'fans'], 3)),
      bio: asText(findKey(o, ['signature', 'bio', 'description'], 3)),
    });
  }
  return out;
}

/** A TikTok profile lookup, mapped onto the same shape as an Instagram profile. Null when the reply holds no account. */
export function tiktokProfile(output: Json): IgProfile | null {
  const username = asText(findKey(output, ['uniqueId', 'unique_id', 'username'], 5));
  const followers = asNumber(findKey(output, ['followerCount', 'follower_count', 'fans'], 5));
  const posts = asNumber(findKey(output, ['videoCount', 'video_count', 'aweme_count'], 5));
  if (!username && followers === null && posts === null) return null;
  const bio = asText(findKey(output, ['signature', 'bio', 'description'], 5));
  const bioLink = findKey(output, ['bioLink', 'bio_link'], 5);
  const website = asText(isObj(bioLink) ? bioLink.link : null);
  return {
    username: username ? cleanHandle(username) : null,
    fullName: asText(findKey(output, ['nickname', 'nick_name'], 5)),
    bio,
    followers,
    following: asNumber(findKey(output, ['followingCount', 'following_count', 'following'], 5)),
    posts,
    verified: asBool(findKey(output, ['verified', 'isVerified', 'is_verified'], 5)),
    isPrivate: asBool(findKey(output, ['privateAccount', 'isPrivate', 'is_private', 'secret'], 5)),
    business: asBool(findKey(output, ['commerceUserInfo', 'isCommerce', 'ttSeller'], 5)),
    category: asText(findKey(output, ['category', 'commerceCategory'], 5)),
    website,
    location: placeFrom(output, bio),
    contact: contactFrom(output, bio, website),
    createdAt: asDate(findKey(output, ['createTime', 'create_time'], 5)),
    joinedRecently: null,
    metaVerified: null,
    professional: null,
    recent: [],
  };
}
