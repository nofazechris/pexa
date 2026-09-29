import { describe, expect, it } from 'vitest';
import { isTransientDbError, isUniqueViolation, pgErrorInfo } from './errors';

// The shape observed against the real database: Drizzle throws DrizzleQueryError (no `.code`),
// with the actual PostgresError on `.cause`.
function drizzleWrapped(cause: Record<string, unknown>): Error {
  const err = new Error('Failed query: insert into …') as Error & { cause?: unknown };
  err.name = 'DrizzleQueryError';
  err.cause = Object.assign(new Error('duplicate key value violates unique constraint'), cause);
  return err;
}

describe('isUniqueViolation', () => {
  it('detects a unique violation on the WRAPPED Drizzle error (e.code is undefined there)', () => {
    const e = drizzleWrapped({ code: '23505', constraint_name: 'profiles_username_uq' });
    expect((e as { code?: string }).code).toBeUndefined(); // why the old `e.code === …` never matched
    expect(isUniqueViolation(e)).toBe(true);
  });

  it('can be scoped to one constraint', () => {
    const e = drizzleWrapped({ code: '23505', constraint_name: 'profiles_username_uq' });
    expect(isUniqueViolation(e, 'profiles_username_uq')).toBe(true);
    expect(isUniqueViolation(e, 'profiles_pkey')).toBe(false);
  });

  it('also works on an unwrapped driver error', () => {
    expect(isUniqueViolation(Object.assign(new Error('x'), { code: '23505' }))).toBe(true);
  });

  it('is false for other errors and for junk input', () => {
    expect(isUniqueViolation(drizzleWrapped({ code: '23503' }))).toBe(false);
    expect(isUniqueViolation(new Error('boom'))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation('23505')).toBe(false);
  });
});

describe('isTransientDbError', () => {
  it('flags DNS / connection failures as transient', () => {
    expect(isTransientDbError(drizzleWrapped({ code: 'ENOTFOUND' }))).toBe(true);
    expect(isTransientDbError(drizzleWrapped({ code: 'EAI_AGAIN' }))).toBe(true);
    expect(isTransientDbError(drizzleWrapped({ code: 'ECONNRESET' }))).toBe(true);
  });

  it('flags the pooler being at capacity (generic code, telling message)', () => {
    const e = drizzleWrapped({ code: 'XX000', message: '(EMAXCONNSESSION) max clients reached in session mode' });
    expect(isTransientDbError(e)).toBe(true);
  });

  it('does not treat logic errors (unique violation) as transient', () => {
    expect(isTransientDbError(drizzleWrapped({ code: '23505' }))).toBe(false);
    expect(isTransientDbError(new Error('boom'))).toBe(false);
  });
});

describe('pgErrorInfo', () => {
  it('returns {} when nothing has a code', () => {
    expect(pgErrorInfo(new Error('x'))).toEqual({});
  });
});
