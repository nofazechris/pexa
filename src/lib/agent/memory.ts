import 'server-only';
import { and, desc, eq } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';

/**
 * Agent memory (§ learn the user). Short, non-sensitive facts/preferences the agent recalls to
 * personalize conversations. Scoped per user. NEVER stores secrets, keys, passwords, or full
 * bank/card numbers (the tool + prompt forbid it). Memory informs orchestration only — it can
 * never relax limits, KYC or confirmation.
 */

const MAX_MEMORIES = 40;
const MAX_LEN = 240;

/** The user's saved memories, newest first. */
export async function listMemories(userId: string, limit = MAX_MEMORIES): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ content: schema.agentMemories.content })
    .from(schema.agentMemories)
    .where(eq(schema.agentMemories.userId, userId))
    .orderBy(desc(schema.agentMemories.createdAt))
    .limit(limit);
  return rows.map((r) => r.content);
}

// Cheap guard against obviously sensitive content slipping into memory.
const SENSITIVE = /\b(\d[ -]?){12,}\b|password|passphrase|seed phrase|private key|\bcvv\b|\botp\b/i;

/** Save a durable fact/preference. Idempotent per (user, content); trims and rejects sensitive text. */
export async function addMemory(userId: string, content: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const text = content.trim().slice(0, MAX_LEN);
  if (!text) return { ok: false, error: 'empty' };
  if (SENSITIVE.test(text)) return { ok: false, error: 'looks_sensitive' };

  const db = getDb();
  await db
    .insert(schema.agentMemories)
    .values({ userId, content: text })
    .onConflictDoNothing({ target: [schema.agentMemories.userId, schema.agentMemories.content] });

  // Trim to the newest MAX_MEMORIES so the store stays bounded.
  const all = await db
    .select({ id: schema.agentMemories.id })
    .from(schema.agentMemories)
    .where(eq(schema.agentMemories.userId, userId))
    .orderBy(desc(schema.agentMemories.createdAt));
  if (all.length > MAX_MEMORIES) {
    for (const row of all.slice(MAX_MEMORIES)) {
      await db.delete(schema.agentMemories).where(and(eq(schema.agentMemories.id, row.id), eq(schema.agentMemories.userId, userId)));
    }
  }
  return { ok: true };
}
