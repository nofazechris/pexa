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
  action?: { tool: string; render: { type: string; label?: string; count?: number; startIso?: string; endIso?: string } };
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

const CASES: Case[] = [
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
];

const OUT = process.env.EVAL_OUT;
const log = (s: string) => {
  if (OUT) appendFileSync(OUT, s + '\n');
  console.log(s);
};

describe('agent evaluation (live)', () => {
  it('runs every case and reports', async () => {
    if (OUT) writeFileSync(OUT, '');
    const { getDb, schema } = await import('@/lib/db');
    const { eq } = await import('drizzle-orm');
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
    log(`\n${pass}/${CASES.length} passed`);
    expect(failures, failures.join('\n')).toEqual([]);
  });
});
