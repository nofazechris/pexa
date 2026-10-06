import 'server-only';
import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { deriveTitle, isWorthSaving, prepareForSave, restoreMessages, type SavedMessage } from './persist';

/**
 * Saved agent chats. Every query is scoped to the signed-in user, and a save can only ever update a chat
 * that user already owns — a guessed id belonging to someone else is treated as "not found", never overwritten.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CONVERSATIONS_PER_USER = 100;

export interface ConversationSummary {
  id: string;
  title: string;
  messageCount: number;
  updatedAt: string;
}

export async function listConversations(userId: string, limit = 30): Promise<ConversationSummary[]> {
  const rows = await getDb()
    .select({ id: schema.agentConversations.id, title: schema.agentConversations.title, messageCount: schema.agentConversations.messageCount, updatedAt: schema.agentConversations.updatedAt })
    .from(schema.agentConversations)
    .where(eq(schema.agentConversations.userId, userId))
    .orderBy(desc(schema.agentConversations.updatedAt))
    .limit(Math.min(Math.max(limit, 1), 100));
  return rows.map((r) => ({ id: r.id, title: r.title, messageCount: r.messageCount, updatedAt: r.updatedAt.toISOString() }));
}

/** A chat with its messages in restored form (anything that was awaiting a tap comes back inert). */
export async function getConversation(userId: string, id: string): Promise<{ id: string; title: string; messages: SavedMessage[]; nextId: number } | null> {
  if (!UUID.test(id)) return null;
  const [row] = await getDb()
    .select()
    .from(schema.agentConversations)
    .where(and(eq(schema.agentConversations.id, id), eq(schema.agentConversations.userId, userId)))
    .limit(1);
  if (!row) return null;
  let raw: unknown = [];
  try {
    raw = JSON.parse(row.messagesJson);
  } catch {
    /* treat a corrupt document as empty */
  }
  const { messages, nextId } = restoreMessages(raw);
  return { id: row.id, title: row.title, messages, nextId };
}

export type SaveResult = { ok: true; saved: boolean } | { ok: false; code: 'invalid_id' | 'not_yours' };

/** Create or update a chat. Chats the user hasn't taken part in aren't stored. */
export async function saveConversation(userId: string, id: string, rawMessages: unknown): Promise<SaveResult> {
  if (!UUID.test(id)) return { ok: false, code: 'invalid_id' };
  const messages = prepareForSave(rawMessages);
  if (!isWorthSaving(messages)) return { ok: true, saved: false };

  const db = getDb();
  const title = deriveTitle(messages);
  const now = new Date();
  const written = await db
    .insert(schema.agentConversations)
    .values({ id, userId, title, messagesJson: JSON.stringify(messages), messageCount: messages.length, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.agentConversations.id,
      set: { title, messagesJson: JSON.stringify(messages), messageCount: messages.length, updatedAt: now },
      // The conflict is on the id alone, so make sure the existing row is THIS user's before touching it.
      setWhere: eq(schema.agentConversations.userId, userId),
    })
    .returning({ id: schema.agentConversations.id });
  if (written.length === 0) return { ok: false, code: 'not_yours' };

  // Keep each user's history bounded: drop the oldest beyond the cap.
  await db.execute(sql`
    delete from agent_conversations
    where user_id = ${userId}
      and id in (
        select id from agent_conversations where user_id = ${userId}
        order by updated_at desc offset ${MAX_CONVERSATIONS_PER_USER}
      )
  `);
  return { ok: true, saved: true };
}

export async function deleteConversation(userId: string, id: string): Promise<boolean> {
  if (!UUID.test(id)) return false;
  const res = await getDb()
    .delete(schema.agentConversations)
    .where(and(eq(schema.agentConversations.id, id), eq(schema.agentConversations.userId, userId)))
    .returning({ id: schema.agentConversations.id });
  return res.length > 0;
}
