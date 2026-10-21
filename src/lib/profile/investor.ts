/**
 * Getting to know the person before talking about investing: how much ups and downs they can live with, when they might need the
 * money, and roughly how much they could put in. Three short questions, asked once, answered with a tap or a few words, skippable.
 * What they say shapes what Pexa shows (a cautious person isn't shown high-risk pools) and how it words things. It is what they
 * told us — never a judgement about them, and never advice. Pure.
 */

export type Risk = 'cautious' | 'balanced' | 'bold';
export type Horizon = 'short' | 'medium' | 'long';

export interface InvestorProfile {
  risk: Risk | null;
  horizon: Horizon | null;
  /** Roughly what they could put in, in dollars. */
  amountUsd: number | null;
  /** They chose not to answer: use sensible defaults and don't ask again. */
  skipped: boolean;
}

export const EMPTY_PROFILE: InvestorProfile = { risk: null, horizon: null, amountUsd: null, skipped: false };

export type Step = 'risk' | 'horizon' | 'amount';

export interface Choice {
  label: string;
  text: string;
}

/** Fixed question texts. Each carries its own wording so the answer can be recognised in the chat history. */
export const QUESTION: Record<Step, string> = {
  risk: 'Before I research anything for you — how do you feel about money going up and down?',
  horizon: 'When might you need this money back?',
  amount: 'Roughly how much could you put in? A rough number is fine, like 200 (it only helps me tell you what’s realistic).',
};

export const CHOICES: Record<Step, Choice[]> = {
  risk: [
    { label: 'Play it safe', text: 'I’d rather play it safe' },
    { label: 'A balance', text: 'A balance of safe and growth' },
    { label: 'Go for growth', text: 'I can handle big swings for growth' },
    { label: 'Skip for now', text: 'Skip the questions' },
  ],
  horizon: [
    { label: 'Within a year', text: 'Within a year' },
    { label: '1 to 3 years', text: 'In one to three years' },
    { label: '3+ years', text: 'More than three years' },
    { label: 'Skip for now', text: 'Skip the questions' },
  ],
  amount: [{ label: 'Skip for now', text: 'Skip the questions' }],
};

/** Which question the assistant's last message asked, if any. */
export function stepAsked(previousAssistant: string | undefined): Step | null {
  if (!previousAssistant) return null;
  if (previousAssistant.includes(QUESTION.risk)) return 'risk';
  if (previousAssistant.includes(QUESTION.horizon)) return 'horizon';
  if (previousAssistant.includes(QUESTION.amount)) return 'amount';
  return null;
}

export const isSkip = (text: string) => /\b(skip|not now|later|rather not|no thanks|never ?mind)\b/i.test(text);

export function readRisk(text: string): Risk | null {
  const t = text.toLowerCase();
  // "A balance of safe and growth" names both ends, so the middle is checked first.
  if (/\b(balance|balanced|moderate|mix|middle|both|medium)\b/.test(t)) return 'balanced';
  if (/\b(safe|cautious|conservative|careful|low[- ]risk|protect|no risk|secure)\b/.test(t)) return 'cautious';
  if (/\b(growth|bold|aggressive|big swings|high[- ]risk|risk it|go big|swing)\b/.test(t)) return 'bold';
  return null;
}

export function readHorizon(text: string): Horizon | null {
  const t = text.toLowerCase();
  if (/\b(within a year|under a year|less than a year|few months|soon|short|next year|6 months|this year)\b/.test(t)) return 'short';
  if (/\b(1 ?(?:to|-|–) ?3|one to three|couple of years|two years|2 years|medium)\b/.test(t)) return 'medium';
  if (/\b(more than (?:three|3)|3\+|three plus|long|decade|retire\w*|5 years|10 years|many years|years)\b/.test(t)) return 'long';
  return null;
}

/** "200", "$1,500", "5k", "2.5k" → dollars. Null when there is no number or it is out of any sensible range. */
export function readAmount(text: string): number | null {
  const m = text.toLowerCase().replace(/,/g, '').match(/\$?\s*(\d+(?:\.\d+)?)\s*(k|m)?\b/);
  if (!m) return null;
  const n = Number(m[1]) * (m[2] === 'k' ? 1_000 : m[2] === 'm' ? 1_000_000 : 1);
  return Number.isFinite(n) && n >= 1 && n <= 100_000_000 ? Math.round(n) : null;
}

/** The first question still unanswered, or null when the profile is done (or skipped). */
export function nextStep(p: InvestorProfile): Step | null {
  if (p.skipped) return null;
  if (p.risk === null) return 'risk';
  if (p.horizon === null) return 'horizon';
  if (p.amountUsd === null) return 'amount';
  return null;
}

export const isComplete = (p: InvestorProfile) => nextStep(p) === null;

/** Fold an answer into the profile. `ok` is false when the answer wasn't understood, so the question can be asked again plainly. */
export function applyAnswer(p: InvestorProfile, step: Step, text: string): { profile: InvestorProfile; ok: boolean } {
  if (isSkip(text)) return { profile: { ...p, skipped: true }, ok: true };
  if (step === 'risk') {
    const risk = readRisk(text);
    return risk ? { profile: { ...p, risk }, ok: true } : { profile: p, ok: false };
  }
  if (step === 'horizon') {
    const horizon = readHorizon(text);
    return horizon ? { profile: { ...p, horizon }, ok: true } : { profile: p, ok: false };
  }
  const amountUsd = readAmount(text);
  return amountUsd !== null ? { profile: { ...p, amountUsd }, ok: true } : { profile: p, ok: false };
}

const RISK_WORDS: Record<Risk, string> = { cautious: 'play-it-safe', balanced: 'balanced', bold: 'growth-minded' };
const HORIZON_WORDS: Record<Horizon, string> = { short: 'within a year', medium: 'in one to three years', long: 'in more than three years' };

/** One sentence reflecting back what they told us. */
export function summary(p: InvestorProfile): string {
  if (p.skipped && p.risk === null) return 'You skipped the questions, so I’ll use middle-of-the-road settings.';
  const parts = [p.risk ? `a ${RISK_WORDS[p.risk]} approach` : null, p.horizon ? `needing the money ${HORIZON_WORDS[p.horizon]}` : null, p.amountUsd !== null ? `about $${p.amountUsd.toLocaleString('en-US')} to put in` : null].filter(Boolean);
  return parts.length ? `You told me: ${parts.join(', ')}.` : 'I don’t know anything about your investing style yet.';
}

/** How risky a pool may be before it is hidden for this person. Everyone can ask to see the rest. */
export function maxPoolRisk(p: InvestorProfile | null): 'lower' | 'medium' | 'high' {
  if (!p || p.skipped || !p.risk) return 'medium';
  return p.risk === 'bold' ? 'high' : 'medium';
}

/** The smallest pool a person is shown, in dollars deposited. Cautious people don't see small pools. */
export function minPoolSize(p: InvestorProfile | null): number | undefined {
  return p && !p.skipped && p.risk === 'cautious' ? 1_000_000 : undefined;
}
