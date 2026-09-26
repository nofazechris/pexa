import 'server-only';
import { desc, eq } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';

/**
 * Waitlist service (§25–27).
 *
 * Normalizes and validates the email, then inserts — deduping at both the application and
 * database levels so a repeat signup is a friendly "already on the list", never an error. Only
 * the minimum is stored (email, optional first name, source); no sensitive data (§27).
 */

// Pragmatic RFC-5322-ish check: one @, a dotted domain, no spaces. Good enough to reject typos
// and junk without pretending to fully validate deliverability.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return email.length <= 254 && EMAIL_RE.test(email);
}

export type JoinResult =
  | { ok: true; created: boolean }
  | { ok: false; error: 'invalid_email' };

/**
 * Add an email to the waitlist. `created` is false when the email was already present — the
 * caller returns the same friendly success either way, so we never leak who is on the list.
 */
export async function joinWaitlist(input: {
  email: string;
  firstName?: string | null;
  source?: string;
}): Promise<JoinResult> {
  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) return { ok: false, error: 'invalid_email' };

  const firstName = input.firstName?.trim() || null;
  const db = getDb();

  // Application-level dedupe first (fast path, avoids relying on catching a DB error).
  const existing = await db
    .select({ id: schema.waitlist.id })
    .from(schema.waitlist)
    .where(eq(schema.waitlist.email, email))
    .limit(1);
  if (existing[0]) return { ok: true, created: false };

  try {
    await db
      .insert(schema.waitlist)
      .values({ email, firstName, source: input.source ?? 'landing' });
    return { ok: true, created: true };
  } catch (e) {
    // Unique-violation race (two requests for the same email at once): still a success.
    if (e && typeof e === 'object' && 'code' in e && (e as { code?: string }).code === '23505') {
      return { ok: true, created: false };
    }
    throw e;
  }
}

/** Escape one CSV field: wrap in quotes and double any inner quotes when it needs it. */
function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Export the whole waitlist as CSV (newest first), for a spreadsheet. Admin-only — the route that
 * calls this gates on a shared secret. Columns: email, first_name, status, source, created_at.
 */
export async function exportWaitlistCsv(): Promise<string> {
  const db = getDb();
  const rows = await db
    .select({
      email: schema.waitlist.email,
      firstName: schema.waitlist.firstName,
      status: schema.waitlist.status,
      source: schema.waitlist.source,
      createdAt: schema.waitlist.createdAt,
    })
    .from(schema.waitlist)
    .orderBy(desc(schema.waitlist.createdAt));

  const header = ['email', 'first_name', 'status', 'source', 'created_at'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [
        csvField(r.email),
        csvField(r.firstName ?? ''),
        csvField(r.status),
        csvField(r.source),
        csvField(r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt)),
      ].join(','),
    );
  }
  return lines.join('\r\n') + '\r\n';
}
