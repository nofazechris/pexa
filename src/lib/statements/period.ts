/**
 * "Print my statement for the last 30 days." Reading which period a person means, and whether they are asking for a statement at
 * all (as opposed to one Buy receipt, or a balance). Pure and tested; `now` is passed in so the result never depends on the clock.
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

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fourteen: 14, fifteen: 15, twenty: 20, thirty: 30, sixty: 60, ninety: 90 };

const startOfUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const monthName = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

function rolling(now: Date, days: number, label: string): Period {
  const d = Math.min(Math.max(Math.round(days), 1), MAX_STATEMENT_DAYS);
  return { start: new Date(now.getTime() - d * DAY), end: now, label, days: d };
}

/** The period asked for in the text, or null when none was named. */
export function parsePeriod(text: string, now: Date): Period | null {
  const t = text.toLowerCase();

  const n = /\b(?:last|past|previous|prior)\s+(\d{1,3}|[a-z]+)\s+(day|days|week|weeks|month|months|year|years)\b/.exec(t);
  if (n) {
    const count = /^\d+$/.test(n[1]) ? Number(n[1]) : NUMBER_WORDS[n[1]];
    if (count) {
      const unit = n[2].replace(/s$/, '');
      const days = unit === 'day' ? count : unit === 'week' ? count * 7 : unit === 'month' ? count * 30 : count * 365;
      return rolling(now, days, `the last ${count} ${unit}${count === 1 ? '' : 's'}`);
    }
  }
  if (/\b(?:last|past)\s+year\b/.test(t) || /\b(?:this|the)\s+year\b|\byear to date\b|\bytd\b/.test(t)) {
    const jan1 = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    if (/\b(?:last|past)\s+year\b/.test(t)) return rolling(now, 365, 'the last 12 months');
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
    const start = new Date(today.getTime() - sinceMonday * DAY);
    return { start, end: now, label: 'this week', days: sinceMonday + 1 };
  }
  if (/\byesterday\b/.test(t)) {
    const end = startOfUtcDay(now);
    return { start: new Date(end.getTime() - DAY), end, label: 'yesterday', days: 1 };
  }
  if (/\btoday\b/.test(t)) return { start: startOfUtcDay(now), end: now, label: 'today', days: 1 };
  if (/\b(?:all time|everything|ever|since the (?:start|beginning))\b/.test(t)) return rolling(now, MAX_STATEMENT_DAYS, 'the last 12 months (the longest a statement covers)');
  return null;
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

export function parseStatementIntent(text: string, now: Date): StatementIntent | null {
  const t = text.trim();
  if (!t || t.length > 200) return null;
  if (ONE_RECEIPT.test(t)) return null;
  const period = parsePeriod(t, now);
  const wants = ASKS_FOR_STATEMENT.test(t) || RECEIPTS_PLURAL.test(t) || (/\b(?:what|how much)\s+did i\s+(?:spend|send|pay|receive|get)\b/i.test(t) && period !== null);
  if (!wants) return null;
  return { period: period ?? rolling(now, DEFAULT_STATEMENT_DAYS, `the last ${DEFAULT_STATEMENT_DAYS} days`), named: period !== null };
}
