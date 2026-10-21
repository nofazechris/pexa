// Live check that the orb's stages follow what the agent is really doing. Run: npm run agent:eval   (real model + database)
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

for (const line of readFileSync(new URL('../../../../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=([^#\r\n]*)/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}

describe('stages follow real activity (live)', () => {
  it('a lookup question: thinking, then searching the pool data, then writing the answer', async () => {
    const { getDb, schema } = await import('@/lib/db');
    const { eq } = await import('drizzle-orm');
    const { runAgentTurn } = await import('@/lib/agent/runtime');
    const [prof] = await getDb().select().from(schema.profiles).where(eq(schema.profiles.username, process.env.EVAL_USER ?? 'chris')).limit(1);

    const { withSettledProfile } = await import('./profile-fixture');
    await withSettledProfile(prof.userId, async () => {
    const run = async (text: string) => {
      const events: { stage: string; label: string }[] = [];
      const turn = await runAgentTurn({ userId: prof.userId, messages: [{ role: 'user', content: text }] }, { onStage: (e) => events.push(e) });
      return { events, turn };
    };

    // 1. A yield question: the model thinks first, then the pool data is read.
    const yields = await run('where can I earn on my USDC on Celo?');
    const stages = yields.events.map((e) => e.stage);
    expect(stages[0]).toBe('thinking');
    expect(stages).toContain('searching');
    expect(yields.events.some((e) => /pool rates/i.test(e.label))).toBe(true);
    // Searching is announced after the thinking, never before it.
    expect(stages.indexOf('searching')).toBeGreaterThan(stages.indexOf('thinking'));

    // 2. A flow the app reads itself: no model call, so no "thinking" — it goes straight to the real work.
    const deposit = await run('deposit 10 USDT into Aave');
    expect(deposit.events.length).toBeGreaterThan(0);
    expect(deposit.events[0].stage).toBe('walking');
    expect(deposit.events.some((e) => e.stage === 'thinking')).toBe(false);

    // 3. A plain hello: only thinking — nothing is searched or worked on, so nothing says it is.
    const hello = await run('hello, how are you?');
    expect(hello.events.every((e) => e.stage === 'thinking')).toBe(true);
    expect(hello.events.length).toBeGreaterThan(0);
    });
  });
});
