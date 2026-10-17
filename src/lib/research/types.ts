/** Shared shapes for "find a vendor / find someone to hire" research. Plain data: safe to send to the browser. */

export type ResearchKind = 'vendors' | 'hire';
/** Where the people are looked up: Instagram (sellers, trades, creators) or LinkedIn (professionals). */
export type ResearchSource = 'instagram' | 'linkedin';
export type Verdict = 'solid' | 'mixed' | 'careful' | 'unknown';

export interface ResearchRequest {
  kind: ResearchKind;
  source: ResearchSource;
  /** What they are looking for, e.g. "sneakers", "graphic designer". */
  what: string;
  /** Where, e.g. "Lagos". Empty when it doesn't matter. */
  place: string;
}

export interface Signal {
  tone: 'good' | 'warn' | 'info';
  text: string;
}

export type Platform = 'instagram' | 'x' | 'linkedin';

/** How to reach them — only what they published on their own profile. */
export interface ItemContact {
  phone: string | null;
  tel: string | null;
  whatsapp: string | null;
  email: string | null;
  website: string | null;
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
}

export interface ResearchResult {
  request: ResearchRequest;
  summary: string;
  items: ResearchItem[];
  /** Things worth knowing that aren't about one result. */
  notes: string[];
  /** What it cost in total, as dollars: "$0.022". */
  spent: string;
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
