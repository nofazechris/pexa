/**
 * Working out WHO a person meant when they type a name. Pure and tested, because this is the step that decides
 * where money goes: an exact username or UID is taken as written; a name that only partly matches someone you
 * already know (saved beneficiary or recent payee) is offered — and shown on the Confirm card — rather than
 * silently assumed; two people who both fit are never guessed between.
 */

import { isUid, normalizeUid } from '@/lib/users/uid';

export type Relation = 'saved' | 'recent' | 'user';

export interface Person {
  username: string;
  displayName: string | null;
  uid: string | null;
  /** Saved beneficiary, someone you have paid / been paid by, or just a Pexa user. */
  relation: Relation;
  saved: boolean;
  /** ISO time of the last payment either way, if any. */
  lastAt: string | null;
  direction: 'sent' | 'received' | null;
}

export type Resolution =
  | { kind: 'one'; person: Person; how: 'exact' | 'uid' | 'known' }
  | { kind: 'many'; people: Person[] }
  | { kind: 'none'; similar: Person[] };

const norm = (s: string) => s.trim().replace(/^@+/, '').toLowerCase();

/** Saved first, then most recent payment, then alphabetical — stable and predictable. */
export function sortPeople(people: readonly Person[]): Person[] {
  return [...people].sort((a, b) => {
    if (a.saved !== b.saved) return a.saved ? -1 : 1;
    const ta = a.lastAt ? Date.parse(a.lastAt) : 0;
    const tb = b.lastAt ? Date.parse(b.lastAt) : 0;
    if (ta !== tb) return tb - ta;
    return a.username.localeCompare(b.username);
  });
}

function dedupe(people: readonly Person[]): Person[] {
  const seen = new Map<string, Person>();
  for (const p of people) {
    const prev = seen.get(p.username);
    // Keep the richest record: known beats plain user, saved beats recent.
    if (!prev || rank(p) > rank(prev)) seen.set(p.username, p);
  }
  return [...seen.values()];
}
const rank = (p: Person) => (p.saved ? 3 : p.relation === 'recent' ? 2 : 1);

/**
 * @param query    what the user typed ("joyful", "@joyful", "PX3STC3A", "joy")
 * @param known    saved beneficiaries + recent counterparties
 * @param directory Pexa users matching the query in the whole directory (exact + prefix); may overlap `known`
 */
export function resolvePerson(query: string, known: readonly Person[], directory: readonly Person[]): Resolution {
  const q = norm(query);
  const all = dedupe([...known, ...directory]);
  if (!q) return { kind: 'none', similar: sortPeople(dedupe(known)).slice(0, 3) };

  // 1. A UID is unambiguous by design.
  if (isUid(q)) {
    const uid = normalizeUid(q);
    const hit = all.find((p) => p.uid === uid);
    return hit ? { kind: 'one', person: hit, how: 'uid' } : { kind: 'none', similar: [] };
  }

  // 2. An exact username is taken as written — it is the thing they typed.
  const exact = all.find((p) => p.username === q);
  if (exact) return { kind: 'one', person: exact, how: 'exact' };

  // 3. Someone you already know whose username or display name starts with / contains it.
  if (q.length >= 2) {
    const fits = (p: Person) => p.username.startsWith(q) || p.username.includes(q) || (p.displayName ?? '').toLowerCase().includes(q);
    const knownFits = sortPeople(dedupe(known).filter(fits));
    if (knownFits.length === 1) return { kind: 'one', person: knownFits[0], how: 'known' };
    if (knownFits.length > 1) return { kind: 'many', people: knownFits.slice(0, 4) };
    // 4. No one you know — but other Pexa users look similar: offer, never assume.
    const similar = sortPeople(dedupe(directory).filter(fits)).slice(0, 3);
    return { kind: 'none', similar };
  }
  return { kind: 'none', similar: [] };
}

/** "@joyful (PX3STC3A)" — the UID is what tells two similar names apart. */
export function label(p: Pick<Person, 'username' | 'uid'>): string {
  return p.uid ? `@${p.username} (${p.uid})` : `@${p.username}`;
}

/** When you last dealt with them, in plain words — "paid them 3 days ago". */
export function lastSeen(p: Pick<Person, 'lastAt' | 'direction'>, now: number = Date.now()): string {
  if (!p.lastAt) return '';
  const days = Math.floor((now - Date.parse(p.lastAt)) / 86_400_000);
  const when = days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
  return p.direction === 'received' ? `they paid you ${when}` : `you paid them ${when}`;
}
