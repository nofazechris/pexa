/** Shared shapes for "find a vendor / find someone to hire" research. Plain data: safe to send to the browser. */

export type ResearchKind = 'vendors' | 'hire';
export type Verdict = 'solid' | 'mixed' | 'careful' | 'unknown';

export interface ResearchRequest {
  kind: ResearchKind;
  /** Where to look: Instagram, TikTok and/or X for sellers (the person chooses); LinkedIn for professionals. */
  platforms: Platform[];
  /** What they are looking for, e.g. "sneakers", "graphic designer". */
  what: string;
  /** Where, e.g. "Lagos". Empty when it doesn't matter. */
  place: string;
  /** What matters most to the person; shifts the rating weights. Absent means balanced. */
  priority?: Priority;
  /** Only show sellers verified to be within this many km (straight-line). Absent means no limit. */
  radiusKm?: number | null;
}

export type Priority = 'balanced' | 'closest' | 'cheapest' | 'trusted';

export interface Signal {
  tone: 'good' | 'warn' | 'info';
  text: string;
}

export type Platform = 'instagram' | 'tiktok' | 'x' | 'linkedin';

/** The social networks a seller search can look on (LinkedIn is for professionals). */
export type SellerPlatform = 'instagram' | 'tiktok' | 'x';

/** How to reach them — only what they published on their own profile. */
export interface ItemContact {
  phone: string | null;
  tel: string | null;
  whatsapp: string | null;
  email: string | null;
  website: string | null;
}

/** What earlier Pexa searches and users have said about an account (counts only — no identities). */
export interface VendorMemoryView {
  /** In how many earlier searches (by anyone) it came up. */
  seen: number;
  good: number;
  bad: number;
  scam: number;
}

/** How good an option someone looks, 0–100, with the parts it is made of (null = not known, so it is left out). */
export interface Rating {
  overall: number;
  /** Does the account look real, active and established? */
  trust: number | null;
  /** Does it match what was asked for? */
  fit: number | null;
  /** How close they are. */
  nearby: number | null;
  /** How their prices compare with what others charge. */
  price: number | null;
}

/** Prices a seller published, as written (their currency), with how they compare with the typical price. */
export interface ItemPrices {
  currency: string;
  low: number;
  median: number;
  high: number;
  n: number;
  /** The amounts found, for pooling into a market price. */
  points: number[];
  /** True when these prices come from posts that mention what was asked for, so they can be compared with other sellers' (like with like). */
  matched: boolean;
  /** "₦25k–₦60k" */
  text: string;
  vsMarket: { kind: 'below' | 'near' | 'above'; percent: number } | null;
}

/** Help for talking the price down: what to aim for and a message ready to send. */
export interface Negotiation {
  tip: string;
  /** A sensible first offer, e.g. "₦38k" (null when there is nothing to base one on). */
  offer: string | null;
  message: string;
}

/** What things typically cost across the sellers found. */
export interface MarketPrice {
  currency: string;
  low: number;
  median: number;
  high: number;
  n: number;
  text: string;
  middle: string;
}

export interface ResearchItem {
  platform: Platform;
  name: string;
  /** @handle for Instagram accounts. */
  handle: string | null;
  url: string | null;
  headline: string | null;
  verdict: Verdict;
  verdictLabel: string;
  /** Where they say they are, as written on the profile ("Surulere, Lagos"). */
  location: string | null;
  /** By name alone: their neighbourhood, the same city, somewhere else, or not stated. */
  nearness: 'area' | 'city' | 'other' | 'unknown';
  /** Straight-line distance from the person's area, when both places could be pinned down. */
  distanceKm: number | null;
  contact: ItemContact;
  /** Short facts: "12.4K followers", "last post 3 days ago". */
  stats: string[];
  signals: Signal[];
  /** Whether the account itself was looked at (false: only seen in the search). */
  checked: boolean;
  rating: Rating | null;
  prices: ItemPrices | null;
  negotiation: Negotiation | null;
  /** What Pexa has learned about this account from earlier searches and feedback (null when it is new to Pexa). */
  memory: VendorMemoryView | null;
  /** Does it sell what was asked for? `adjacent` = something nearby (a cleaning service, a repair shop); `unrelated` = not selling it. Only matches are shown. */
  relevance: 'match' | 'adjacent' | 'unrelated';
  /** Why it was left out, in plain words (null for matches). */
  skipReason: string | null;
}

export interface ResearchResult {
  request: ResearchRequest;
  summary: string;
  items: ResearchItem[];
  /** Things worth knowing that aren't about one result. */
  notes: string[];
  /** What it cost in total, as dollars: "$0.022". */
  spent: string;
  /** What the item typically costs across the sellers found, when enough prices were published. */
  market: MarketPrice | null;
  /** Accounts that came up but were left out, and why (so nothing is hidden silently). */
  skipped: { name: string; reason: string }[];
}

export type ResearchStatus = 'PLANNED' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED';

/** What the plan card shows before anything is bought. */
export interface ResearchPlanView {
  sessionId: string;
  request: ResearchRequest;
  title: string;
  /** The steps in plain words. */
  steps: string[];
  /** Typical cost and the most it can ever cost, as dollars. */
  estimate: string;
  cap: string;
  capAtomic: string;
}
