/**
 * Buy's catalog, normalized for Pexa. The pure half: turning the gateway's raw catalog (168 services
 * across browser rental, social data, flights…) and the separate compute catalog (cloud VMs) into one
 * clean list, and searching it. Fetching/caching lives in service.ts.
 *
 * Two safety properties: a service is only ever kept if its URL is on one of Buy's own hosts (a
 * poisoned catalog can't smuggle in an arbitrary URL for the agent to pay), and the agent never gets a
 * URL to call — it names a service by id and we resolve the URL from the catalog.
 */
import { isAllowedBuyUrl, usdLabel } from './x402';

export interface BuyPriceOption {
  /** Human label, e.g. "5 min" or "e2-micro · 1h". */
  label: string;
  atomic: string;
  /** The parameters this price applies to (e.g. {durationMinutes: 5}). */
  params: Record<string, unknown>;
}

export interface BuyCapability {
  id: string;
  title: string;
  description: string;
  /** browser | compute | x | reddit | youtube | … */
  platform: string;
  method: 'GET' | 'POST';
  url: string;
  inputSchema: Record<string, unknown>;
  pricing: { model: string; options: BuyPriceOption[] };
  source: 'gateway' | 'compute';
}

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function optionLabel(params: Record<string, unknown>): string {
  if (typeof params.durationMinutes === 'number') return `${params.durationMinutes} min`;
  if (typeof params.maxResults === 'number') return `up to ${params.maxResults} results`;
  const first = Object.entries(params)[0];
  return first ? `${first[0]}: ${String(first[1])}` : 'standard';
}

/** Normalize the gateway's `/v1/catalog` response. Skips anything unavailable, malformed or off-host. */
export function normalizeGatewayCatalog(json: unknown): { payTo: string | null; capabilities: BuyCapability[] } {
  const root = rec(json);
  const payTo = typeof rec(root.payment).payTo === 'string' ? (rec(root.payment).payTo as string) : null;
  const items = Array.isArray(root.capabilities) ? root.capabilities : [];
  const capabilities: BuyCapability[] = [];

  for (const raw of items) {
    const c = rec(raw);
    if (typeof c.id !== 'string' || typeof c.title !== 'string' || typeof c.url !== 'string') continue;
    if (c.available === false) continue;
    if (!isAllowedBuyUrl(c.url)) continue;
    const method = String(c.method ?? 'POST').toUpperCase();
    if (method !== 'GET' && method !== 'POST') continue;

    const options: BuyPriceOption[] = [];
    for (const p of Array.isArray(c.priceOptions) ? c.priceOptions : []) {
      const o = rec(p);
      if (typeof o.atomic !== 'string' || !/^\d+$/.test(o.atomic)) continue;
      const { usd: _usd, atomic: _atomic, tokens: _tokens, prorated: _prorated, ...params } = o;
      void _usd; void _atomic; void _tokens; void _prorated;
      options.push({ label: optionLabel(params), atomic: o.atomic, params });
    }

    // Most listings publish one flat `price` instead of `priceOptions` (143 of 168 at time of writing).
    const flat = rec(c.price);
    if (options.length === 0 && typeof flat.atomic === 'string' && /^\d+$/.test(flat.atomic)) {
      options.push({ label: 'standard', atomic: flat.atomic, params: {} });
    }

    capabilities.push({
      id: c.id,
      title: c.title,
      description: typeof c.description === 'string' ? c.description : '',
      platform: typeof c.platform === 'string' ? c.platform : 'other',
      method,
      url: c.url,
      inputSchema: rec(c.inputSchema),
      pricing: {
        model: typeof c.pricingModel === 'string' && c.pricingModel ? c.pricingModel : typeof flat.pricingModel === 'string' && flat.pricingModel ? flat.pricingModel : 'fixed',
        options,
      },
      source: 'gateway',
    });
  }
  return { payTo, capabilities };
}

/**
 * One "run a script on a cloud VM" capability from the compute catalog. Machine types that need an
 * identity attestation are left out — the agent can't satisfy that on a user's behalf.
 */
export function buildComputeCapability(json: unknown): BuyCapability | null {
  const root = rec(json);
  const machines = (Array.isArray(root.machineTypes) ? root.machineTypes : [])
    .map(rec)
    .filter((m) => typeof m.machineType === 'string' && typeof m.priceAtomic === 'string' && /^\d+$/.test(m.priceAtomic as string) && m.attestationRequired !== true);
  if (machines.length === 0) return null;

  return {
    id: 'compute.vm.run',
    title: 'Run a script on a cloud VM',
    description:
      'Rents a fresh Debian 12 virtual machine for one hour and runs your shell script on it as root, returning the output. ' +
      'Outbound network is limited to DNS, HTTP, HTTPS and NTP, so wrap network calls in timeouts. The purchase takes about a minute.',
    platform: 'compute',
    method: 'POST',
    url: 'https://usebuy.ai/google/vm',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['machineType', 'script'],
      properties: {
        machineType: { type: 'string', enum: machines.map((m) => m.machineType as string), description: 'VM size; larger costs more.' },
        script: { type: 'string', minLength: 1, maxLength: 8000, description: 'Shell script to run as root.' },
      },
    },
    pricing: {
      model: 'duration',
      options: machines.map((m) => ({ label: `${m.machineType as string} · 1h`, atomic: m.priceAtomic as string, params: { machineType: m.machineType } })),
    },
    source: 'compute',
  };
}

/** The cheapest price a capability can cost, or null if it publishes none. */
export function priceFrom(cap: BuyCapability): bigint | null {
  const prices = cap.pricing.options.map((o) => BigInt(o.atomic));
  return prices.length ? prices.reduce((a, b) => (a < b ? a : b)) : null;
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'for', 'to', 'on', 'in', 'and', 'or', 'me', 'my', 'get', 'find', 'about', 'with', 'from', 'what', 'is', 'are', 'please',
  'this', 'that', 'these', 'those', 'it', 'its', 'any', 'some', 'report', 'reports', 'business', 'people', 'saying', 'said', 'today', 'latest',
  'recent', 'news', 'right', 'now', 'show', 'tell', 'can', 'you', 'who', 'how', 'do', 'does', 'check', 'look', 'up',
]);

/**
 * Questions about trust ("is this vendor legit", "any scam reports") are answered by what the public says,
 * so they point at the community sources. Words here add those platforms to the search.
 */
const INTENT: Record<string, string[]> = {
  scam: ['reddit', 'x'], scams: ['reddit', 'x'], legit: ['reddit', 'x'], legitimate: ['reddit', 'x'], fraud: ['reddit', 'x'], fake: ['reddit', 'x'],
  trust: ['reddit', 'x'], trustworthy: ['reddit', 'x'], reputation: ['reddit', 'x'], review: ['reddit'], reviews: ['reddit'], complaint: ['reddit', 'x'], complaints: ['reddit', 'x'],
  rug: ['reddit', 'x'], safe: ['reddit', 'x'],
};

/** Words people use that map onto catalog platform names. */
const SYNONYMS: Record<string, string> = {
  twitter: 'x', tweet: 'x', tweets: 'x', vm: 'compute', server: 'compute', cloud: 'compute', code: 'compute', script: 'compute',
  web: 'browser', website: 'browser', page: 'browser', flight: 'flights', insta: 'instagram', yt: 'youtube',
};

/** Map a word to a catalog term, trying simple stems so "tweeting", "videos", "flights" still land. */
function canon(word: string): string {
  if (SYNONYMS[word]) return SYNONYMS[word];
  for (const stem of [word.replace(/ing$/, ''), word.replace(/ed$/, ''), word.replace(/s$/, '')]) {
    if (stem.length >= 2 && stem !== word && SYNONYMS[stem]) return SYNONYMS[stem];
  }
  return word;
}

function tokens(q: string): string[] {
  const words = q
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
  return words.filter((t) => !STOPWORDS.has(t)).map(canon);
}

/** Platforms a question implies without naming them (e.g. "is this legit" → community sources). */
function impliedPlatforms(q: string): string[] {
  const out = new Set<string>();
  for (const w of q.toLowerCase().split(/[^a-z0-9]+/)) for (const p of INTENT[w] ?? []) out.add(p);
  return [...out];
}

/** Search the catalog. Ranked by relevance, then by lowest price; `platform` narrows to one category. */
export function searchCapabilities(
  caps: readonly BuyCapability[],
  opts: { query?: string; platform?: string; limit?: number },
): BuyCapability[] {
  // A platform hint can arrive as junk from a weak model ("x posts search"); use the first word in it that is
  // a real category, and ignore it otherwise rather than filtering everything away.
  const known = new Set(caps.map((c) => c.platform.toLowerCase()));
  const platform = opts.platform
    ? (opts.platform.toLowerCase().split(/[^a-z0-9]+/).map((w) => SYNONYMS[w] ?? w).find((w) => known.has(w)) ?? null)
    : null;
  const pool = platform ? caps.filter((c) => c.platform.toLowerCase() === platform) : [...caps];
  const q = tokens(opts.query ?? '');
  const implied = impliedPlatforms(opts.query ?? '');
  const limit = Math.max(1, Math.min(opts.limit ?? 8, 20));

  const scored = pool.map((c) => {
    let score = 0;
    const hay = { id: c.id.toLowerCase(), title: c.title.toLowerCase(), desc: c.description.toLowerCase(), plat: c.platform.toLowerCase() };
    for (const t of q) {
      if (hay.plat === t) score += 5;
      // Fragments under 3 letters ("ng" in a handle) would match inside unrelated words ("followiNG").
      if (t.length < 3) continue;
      if (hay.id.includes(t)) score += 3;
      if (hay.title.includes(t)) score += 3;
      if (hay.desc.includes(t)) score += 1;
    }
    if (implied.includes(hay.plat)) score += 4; // hinted by the question, not named — weaker than a named platform
    // Curated first-party listings beat the long tail of third-party scrapers when both fit.
    if (score > 0 && !c.id.startsWith('monid.')) score += 4;
    return { c, score };
  });

  const byRank = (x: { c: BuyCapability; score: number }, y: { c: BuyCapability; score: number }) => {
    if (y.score !== x.score) return y.score - x.score;
    const px = priceFrom(x.c) ?? 10n ** 18n;
    const py = priceFrom(y.c) ?? 10n ** 18n;
    return px < py ? -1 : px > py ? 1 : 0;
  };

  const matched = scored.filter((s) => s.score > 0);
  if (matched.length > 0) return matched.sort(byRank).slice(0, limit).map((s) => s.c);

  // Nothing matched the words. People (and models) often describe the TOPIC they want data about ("stablecoins")
  // rather than the kind of service, so never answer "nothing" — fall back to something useful:
  //  • inside a category: that category's best listings, official ones first;
  //  • otherwise: a tour of the marketplace, the best listing from each category.
  const firstParty = (c: BuyCapability) => (c.id.startsWith('monid.') ? 0 : 1);
  const best = (x: BuyCapability, y: BuyCapability) => {
    if (firstParty(y) !== firstParty(x)) return firstParty(y) - firstParty(x);
    const px = priceFrom(x) ?? 10n ** 18n;
    const py = priceFrom(y) ?? 10n ** 18n;
    return px < py ? -1 : px > py ? 1 : 0;
  };
  if (platform) return [...pool].sort(best).slice(0, limit);

  const byPlatform = new Map<string, BuyCapability>();
  for (const c of [...pool].sort(best)) if (!byPlatform.has(c.platform)) byPlatform.set(c.platform, c);
  const order = ['x', 'reddit', 'instagram', 'tiktok', 'youtube', 'linkedin', 'flights', 'browser', 'compute'];
  return [...byPlatform.values()]
    .sort((x, y) => (order.indexOf(x.platform) + 1 || 99) - (order.indexOf(y.platform) + 1 || 99))
    .slice(0, limit);
}

/** Required inputs the caller left out (cheap local check before we spend a network round-trip). */
export function missingRequiredFields(schema: Record<string, unknown>, input: Record<string, unknown>): string[] {
  const required = Array.isArray(schema.required) ? (schema.required as unknown[]).filter((r): r is string => typeof r === 'string') : [];
  return required.filter((f) => input[f] === undefined || input[f] === null || input[f] === '');
}

/** Compact form for the agent's search results (keeps the LLM context small). */
export function toAgentSummary(cap: BuyCapability) {
  const from = priceFrom(cap);
  return {
    id: cap.id,
    title: cap.title,
    platform: cap.platform,
    from: from === null ? 'see quote' : usdLabel(from),
    description: cap.description.length > 160 ? cap.description.slice(0, 157) + '…' : cap.description,
  };
}

/** Full detail the agent needs to build a valid request: the input schema and every price option. */
export function toAgentDetail(cap: BuyCapability) {
  return {
    id: cap.id,
    title: cap.title,
    description: cap.description,
    platform: cap.platform,
    inputSchema: cap.inputSchema,
    pricing: cap.pricing.options.map((o) => ({ for: o.label, price: usdLabel(o.atomic), params: o.params })),
    note: 'The price is confirmed by a live quote before anything is paid.',
  };
}
