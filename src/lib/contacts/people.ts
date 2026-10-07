import 'server-only';
import { and, desc, eq, inArray, isNotNull, like, ne, or } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { isUid, normalizeUid } from '@/lib/users/uid';
import { resolvePerson, sortPeople, type Person, type Resolution } from './match';

/**
 * The people a user deals with, built from what actually happened: everyone you have paid or been paid by
 * (recents — automatic, nothing to maintain) plus the beneficiaries you chose to save. Money in either
 * direction counts, so the person who sends you money back shows up too.
 */

// Payments that really went out. Drafts, previews and ones stuck before signing are not "dealings" — an
// abandoned attempt must not make someone look like a person you pay.
const REAL = ['BROADCASTING', 'PENDING', 'CONFIRMED'];

interface Profileish {
  userId: string;
  username: string;
  displayName: string | null;
  uid: string | null;
}

async function profilesByIds(ids: string[]): Promise<Map<string, Profileish>> {
  if (ids.length === 0) return new Map();
  const rows = await getDb()
    .select({ userId: schema.profiles.userId, username: schema.profiles.username, displayName: schema.profiles.displayName, uid: schema.profiles.uid })
    .from(schema.profiles)
    .where(inArray(schema.profiles.userId, ids));
  return new Map(rows.map((r) => [r.userId, r]));
}

/** Saved beneficiaries (the explicit list), with their current username and UID. */
export async function listSavedPeople(ownerUserId: string): Promise<Person[]> {
  const rows = await getDb()
    .select({ username: schema.contacts.username, displayName: schema.contacts.displayName, contactUserId: schema.contacts.contactUserId })
    .from(schema.contacts)
    .where(eq(schema.contacts.ownerUserId, ownerUserId))
    .orderBy(desc(schema.contacts.createdAt));
  const profiles = await profilesByIds(rows.map((r) => r.contactUserId).filter((x): x is string => !!x));
  return rows.map((r) => {
    const pr = r.contactUserId ? profiles.get(r.contactUserId) : undefined;
    return { username: pr?.username ?? r.username, displayName: pr?.displayName ?? r.displayName, uid: pr?.uid ?? null, relation: 'saved' as const, saved: true, lastAt: null, direction: null };
  });
}

/** Everyone you have paid or been paid by, most recent first, de-duplicated. */
export async function listRecentPeople(userId: string, limit = 8): Promise<Person[]> {
  const db = getDb();
  const [sent, received] = await Promise.all([
    db
      .select({ other: schema.payments.recipientUserId, at: schema.payments.createdAt })
      .from(schema.payments)
      .where(and(eq(schema.payments.senderUserId, userId), isNotNull(schema.payments.recipientUserId), inArray(schema.payments.status, REAL)))
      .orderBy(desc(schema.payments.createdAt))
      .limit(200),
    db
      .select({ other: schema.payments.senderUserId, at: schema.payments.createdAt })
      .from(schema.payments)
      .where(and(eq(schema.payments.recipientUserId, userId), ne(schema.payments.senderUserId, userId), inArray(schema.payments.status, REAL)))
      .orderBy(desc(schema.payments.createdAt))
      .limit(200),
  ]);

  const latest = new Map<string, { at: Date; direction: 'sent' | 'received' }>();
  for (const r of sent) if (r.other && r.other !== userId && (!latest.has(r.other) || r.at > latest.get(r.other)!.at)) latest.set(r.other, { at: r.at, direction: 'sent' });
  for (const r of received) if (!latest.has(r.other) || r.at > latest.get(r.other)!.at) latest.set(r.other, { at: r.at, direction: 'received' });

  const ids = [...latest.entries()].sort((a, b) => b[1].at.getTime() - a[1].at.getTime()).slice(0, Math.max(limit, 1) * 2).map(([id]) => id);
  const [profiles, saved] = await Promise.all([profilesByIds(ids), listSavedPeople(userId)]);
  const savedNames = new Set(saved.map((s) => s.username));

  return ids
    .map((id): Person | null => {
      const pr = profiles.get(id);
      if (!pr) return null;
      const l = latest.get(id)!;
      return { username: pr.username, displayName: pr.displayName, uid: pr.uid, relation: 'recent', saved: savedNames.has(pr.username), lastAt: l.at.toISOString(), direction: l.direction };
    })
    .filter((p): p is Person => p !== null)
    .slice(0, limit);
}

/** Pexa users matching a query anywhere in the directory: exact username / UID, then prefix. Never includes yourself. */
async function searchDirectory(query: string, excludeUserId: string, limit = 6): Promise<Person[]> {
  const q = query.trim().replace(/^@+/, '').toLowerCase();
  if (!q) return [];
  const escaped = q.replace(/[\\%_]/g, (c) => '\\' + c);
  const where = isUid(q)
    ? eq(schema.profiles.uid, normalizeUid(q))
    : or(eq(schema.profiles.username, q), like(schema.profiles.username, `${escaped}%`), q.length >= 3 ? like(schema.profiles.username, `%${escaped}%`) : undefined);
  const rows = await getDb()
    .select({ userId: schema.profiles.userId, username: schema.profiles.username, displayName: schema.profiles.displayName, uid: schema.profiles.uid })
    .from(schema.profiles)
    .where(and(where, ne(schema.profiles.userId, excludeUserId)))
    .limit(limit);
  return rows.map((r) => ({ username: r.username, displayName: r.displayName, uid: r.uid, relation: 'user' as const, saved: false, lastAt: null, direction: null }));
}

/** Who did the user mean by this name / @username / UID? See {@link resolvePerson} for the rules. */
export async function resolveRecipient(userId: string, query: string): Promise<Resolution> {
  const [recent, saved, directory] = await Promise.all([listRecentPeople(userId, 30), listSavedPeople(userId), searchDirectory(query, userId)]);
  // Merge what we know about each person: a saved person you also paid is "saved" with their payment history.
  const byName = new Map<string, Person>();
  for (const s of saved) byName.set(s.username, s);
  for (const r of recent) {
    const prev = byName.get(r.username);
    byName.set(r.username, prev ? { ...r, saved: true, relation: 'saved' } : r);
  }
  return resolvePerson(query, [...byName.values()], directory);
}

/** For the agent's "find people" tool: the best matches for a name, with how they're connected to the user. */
export async function findPeople(userId: string, query: string, limit = 5): Promise<Person[]> {
  const res = await resolveRecipient(userId, query);
  if (res.kind === 'one') return [res.person];
  if (res.kind === 'many') return res.people.slice(0, limit);
  return res.similar.slice(0, limit);
}

/** The shortlist shown as quick picks: saved people first, then recents. */
export async function quickPicks(userId: string, limit = 6): Promise<Person[]> {
  const [recent, saved] = await Promise.all([listRecentPeople(userId, limit), listSavedPeople(userId)]);
  const merged = new Map<string, Person>();
  for (const r of recent) merged.set(r.username, r);
  for (const s of saved) merged.set(s.username, { ...(merged.get(s.username) ?? s), saved: true, relation: 'saved' });
  return sortPeople([...merged.values()]).slice(0, limit);
}
