// Live check of the investing conversation: getting to know the person once, stock research, and the honest "I can't trade".
// Run: npm run agent:eval   (real model + database; the account's real profile is saved first and put back afterwards)
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

for (const line of readFileSync(new URL('../../../../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=([^#\r\n]*)/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}

type Msg = { role: 'user' | 'assistant'; content: string };
interface Turn {
  reply: string;
  action?: { tool: string; render: { type: string; options?: { label: string; text: string }[]; request?: { kind: string; what: string } } };
}

describe('investing conversation (live)', () => {
  it('asks three questions once, then plans stock research from the original request', async () => {
    const { getDb, schema } = await import('@/lib/db');
    const { eq } = await import('drizzle-orm');
    const { runAgentTurn } = await import('@/lib/agent/runtime');
    const { getInvestorProfile, saveInvestorProfile, resetInvestorProfile } = await import('@/lib/profile/service');
    const { QUESTION } = await import('@/lib/profile/investor');
    const [prof] = await getDb().select().from(schema.profiles).where(eq(schema.profiles.username, process.env.EVAL_USER ?? 'chris')).limit(1);
    const userId = prof.userId;
    const original = await getInvestorProfile(userId);
    const turn = async (messages: Msg[]) => (await runAgentTurn({ userId, messages })) as Turn;

    try {
      await resetInvestorProfile(userId);
      const ask = 'Can you research the stocks that are going viral and doing well right now?';

      // 1. A new person is asked how they feel about risk first, with buttons.
      const t1 = await turn([{ role: 'user', content: ask }]);
      expect(t1.reply).toContain(QUESTION.risk);
      expect(t1.action?.render.type).toBe('ask_choice');
      expect((t1.action?.render.options ?? []).map((o) => o.label)).toContain('Play it safe');

      // 2. Their answer is saved and the next question follows.
      const h2: Msg[] = [{ role: 'user', content: ask }, { role: 'assistant', content: t1.reply }, { role: 'user', content: 'I’d rather play it safe' }];
      const t2 = await turn(h2);
      expect(t2.reply).toContain(QUESTION.horizon);
      expect((await getInvestorProfile(userId))?.risk).toBe('cautious');

      // 3. An answer it can't read is asked again, plainly, without losing the place.
      const t3 = await turn([...h2, { role: 'assistant', content: t2.reply }, { role: 'user', content: 'purple' }]);
      expect(t3.reply).toMatch(/didn.t quite catch that/i);
      expect(t3.reply).toContain(QUESTION.horizon);

      // 4. The last answer finishes the profile and carries on with what they first asked: a stock research plan.
      const h4: Msg[] = [...h2, { role: 'assistant', content: t2.reply }, { role: 'user', content: 'In one to three years' }];
      const t4 = await turn(h4);
      expect(t4.reply).toContain(QUESTION.amount);
      const t5 = await turn([...h4, { role: 'assistant', content: t4.reply }, { role: 'user', content: '300' }]);
      expect(t5.reply).toMatch(/You told me: a play-it-safe approach/);
      expect(t5.action?.render.type).toBe('research_plan');
      expect(t5.action?.render.request).toMatchObject({ kind: 'stocks' });
      expect(t5.reply).toMatch(/Buy/);

      // 5. Once known, they are never asked again.
      const t6 = await turn([{ role: 'user', content: 'what are the best AI stocks right now?' }]);
      expect(t6.action?.render.type).toBe('research_plan');
      expect(t6.action?.render.request).toMatchObject({ kind: 'stocks', what: 'AI stocks' });

      // 6. Asking Pexa to buy a stock gets the honest answer, with what it can do instead — and no card.
      const t7 = await turn([{ role: 'user', content: 'buy me $50 of Tesla stock' }]);
      expect(t7.action).toBeUndefined();
      expect(t7.reply).toMatch(/can.t buy or sell stocks/i);
      expect(t7.reply).toMatch(/research/i);

      // 7. Skipping stops the questions and Pexa still helps.
      await resetInvestorProfile(userId);
      const s1 = await turn([{ role: 'user', content: 'where should I invest my money?' }]);
      const s2 = await turn([{ role: 'user', content: 'where should I invest my money?' }, { role: 'assistant', content: s1.reply }, { role: 'user', content: 'Skip the questions' }]);
      expect(s2.reply).toMatch(/skipped the questions/i);
      expect((await getInvestorProfile(userId))?.skipped).toBe(true);
    } finally {
      if (original) await saveInvestorProfile(userId, original);
      else await resetInvestorProfile(userId).catch(() => undefined);
    }
  });
});
