/**
 * Reading "how often" out of plain speech: "every Friday", "weekly", "each month", "daily", "once a week".
 *
 * The payment scheduler understands exactly four shapes — a weekday, daily, weekly, monthly — so that is all
 * this accepts. Anything it can't schedule faithfully ("every other week", "every 3 days", "twice a month",
 * "on the 15th", "every weekday") is reported as UNSUPPORTED rather than quietly turned into something else,
 * because a payment that runs on the wrong schedule is a payment the user didn't ask for.
 */

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
const DAY_ALIASES: Record<string, (typeof DAYS)[number]> = {
  sun: 'sunday', mon: 'monday', tue: 'tuesday', tues: 'tuesday', wed: 'wednesday', thu: 'thursday', thur: 'thursday', thurs: 'thursday', fri: 'friday', sat: 'saturday',
};

export type Cadence = { kind: 'ok'; label: string } | { kind: 'unsupported' };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** True if the text talks about repetition at all (used to tell a one-off send from a recurring one). */
export function mentionsRecurrence(text: string): boolean {
  // "every"/"each" only count when followed by a time unit — "send 5 to each of them" is not a schedule.
  return /\b(recurring|standing order|subscription|auto-?pay|(?:every|each)\s+(?:day|week|month|year|other|second|\d+|weekday|weekend|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sunday|monday|tuesday|wednesday|thursday|friday|saturday)|daily|weekly|monthly|fortnightly|biweekly|bi-weekly|quarterly|yearly|annually|per (?:day|week|month)|(?:a|once a|twice a|once per) (?:day|week|month))\b/i.test(text);
}

export function parseCadence(text: string): Cadence | null {
  const t = text.toLowerCase();

  // Things we cannot schedule faithfully — say so instead of guessing.
  if (
    /\b(every other|every second|every \d+|every (?:two|three|four|five|six|ten) |fortnight\w*|bi-?weekly|twice|three times|quarterly|annually|yearly|every weekday|weekdays|weekends?|on the \d{1,2}(?:st|nd|rd|th)|first of|last day|end of (?:the )?month)\b/i.test(t)
  ) {
    return { kind: 'unsupported' };
  }

  const dayNames = [...DAYS, ...Object.keys(DAY_ALIASES)];
  const dayRe = new RegExp(`\\b(?:every|each|on|per)\\s+(${dayNames.join('|')})s?\\b`, 'i');
  const dm = dayRe.exec(t);
  if (dm) {
    const name = dm[1].toLowerCase();
    return { kind: 'ok', label: `Every ${cap(DAY_ALIASES[name] ?? name)}` };
  }
  // "Fridays" on its own after "every" was handled above; a bare weekday with a recurrence word elsewhere:
  if (/\b(every|each|weekly)\b/.test(t)) {
    const bare = new RegExp(`\\b(${DAYS.join('|')})s\\b`, 'i').exec(t);
    if (bare) return { kind: 'ok', label: `Every ${cap(bare[1].toLowerCase())}` };
  }

  if (/\b(daily|every day|each day|once a day|per day|a day)\b/.test(t)) return { kind: 'ok', label: 'Daily' };
  if (/\b(weekly|every week|each week|once a week|per week|a week)\b/.test(t)) return { kind: 'ok', label: 'Weekly' };
  if (/\b(monthly|every month|each month|once a month|per month|a month)\b/.test(t)) return { kind: 'ok', label: 'Monthly' };
  return null;
}

/** A reply that is only a schedule ("weekly", "every Friday", "monthly please"). */
export function bareCadence(text: string): Cadence | null {
  const t = text.trim();
  if (t.length > 40) return null;
  return parseCadence(t);
}

export const CADENCE_OPTIONS = 'daily, weekly, monthly, or a weekday like every Friday';
