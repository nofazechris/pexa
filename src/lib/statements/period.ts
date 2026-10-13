/**
 * "Print my statement for the last 30 days." Working out which period a person means, and whether they are asking for a statement
 * at all (as opposed to one Buy receipt, or a balance). Pure and tested; `now` is passed in so results never depend on the clock.
 *
 * Two ways in: the agent's `get_statement` tool passes an exact period (`periodFromArgs` — the AI reads "the past four days" and
 * asks for days = 4), and a small fast path here recognises the plain phrasings so the common cases don't wait for the AI.
 */

export interface Period {
  start: Date;
  end: Date;
  /** For the heading, e.g. "the last 30 days" or "September 2026". */
  label: string;
  days: number;
}

const DAY = 24 * 60 * 60 * 1000;
export const MAX_STATEMENT_DAYS = 366;
export const DEFAULT_STATEMENT_DAYS = 30;

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  twenty: 20, thirty: 30, forty: 40, sixty: 60, ninety: 90, a: 1, an: 1,
};

const startOfUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const monthName = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dayLabel = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

function rolling(now: Date, days: number, label: string): Period {
  const d = Math.min(Math.max(Math.round(days), 1), MAX_STATEMENT_DAYS);
  return { start: new Date(now.getTime() - d * DAY), end: now, label, days: d };
}

function unitDays(unit: string, count: number): number {
  const u = unit.replace(/s$/, '');
  return u === 'day' ? count : u === 'week' ? count * 7 : u === 'month' ? count * 30 : count * 365;
}

/** "the last 4 days", "the last 1 week" */
function rollingLabel(count: number, unit: string): string {
  const u = unit.replace(/s$/, '');
  return `the last ${count} ${u}${count === 1 ? '' : 's'}`;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** The period asked for in the text, or null when none was named. */
export function parsePeriod(text: string, now: Date): Period | null {
  const t = text.toLowerCase();

  // "the last 4 days", "past four days", "for 8 days", "over the last 2 weeks", "in the last 3 months", "4 days"
  const n = /(?:\b(?:last|past|previous|prior|for|over|within|during|in)\b\s+(?:the\s+)?(?:\b(?:last|past|previous|prior)\b\s+)?|\b)(\d{1,3}|[a-z]+)[\s-]+(day|days|week|weeks|month|months|year|years)\b(?:\s+ago)?/.exec(t);
  if (n) {
    const count = /^\d+$/.test(n[1]) ? Number(n[1]) : NUMBER_WORDS[n[1]];
    if (count) return rolling(now, unitDays(n[2], count), rollingLabel(count, n[2]));
  }

  if (/\b(?:last|past)\s+year\b/.test(t)) return rolling(now, 365, 'the last 12 months');
  if (/\b(?:this|the)\s+year\b|\byear to date\b|\bytd\b/.test(t)) {
    const jan1 = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    return { start: jan1, end: now, label: `${now.getUTCFullYear()} so far`, days: Math.max(1, Math.ceil((now.getTime() - jan1.getTime()) / DAY)) };
  }
  if (/\blast month\b|\bprevious month\b/.test(t)) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return { start, end, label: monthName(start), days: Math.round((end.getTime() - start.getTime()) / DAY) };
  }
  if (/\bthis month\b|\bmonth to date\b/.test(t)) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return { start, end: now, label: `${monthName(start)} so far`, days: Math.max(1, Math.ceil((now.getTime() - start.getTime()) / DAY)) };
  }
  if (/\blast week\b|\bpast week\b|\bprevious week\b/.test(t)) return rolling(now, 7, 'the last 7 days');
  if (/\bthis week\b/.test(t)) {
    const today = startOfUtcDay(now);
    const sinceMonday = (today.getUTCDay() + 6) % 7;
    return { start: new Date(today.getTime() - sinceMonday * DAY), end: now, label: 'this week', days: sinceMonday + 1 };
  }
  if (/\byesterday\b/.test(t)) {
    const end = startOfUtcDay(now);
    return { start: new Date(end.getTime() - DAY), end, label: 'yesterday', days: 1 };
  }
  if (/\btoday\b/.test(t)) return { start: startOfUtcDay(now), end: now, label: 'today', days: 1 };

  // "since Oct 1", "from October 1st", "since 1 October"
  const since = /\b(?:since|from|starting|beginning)\s+(?:the\s+)?(?:(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]{3,9})|([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?)\b/.exec(t);
  if (since) {
    const day = Number(since[1] ?? since[4]);
    const monthIdx = MONTHS.indexOf((since[2] ?? since[3]).slice(0, 3));
    if (monthIdx >= 0 && day >= 1 && day <= 31) {
      let start = new Date(Date.UTC(now.getUTCFullYear(), monthIdx, day));
      if (start.getTime() > now.getTime()) start = new Date(Date.UTC(now.getUTCFullYear() - 1, monthIdx, day));
      const days = Math.ceil((now.getTime() - start.getTime()) / DAY);
      if (days >= 1) return days > MAX_STATEMENT_DAYS ? rolling(now, MAX_STATEMENT_DAYS, 'the last 12 months') : { start, end: now, label: `since ${dayLabel(start)}`, days };
    }
  }

  if (/\b(?:all time|everything|ever|since the (?:start|beginning))\b/.test(t)) return rolling(now, MAX_STATEMENT_DAYS, 'the last 12 months (the longest a statement covers)');
  return null;
}

/** Does the text talk about a period of time at all (even one we couldn't read)? */
export function mentionsTime(text: string): boolean {
  return /\b(day|days|week|weeks|month|months|year|years|today|yesterday|since|ago|between|from|until|till|hours?|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|june|july|august|september|october|november|december)\b/i.test(text);
}

/**
 * The period the agent's tool was asked for: `days` (a rolling window ending now) or an explicit `from`/`to` date range
 * (YYYY-MM-DD, `to` inclusive). Returns an error message when the dates make no sense — never silently a different period.
 */
export function periodFromArgs(args: { days?: number; from?: string; to?: string }, now: Date): { ok: true; period: Period } | { ok: false; error: string } {
  const isDate = (s: string | undefined): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s + 'T00:00:00Z').getTime());
  if (args.from !== undefined || args.to !== undefined) {
    if (args.from !== undefined && !isDate(args.from)) return { ok: false, error: '`from` must be a date like 2026-10-01.' };
    if (args.to !== undefined && !isDate(args.to)) return { ok: false, error: '`to` must be a date like 2026-10-14.' };
    const start = args.from ? new Date(args.from + 'T00:00:00Z') : new Date(now.getTime() - DEFAULT_STATEMENT_DAYS * DAY);
    const endDay = args.to ? new Date(args.to + 'T00:00:00Z') : startOfUtcDay(now);
    const end = args.to ? new Date(Math.min(endDay.getTime() + DAY, now.getTime())) : now;
    if (end.getTime() <= start.getTime()) return { ok: false, error: 'The end date is before the start date.' };
    const span = Math.ceil((end.getTime() - start.getTime()) / DAY);
    if (span > MAX_STATEMENT_DAYS) return { ok: false, error: `A statement can cover at most ${MAX_STATEMENT_DAYS} days.` };
    return { ok: true, period: { start, end, days: span, label: args.to ? `${dayLabel(start)} – ${dayLabel(endDay)}` : `since ${dayLabel(start)}` } };
  }
  const days = args.days === undefined ? DEFAULT_STATEMENT_DAYS : Math.round(args.days);
  if (!Number.isFinite(days) || days < 1) return { ok: false, error: '`days` must be at least 1.' };
  const d = Math.min(days, MAX_STATEMENT_DAYS);
  return { ok: true, period: rolling(now, d, d === 1 ? 'the last 24 hours' : `the last ${d} days`) };
}

/** The thing being asked for: a statement/receipts/history of money movement over time. */
const ASKS_FOR_STATEMENT = /\b(?:statements?|bank statement|account statement|transaction (?:history|report|log)|payment (?:history|report)|activity report|export (?:my )?(?:transactions|payments|history|activity)|download (?:my )?(?:transactions|payments|history|statement|receipts)|print (?:my )?(?:transactions|payments|history|statement|receipts)|summary of (?:my )?(?:spending|payments|transactions|activity)|spending summary)\b/i;
const RECEIPTS_PLURAL = /\b(?:my\s+)?receipts\b/i;
/** "the receipt for that purchase", "what did it find" — one Buy result, not a statement. */
const ONE_RECEIPT = /\b(?:receipt|result)\s+(?:for|of|from)\s+(?:that|this|the|my last|it)\b|\bwhat did (?:it|that) (?:find|buy)\b/i;

export interface StatementIntent {
  period: Period;
  /** The person named the period (otherwise we used the last 30 days). */
  named: boolean;
}

/**
 * The fast path for plain requests. It only answers when it is SURE: the words clearly ask for a statement AND either the period
 * was read or no time was mentioned at all. A period it can't read ("for the weekend before last") goes to the agent, which can.
 */
export function parseStatementIntent(text: string, now: Date): StatementIntent | null {
  const t = text.trim();
  if (!t || t.length > 200) return null;
  if (ONE_RECEIPT.test(t)) return null;
  const period = parsePeriod(t, now);
  const wants = ASKS_FOR_STATEMENT.test(t) || RECEIPTS_PLURAL.test(t) || (/\b(?:what|how much)\s+did i\s+(?:spend|send|pay|receive|get)\b/i.test(t) && period !== null);
  if (!wants) return null;
  if (period === null && mentionsTime(t)) return null; // they named a period we couldn't read: let the agent work it out
  return { period: period ?? rolling(now, DEFAULT_STATEMENT_DAYS, `the last ${DEFAULT_STATEMENT_DAYS} days`), named: period !== null };
}
