// Live agent evaluation — see vitest.eval.config.ts. Run: npm run agent:eval   (set EVAL_USER=<username>, default "chris")
import { readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

for (const line of readFileSync(new URL('../../../../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=([^#\r\n]*)/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}

type Msg = { role: 'user' | 'assistant'; content: string };
interface Turn {
  reply: string;
  action?: { tool: string; render: { type: string; label?: string; count?: number; startIso?: string; endIso?: string; request?: { kind: string; platforms: string[]; what: string; place: string }; options?: { label: string; text: string }[]; chains?: string[]; items?: unknown[] } };
}

/** How many days a statement card actually covers (so "two weeks" and "14 days" are the same thing). */
const coveredDays = (r: { startIso?: string; endIso?: string }) => (r.startIso && r.endIso ? Math.round((new Date(r.endIso).getTime() - new Date(r.startIso).getTime()) / 86_400_000) : -1);
interface Case {
  name: string;
  messages: Msg[];
  /** Return null when it passes, otherwise a short reason. */
  check: (t: Turn) => string | null;
}

const statementDays = (days: number) => (t: Turn) => (t.action?.render.type !== 'statement' ? `no statement card (said: "${t.reply.slice(0, 80)}")` : coveredDays(t.action.render) === days ? null : `wrong period: ${t.action.render.label} (${coveredDays(t.action.render)} days)`);
const statementLabel = (label: string) => (t: Turn) => (t.action?.render.type !== 'statement' ? `no statement card (said: "${t.reply.slice(0, 80)}")` : t.action.render.label === label ? null : `wrong period: ${t.action.render.label}`);

const ARC_CONVO: Msg[] = [
  { role: 'user', content: 'I want to receive on arc' },
  { role: 'assistant', content: 'Here’s the Arc address. Give it to whoever is sending (or use it from your own wallet): USDC sent to it on Arc arrives in your Pexa wallet as USDC on Celo, usually within a minute. I’ll notify you when it lands.' },
  { role: 'assistant', content: '[Showed the Arc deposit address: USDC sent there on Arc arrives in the person’s Pexa wallet as USDC on Celo. The person may be waiting to see if their deposit arrived]' },
];
const noSeller = (t: Turn) => (/instagram|seller|vendor|scam|legit|handle/i.test(t.reply) ? `answered about a seller: "${t.reply.slice(0, 100)}"` : null);
const aboutArrival = (t: Turn) => (/arriv|deposit|not yet|balance|landed|received/i.test(t.reply) ? noSeller(t) : `didn't talk about the deposit: "${t.reply.slice(0, 120)}"`);

const plan = (kind: string, platforms: string, place: RegExp) => (t: Turn) => {
  const r = t.action?.render;
  if (r?.type !== 'research_plan' || !r.request) return `no research plan card (said: "${t.reply.slice(0, 90)}")`;
  if (r.request.kind !== kind) return `wrong kind: ${r.request.kind}`;
  if (r.request.platforms.join(',') !== platforms) return `wrong platforms: ${r.request.platforms.join(',')}`;
  return place.test(r.request.place) ? null : `wrong place: "${r.request.place}"`;
};
const asksCity = (t: Turn) => (t.action && t.action.render.type !== 'ask_location' ? `should have asked for the city, but showed a ${t.action.render.type} card` : /city|where|which (?:area|part|town)|location/i.test(t.reply) ? null : `did not ask for a city: "${t.reply.slice(0, 100)}"`);

const yieldCard = (chain: RegExp | null, coin?: RegExp) => (t: Turn) => {
  const r = t.action?.render;
  if (r?.type !== 'yield_list') return `no yield card (said: "${t.reply.slice(0, 90)}")`;
  if (chain && !(r.chains ?? []).some((c) => chain.test(c))) return `wrong chains: ${(r.chains ?? []).join(',') || 'none'}`;
  // When the person named a coin, the pools listed are for THAT coin (not whatever ranks first).
  if (coin) {
    const bad = ((r.items ?? []) as { symbol?: string }[]).filter((i) => !coin.test(i.symbol ?? ''));
    if (bad.length) return `listed pools for another coin: ${bad.map((b) => b.symbol).join(', ')}`;
  }
  // The card carries every number; the model's own words must not quote a rate.
  return /\d\s*%/.test(t.reply) ? `the reply quoted a rate: "${t.reply.slice(0, 100)}"` : null;
};

const CASES: Case[] = [
  {
    name: 'check: the "Check what people say" button → a Buy quote to search X or Reddit (paid by the person, never automatic)',
    messages: [{ role: 'user', content: 'Search X and Reddit for recent posts about Aave on Celo: hacks, exploits, depegs or withdrawal problems' }],
    check: (t) => (t.action?.render.type === 'buy_quote' ? null : `no Buy quote: ${t.action?.render.type ?? 'no card'} "${t.reply.slice(0, 100)}"`),
  },
  {
    name: 'watch: "watch the Moola cUSD pool on Celo" → saved, nothing deposited or bought',
    messages: [{ role: 'user', content: 'watch the Moola cUSD pool on Celo and tell me if it changes' }],
    // Saved by the app itself: it says so and shows the watchlist, and never offers a deposit.
    check: (t) => (t.action?.render.type === 'watchlist' && /now watching|already watching/i.test(t.reply) && /nothing was deposited/i.test(t.reply) ? null : `didn't confirm watching: ${t.action?.render.type ?? 'no card'} "${t.reply.slice(0, 110)}"`),
  },
  {
    name: 'watch: "add the Aave USDC pool on Celo to my watchlist" → watched, never a deposit',
    messages: [{ role: 'user', content: 'add the Aave USDC pool on Celo to my watchlist' }],
    check: (t) => (t.action?.render.type === 'watchlist' && !/how much/i.test(t.reply) ? null : `unexpected: ${t.action?.render.type ?? 'no card'} "${t.reply.slice(0, 100)}"`),
  },
  {
    name: 'stock watch: "watch $NVDA" → saved with its real price, nothing bought',
    messages: [{ role: 'user', content: 'watch $NVDA' }],
    check: (t) => (t.action?.render.type === 'watchlist' && /now watching \$NVDA/i.test(t.reply) && /nothing was bought/i.test(t.reply) && /\$\d/.test(t.reply) ? null : `didn't confirm: ${t.action?.render.type ?? 'no card'} "${t.reply.slice(0, 120)}"`),
  },
  {
    name: 'stock watch: "refresh the talk about $NVDA" → a small Buy research plan for that one stock',
    messages: [{ role: 'user', content: 'refresh the talk about $NVDA' }],
    check: (t) => (t.action?.render.type === 'research_plan' && t.action.render.request?.kind === 'stocks' && t.action.render.request?.what === '$NVDA' ? null : `no plan: ${t.action?.render.type ?? 'no card'} "${t.reply.slice(0, 100)}"`),
  },
  {
    name: 'stock watch: "stop watching $NVDA" → stopped',
    messages: [{ role: 'user', content: 'stop watching $NVDA' }],
    check: (t) => (/stopped watching \$NVDA/i.test(t.reply) ? null : `didn't confirm: "${t.reply.slice(0, 110)}"`),
  },
  {
    name: 'stock watch: a made-up symbol is refused, not watched',
    messages: [{ role: 'user', content: 'watch $ZZZZQ' }],
    check: (t) => (!t.action && /couldn.t find a stock/i.test(t.reply) ? null : `unexpected: ${t.action?.render.type ?? 'no card'} "${t.reply.slice(0, 110)}"`),
  },
  {
    name: 'watch: "show my watchlist" → a watchlist card',
    messages: [{ role: 'user', content: 'show my watchlist' }],
    check: (t) => (t.action?.render.type === 'watchlist' ? null : `no watchlist card: ${t.action?.render.type ?? 'none'} "${t.reply.slice(0, 80)}"`),
  },
  {
    name: 'watch: "stop watching the Moola cUSD pool" → stopped',
    messages: [{ role: 'user', content: 'stop watching the Moola cUSD pool on Celo' }],
    check: (t) => (/stopped watching/i.test(t.reply) ? null : `didn't confirm: "${t.reply.slice(0, 110)}"`),
  },
  {
    name: 'earn: "deposit $10 into Aave" with no coin → asks USDT or USDC with buttons',
    messages: [{ role: 'user', content: 'deposit $10 into Aave' }],
    check: (t) => (t.action?.render.type === 'ask_choice' && (t.action.render.options ?? []).map((o) => o.label).join(',') === 'USDT,USDC' ? null : `should ask which coin: ${t.action?.render.type ?? 'no card'} "${t.reply.slice(0, 80)}"`),
  },
  {
    name: 'earn: "deposit 10 USDT into Aave" → a Confirm card, or an honest balance/limit message (never a done claim)',
    messages: [{ role: 'user', content: 'deposit 10 USDT into Aave' }],
    check: (t) => (t.action?.render.type === 'earn_preview' || /available|balance|less than|smallest|largest|isn.t switched on|couldn.t/i.test(t.reply) ? null : `unexpected: ${t.action?.render.type ?? 'no card'} "${t.reply.slice(0, 100)}"`),
  },
  {
    name: 'earn: "deposit my USAT into aave" → says USAT is not an Aave market, no card',
    messages: [{ role: 'user', content: 'deposit my USAT into aave' }],
    check: (t) => (t.action ? `showed a ${t.action.render.type} card` : /usat/i.test(t.reply) && /(can.?t|isn.?t|not)/i.test(t.reply) ? null : `didn't explain: "${t.reply.slice(0, 100)}"`),
  },
  {
    name: 'earn: "withdraw everything from Aave" → a Confirm card, or says there is nothing in Aave',
    messages: [{ role: 'user', content: 'withdraw everything from Aave' }],
    check: (t) => (t.action?.render.type === 'earn_preview' || t.action?.render.type === 'ask_choice' || /don.t have any|nothing|in aave/i.test(t.reply) ? null : `unexpected: ${t.action?.render.type ?? 'no card'} "${t.reply.slice(0, 100)}"`),
  },
  {
    name: 'earn: "buy me Tesla stock" → says Pexa can’t buy stocks, shows no card',
    messages: [{ role: 'user', content: 'buy me $50 of Tesla stock' }],
    check: (t) => (t.action ? `showed a ${t.action.render.type} card` : /(can.?t|cannot|don.?t|isn.?t|not able|unable|doesn.?t)/i.test(t.reply) && /stock/i.test(t.reply) ? null : `didn't say it can't: "${t.reply.slice(0, 110)}"`),
  },
  { name: 'yield: "where can I earn on my USDC on Celo?" → yield card, no rate quoted in words', messages: [{ role: 'user', content: 'where can I earn on my USDC on Celo?' }], check: yieldCard(/celo/i, /USDC/i) },
  { name: 'yield: "I have USDT, where can it earn?" → pools for USDT', messages: [{ role: 'user', content: 'I have USDT, where can it earn on Celo?' }], check: yieldCard(/celo/i, /USD₮|USDT/i) },
  { name: 'yield: "best APY on Base" → yield card for Base', messages: [{ role: 'user', content: 'what is the best APY on Base right now?' }], check: yieldCard(/base/i) },
  {
    name: 'yield: "should I put my savings in Aave?" → research, never a recommendation or a promise',
    messages: [{ role: 'user', content: 'should I put all my savings in Aave on Celo?' }],
    check: (t) => (/guarantee|risk[- ]free|completely safe|you should (?:invest|put|deposit)/i.test(t.reply) ? `gave advice or a promise: "${t.reply.slice(0, 120)}"` : null),
  },
  { name: 'statement: "my stuff for the past four days"', messages: [{ role: 'user', content: 'I need my stuff for the past four days' }], check: statementDays(4) },
  { name: 'statement: past 7 days', messages: [{ role: 'user', content: 'give me my transactions for the past 7 days' }], check: statementDays(7) },
  { name: 'statement: past eight days', messages: [{ role: 'user', content: 'I need my receipts for the past eight days' }], check: statementDays(8) },
  { name: 'statement: "everything I did in the last 3 days"', messages: [{ role: 'user', content: 'I want to see everything I did in the last 3 days' }], check: statementDays(3) },
  { name: 'statement: two weeks', messages: [{ role: 'user', content: 'print my payments for the last two weeks' }], check: statementDays(14) },
  { name: 'statement: since a date', messages: [{ role: 'user', content: 'send me my receipts since October 1' }], check: statementLabel('since Oct 1') },
  { name: 'statement: no period → 30 days', messages: [{ role: 'user', content: 'print my statement' }], check: statementDays(30) },
  {
    name: 'statement follow-up: "what about just the past eight days?"',
    messages: [
      { role: 'user', content: 'I want a statement of the last 30 days' },
      { role: 'assistant', content: 'Here’s your statement for the last 30 days: 20 items — $15.24 in, $12.41 out.' },
      { role: 'assistant', content: '[Showed a statement for the last 30 days with 20 items, with Download and Print buttons]' },
      { role: 'user', content: 'what about just the past eight days?' },
    ],
    check: statementDays(8),
  },
  { name: 'deposit: bare "check" after the Arc address', messages: [...ARC_CONVO, { role: 'user', content: 'check' }], check: aboutArrival },
  { name: 'deposit: "has it come in yet?" after the Arc address', messages: [...ARC_CONVO, { role: 'user', content: 'has it come in yet?' }], check: aboutArrival },
  { name: 'deposit: no context, plain question', messages: [{ role: 'user', content: 'has the money I sent from arbitrum come in yet?' }], check: aboutArrival },
  {
    name: 'deposit: "ok check now" after a few turns',
    messages: [...ARC_CONVO, { role: 'user', content: 'ok sent it' }, { role: 'assistant', content: 'Great — I’ll watch for it. Ask me to check any time.' }, { role: 'user', content: 'ok check now' }],
    check: aboutArrival,
  },
  { name: 'routing: "I want to receive on arc" → deposit card', messages: [{ role: 'user', content: 'I want to receive on arc' }], check: (t) => (t.action?.render.type === 'bridge' ? null : `no bridge card: "${t.reply.slice(0, 100)}"`) },
  { name: 'routing: unknown network is called unsupported', messages: [{ role: 'user', content: 'I want to receive on zora' }], check: (t) => (/isn.t supported/i.test(t.reply) ? null : `did not say unsupported: "${t.reply.slice(0, 100)}"`) },
  { name: 'context: "check" with nothing on screen is not a seller check', messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'Hi! How can I help with your money today?' }, { role: 'user', content: 'check' }], check: noSeller },
  { name: 'find: sneaker vendor in Lagos on Instagram → vendors plan for Instagram only', messages: [{ role: 'user', content: 'find me a sneaker vendor in Lagos on Instagram' }], check: plan('vendors', 'instagram', /lagos/i) },
  { name: 'find: "who sells good wigs in Abuja on tiktok?" → TikTok only', messages: [{ role: 'user', content: 'who sells good wigs in Abuja on tiktok?' }], check: plan('vendors', 'tiktok', /abuja/i) },
  {
    name: 'find: no platform named → asks which, with Instagram / TikTok / X buttons (X is never added by itself)',
    messages: [{ role: 'user', content: 'find me a sneaker vendor in Lagos' }],
    check: (t) => {
      if (t.action?.render.type === 'research_plan') return `planned without asking which platform: ${JSON.stringify(t.action.render.request?.platforms)}`;
      if (t.action?.render.type !== 'ask_choice') return `no platform buttons (action: ${t.action?.render.type ?? 'none'}, said: "${t.reply.slice(0, 100)}")`;
      const labels = (t.action.render.options ?? []).map((o) => o.label).join(',');
      return /Instagram/.test(labels) && /TikTok/.test(labels) && /X/.test(labels) ? null : `wrong buttons: ${labels}`;
    },
  },
  {
    name: 'find: tapping "Search TikTok" → plan for TikTok',
    messages: [
      { role: 'user', content: 'find me a sneaker vendor in Lagos' },
      { role: 'assistant', content: 'Which platform should I search for sellers — Instagram, TikTok or X?' },
      { role: 'assistant', content: '[Showed buttons for the person to choose a platform: Instagram, TikTok, X or all three]' },
      { role: 'user', content: 'Search TikTok' },
    ],
    check: plan('vendors', 'tiktok', /lagos/i),
  },
  {
    name: 'find: tapping "Search Instagram, TikTok and X" → all three, in order',
    messages: [
      { role: 'user', content: 'who sells good phones in Abuja?' },
      { role: 'assistant', content: 'Which platform should I search for sellers — Instagram, TikTok or X?' },
      { role: 'user', content: 'Search Instagram, TikTok and X' },
    ],
    check: plan('vendors', 'instagram,tiktok,x', /abuja/i),
  },
  { name: 'find: graphic designer in Nairobi → hire on LinkedIn', messages: [{ role: 'user', content: 'I need a graphic designer in Nairobi' }], check: plan('hire', 'linkedin', /nairobi/i) },
  { name: 'find: tailor in Yaba → hire on Instagram', messages: [{ role: 'user', content: 'find me a good tailor in Yaba' }], check: plan('hire', 'instagram', /yaba/i) },
  { name: 'find: no city → asks which city', messages: [{ role: 'user', content: 'I need a graphic designer' }], check: asksCity },
  { name: 'find: "near me" → asks which city', messages: [{ role: 'user', content: 'find me a phone plug near me' }], check: asksCity },
  {
    name: 'find: "closest to me" → asks, and offers the Use-my-location button',
    messages: [{ role: 'user', content: 'I need the best graphic designer close to me' }],
    check: (t) => (t.action?.render.type === 'ask_location' ? asksCity(t) : `no location button (action: ${t.action?.render.type ?? 'none'}, said: "${t.reply.slice(0, 90)}")`),
  },
  {
    name: 'find: "graphic designer near me" (no verb) → asks, with the button',
    messages: [{ role: 'user', content: 'graphic designer near me' }],
    check: (t) => (t.action?.render.type === 'ask_location' ? asksCity(t) : `no location button (action: ${t.action?.render.type ?? 'none'}, said: "${t.reply.slice(0, 90)}")`),
  },
  {
    name: 'find: "closest designer to me" never becomes a plan with "me" as the place',
    messages: [{ role: 'user', content: 'closest designer to me' }],
    check: (t) => (t.action?.render.type === 'research_plan' ? `made a plan for place "${t.action.render.request?.place}"` : t.action?.render.type === 'ask_location' ? null : `no location button (said: "${t.reply.slice(0, 90)}")`),
  },
  {
    name: 'find: "My area is Yaba, Lagos" (the button’s message) → plan for Yaba',
    messages: [
      { role: 'user', content: 'I need the best graphic designer close to me' },
      { role: 'assistant', content: 'Which area or city are you in?' },
      { role: 'assistant', content: '[Showed a button for the person to share their area (a neighbourhood name, not exact coordinates), because the assistant asked where they are]' },
      { role: 'user', content: 'My area is Yaba, Lagos' },
    ],
    check: plan('hire', 'linkedin', /yaba/i),
  },
  {
    name: 'find: the city arrives in the next message',
    messages: [
      { role: 'user', content: 'I need a graphic designer' },
      { role: 'assistant', content: 'Sure — which city should I look in?' },
      { role: 'user', content: 'Lagos' },
    ],
    check: plan('hire', 'linkedin', /lagos/i),
  },
  {
    name: 'find: the "Check closer" button looks the account up on Instagram',
    messages: [{ role: 'user', content: 'Check the Instagram account @lagos_kicks before I pay: is it legit?' }],
    check: (t) => (t.action?.render.type === 'buy_quote' ? null : `did not set up the lookup (said: "${t.reply.slice(0, 100)}")`),
  },
  {
    name: 'find: "which should I pick and what should I offer?" uses the ratings and the suggested offer',
    messages: [
      { role: 'user', content: 'find me a sneaker vendor in Lagos' },
      { role: 'assistant', content: '[Showed a vendor shortlist for sneakers in Lagos: @fair_kicks (looks solid, rated 4.4/5, 3 km away, prices ₦38k–₦42k (near usual), suggested opening offer ₦37k); @dear_kicks (mixed signals, rated 3.2/5, 2 km away, prices ₦60k–₦72k (above usual), suggested opening offer ₦53k). Typical price: ₦30k–₦60k (around ₦40k). Each card shows ratings, prices, negotiation advice and a message to copy. Pexa does not pay vendors — the person deals with them directly]' },
      { role: 'user', content: 'which one should I pick and what should I offer?' },
    ],
    check: (t) => (/fair_kicks/i.test(t.reply) && /37k|₦37/i.test(t.reply) ? (/wallet address|send them|I.ll pay/i.test(t.reply) ? `talked about paying: "${t.reply.slice(0, 120)}"` : null) : `did not use the shortlist: "${t.reply.slice(0, 140)}"`),
  },
  {
    name: 'find: "pay this vendor for me" → Pexa does not pay vendors',
    messages: [
      { role: 'user', content: 'find me a sneaker vendor in Lagos' },
      { role: 'assistant', content: '[Showed a vendor shortlist for sneakers in Lagos: @fair_kicks (looks solid, rated 4.4/5, 3 km away, prices ₦38k–₦42k (near usual), suggested opening offer ₦37k). Typical price: ₦30k–₦60k (around ₦40k). Each card shows ratings, prices, negotiation advice and a message to copy. Pexa does not pay vendors — the person deals with them directly]' },
      { role: 'user', content: 'ok pay this vendor for me' },
    ],
    check: (t) => (t.action ? `showed a ${t.action.render.type} card` : /(doesn.t|does not|don.t|can.t|cannot|only).{0,60}(pay|research)/i.test(t.reply) ? null : `did not say it doesn't pay vendors: "${t.reply.slice(0, 140)}"`),
  },
  {
    name: 'find: "is @x legit?" stays a single-account check',
    messages: [{ role: 'user', content: 'is @lagos_kicks legit?' }],
    check: (t) => (t.action?.render.type === 'research_plan' ? 'treated a single account as a search' : null),
  },
];

const OUT = process.env.EVAL_OUT;
const log = (s: string) => {
  if (OUT) appendFileSync(OUT, s + '\n');
  console.log(s);
};

describe('agent evaluation (live)', () => {
  it('runs every case and reports', async () => {
    if (OUT) writeFileSync(OUT, '');
    const runStart = new Date();
    const { getDb, schema } = await import('@/lib/db');
    const { eq, and, gte } = await import('drizzle-orm');
    const { runAgentTurn } = await import('@/lib/agent/runtime');
    // A flaky connection is not the agent being unintelligent: retry lookups, and retry a case whose answer was an infrastructure failure.
    const retry = async <T,>(fn: () => Promise<T>, tries = 6): Promise<T> => {
      let last: unknown;
      for (let i = 0; i < tries; i++) {
        try {
          return await fn();
        } catch (e) {
          last = e;
          await new Promise((r) => setTimeout(r, 2500));
        }
      }
      throw last;
    };
    const [prof] = await retry(() => getDb().select().from(schema.profiles).where(eq(schema.profiles.username, process.env.EVAL_USER ?? 'chris')).limit(1));
    const infraFailure = (r: string) => /AI side isn.t responding|couldn.t (?:read the chain|put the statement|get a deposit|prepare)|\(reason:|try again in a moment/i.test(r);
    let pass = 0;
    const failures: string[] = [];
    const { withSettledProfile } = await import('./profile-fixture');
    await withSettledProfile(prof.userId, async () => {
    for (const c of CASES) {
      const t0 = Date.now();
      let why: string | null;
      let said = '';
      try {
        let turn = (await runAgentTurn({ userId: prof.userId, messages: c.messages })) as Turn | null;
        for (let i = 0; i < 3 && turn && infraFailure(turn.reply); i++) {
          await new Promise((r) => setTimeout(r, 4000));
          turn = (await runAgentTurn({ userId: prof.userId, messages: c.messages })) as Turn | null;
        }
        said = turn?.reply ?? '(no reply)';
        why = turn ? c.check(turn) : 'no turn returned';
      } catch (e) {
        why = `threw: ${(e as Error).message.slice(0, 100)}`;
      }
      if (why === null) pass++;
      else failures.push(`${c.name} — ${why}`);
      log(`${why === null ? 'PASS' : 'FAIL'}  ${c.name}  (${Date.now() - t0}ms)${why ? `\n        ${why}` : `\n        said: ${said.slice(0, 110)}`}`);
    }
    });
    // The eval only ever makes plans (nothing is bought); tidy them away — and any watch it created (its alerts go with it).
    await retry(() => getDb().delete(schema.yieldWatches).where(and(eq(schema.yieldWatches.userId, prof.userId), gte(schema.yieldWatches.createdAt, runStart))));
    await retry(() => getDb().delete(schema.tickerWatches).where(and(eq(schema.tickerWatches.userId, prof.userId), gte(schema.tickerWatches.createdAt, runStart))));
    await retry(() => getDb().delete(schema.researchSessions).where(and(eq(schema.researchSessions.userId, prof.userId), eq(schema.researchSessions.status, 'PLANNED'))));
    log(`\n${pass}/${CASES.length} passed`);
    expect(failures, failures.join('\n')).toEqual([]);
  });
});
