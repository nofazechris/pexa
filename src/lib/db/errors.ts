/**
 * Postgres error classification.
 *
 * Drizzle wraps every driver failure in a `DrizzleQueryError` ("Failed query: …") and puts the real
 * Postgres error on `.cause` — so `e.code` on the thrown error is `undefined`, and the SQLSTATE
 * (`23505` for a unique violation) and `constraint_name` live one level down. Checking `e.code`
 * directly never matches, which turned "that username is taken" into a bare 500. Always classify
 * through these helpers instead. Pure (no imports) so it is unit-tested and safe anywhere.
 */

export interface PgErrorInfo {
  code?: string;
  constraint?: string;
  message?: string;
}

const UNIQUE_VIOLATION = '23505';

/** Walk `e` and its `.cause` chain (bounded) and return the first error carrying a `code`. */
export function pgErrorInfo(e: unknown): PgErrorInfo {
  let cur: unknown = e;
  for (let depth = 0; depth < 4 && cur && typeof cur === 'object'; depth++) {
    const o = cur as { code?: unknown; constraint_name?: unknown; constraint?: unknown; message?: unknown; cause?: unknown };
    if (typeof o.code === 'string') {
      const constraint = typeof o.constraint_name === 'string' ? o.constraint_name : typeof o.constraint === 'string' ? o.constraint : undefined;
      return { code: o.code, constraint, message: typeof o.message === 'string' ? o.message : undefined };
    }
    cur = o.cause;
  }
  return {};
}

/** True for a Postgres unique-constraint violation, optionally restricted to one constraint name. */
export function isUniqueViolation(e: unknown, constraint?: string): boolean {
  const info = pgErrorInfo(e);
  if (info.code !== UNIQUE_VIOLATION) return false;
  return constraint ? info.constraint === constraint : true;
}

const TRANSIENT_CODES = new Set([
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'CONNECT_TIMEOUT', 'CONNECTION_CLOSED', 'CONNECTION_ENDED',
  '57P01', // admin_shutdown
  '53300', // too_many_connections
  '08000', '08001', '08003', '08006', // connection exceptions
]);

/**
 * True for infrastructure hiccups (DNS, dropped/refused connection, pooler at capacity) that are
 * worth retrying and should surface as "temporarily unavailable" rather than a logic error.
 */
export function isTransientDbError(e: unknown): boolean {
  const info = pgErrorInfo(e);
  if (info.code && TRANSIENT_CODES.has(info.code)) return true;
  // Supabase's pooler reports "max clients reached" under a generic code.
  return typeof info.message === 'string' && /max clients reached|too many (clients|connections)/i.test(info.message);
}
