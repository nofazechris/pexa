/**
 * "What do you do?" — the agent introduces itself.
 *
 * Built by the app, not improvised by the AI model, so it only ever names things Pexa really does for THIS user
 * (Buy exists only on mainnet; naira only when it's public) and every example is a sentence that works as written.
 * Each feature carries an example the user can tap to try it straight away.
 */

export interface IntroFeature {
  title: string;
  description: string;
  /** A sentence the user can send as-is to try it. */
  example: string;
}

export interface IntroAvailability {
  /** Celo's Buy marketplace works (mainnet only). */
  buy: boolean;
  /** Naira ↔ USDT conversion is public. */
  naira: boolean;
}

const MAX_LEN = 90;

/**
 * Is this message asking who/what the agent is or what it can do? Deliberately conservative: short messages that are
 * plainly about the assistant itself, so "what is Reddit saying about celo" or "what do you think of @joyful" are not caught.
 */
export function isIntroRequest(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[?!.]+$/g, '').replace(/\s+/g, ' ');
  if (!t || t.length > MAX_LEN) return false;
  const patterns: RegExp[] = [
    /^(hi|hey|hello|yo)[ ,]*(pexa|there)?[ ,]*(who are you|what are you|what do you do|what can you do)( for me| here)?$/,
    /^(who|what) are you( exactly)?$/,
    /^(what|who)('s| is) (pexa|this|this app|this agent)$/,
    /^(what|how) (can|could|would) (you|pexa) (do|help)( me| for me| here| exactly)?$/,
    /^how (do|does) (you|pexa) work$/,
    /^what (do|does) (you|pexa) do( for me| here| exactly)?$/,
    /^what can i do (here|with (this|pexa|you))\b/,
    /^(please )?(introduce|tell me about|describe|explain) (yourself|pexa|what you do|this app|the app)\b/,
    /^(what|which) (are|is) (your|the) (features?|capabilit(y|ies)|abilit(y|ies)|functions?)\b/,
    /^(what|how) (does|do) (pexa|this|this app|it) (work|do)\b/,
    /^(help|help me|get started|getting started|show me around|give me a (tour|demo)|demo|tour)$/,
    /^(i('m| am) (new|lost|confused)|how do i (start|use (this|pexa)))\b/,
    /^what (are )?(you|pexa) (for|about)\b/,
  ];
  return patterns.some((p) => p.test(t));
}

export function introFeatures(a: IntroAvailability): IntroFeature[] {
  const f: IntroFeature[] = [
    { title: 'Send money', description: 'Pay anyone on Pexa by @username, in USDC.', example: 'Send 5 USDC to @joyful' },
    { title: 'Ask for money', description: 'Request a payment from someone.', example: 'Request $20 from @joyful' },
    { title: 'Recurring payments', description: 'Rent, subscriptions, allowances — on a schedule you set.', example: 'Pay @joyful $5 every Friday' },
    { title: 'Add money', description: 'Get your wallet address and see the deposit the moment it lands.', example: 'Add money to my wallet' },
    { title: 'Balance & activity', description: 'See what you have and what moved.', example: 'Show my recent payments' },
    { title: 'Save automatically', description: 'Set money aside in vaults, or save a share of everything you receive.', example: 'Save 10% of every payment I get' },
  ];
  if (a.buy) {
    f.push({ title: 'Check before you pay', description: 'I look up a vendor’s profile and what people say about them before you send money.', example: 'Is this Instagram vendor legit? @sneakerplug_ng' });
    f.push({ title: 'Look things up', description: 'I can buy live posts, flights or a cloud computer for a few cents, with your approval.', example: 'What is Reddit saying about Celo today?' });
  }
  if (a.naira) f.push({ title: 'Naira', description: 'Buy and sell USDT with naira.', example: 'How much is $50 in naira?' });
  return f;
}

export function buildIntro(a: IntroAvailability): { reply: string; features: IntroFeature[] } {
  return {
    reply:
      'I’m Pexa Agent — your financial agent on Celo. Just tell me what you want to do with your money and I’ll set it up, show you a preview, and only move anything when you tap Confirm. Here’s what I can do right now. Tap one to try it, or tell me in your own words — are you ready?',
    features: introFeatures(a),
  };
}
