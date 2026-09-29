/**
 * Username rules (§9).
 *
 * Usernames are the human identity PrivyPay pays by (@sarah), so the rules are strict and
 * enforced in one place: 3–20 chars, lowercase, alphanumeric plus underscore, uniqueness
 * (enforced by the database), and a reserved-word block so system and impersonation-prone
 * names can't be claimed. Pure and side-effect-free — the format checks are fully unit-tested;
 * uniqueness is checked against the database in the service layer.
 */

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
const USERNAME_RE = /^[a-z0-9_]+$/;

/**
 * Reserved: system routes/roles, payment terms, and support/impersonation-prone handles.
 * Kept lowercase; matching is case-insensitive via normalization.
 */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  'admin', 'administrator', 'root', 'system', 'support', 'help', 'security', 'privypay', 'privy', 'pexa',
  'official', 'team', 'staff', 'moderator', 'mod', 'billing', 'payments', 'payment', 'pay', 'wallet',
  'api', 'app', 'www', 'mail', 'email', 'login', 'signup', 'signin', 'logout', 'auth', 'account',
  'settings', 'profile', 'me', 'you', 'user', 'users', 'null', 'undefined', 'anonymous', 'guest',
  'celo', 'usdc', 'crypto', 'bank', 'money', 'cash', 'send', 'receive', 'request', 'contact', 'contacts',
]);

export type UsernameError = 'too_short' | 'too_long' | 'invalid_chars' | 'reserved';

/**
 * Normalize user input toward a candidate username: strip a leading '@', trim, lowercase.
 * Does not enforce length/charset — that is {@link validateUsername}.
 */
export function normalizeUsername(input: string): string {
  return input.trim().replace(/^@+/, '').toLowerCase();
}

/** Validate a normalized username. Returns the first failing rule, or null if valid. */
export function validateUsername(input: string): UsernameError | null {
  const name = normalizeUsername(input);
  if (name.length < USERNAME_MIN) return 'too_short';
  if (name.length > USERNAME_MAX) return 'too_long';
  if (!USERNAME_RE.test(name)) return 'invalid_chars';
  if (RESERVED_USERNAMES.has(name)) return 'reserved';
  return null;
}

export function isValidUsername(input: string): boolean {
  return validateUsername(input) === null;
}

/** Trim/pad a candidate base down to a stem that leaves room for a suffix within the length bounds. */
function usernameStem(rawBase: string): string {
  const stripped = normalizeUsername(rawBase).replace(/[^a-z0-9_]/g, '');
  return (stripped || 'user').slice(0, USERNAME_MAX - 4);
}

/**
 * Candidate usernames derived from a base the caller wanted but couldn't have (taken or
 * reserved) — e.g. "chris" → "chris1", "chris_x". Callers check these against the database for
 * availability; this is pure and doesn't guarantee any candidate is actually free.
 */
export function generateUsernameCandidates(rawBase: string, count = 5): string[] {
  const stem = usernameStem(rawBase);
  // Suffix variants first (closest to what they wanted), then natural-sounding prefixes as
  // fallbacks for when the suffixed ones are taken too. No year suffixes — they go stale.
  const variants = [
    ...['1', '2', '_1', '01', '99', '23', '007', '_x', '_hq', '_pexa'].map((s) => `${stem}${s}`),
    `its${stem}`,
    `real${stem}`,
    `the_${stem}`,
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of variants) {
    if (out.length >= count) break;
    if (seen.has(candidate) || !isValidUsername(candidate)) continue;
    seen.add(candidate);
    out.push(candidate);
  }
  return out;
}

/** Human-readable message for a validation error, for API responses and the UI. */
export function usernameErrorMessage(error: UsernameError): string {
  switch (error) {
    case 'too_short':
      return `Username must be at least ${USERNAME_MIN} characters.`;
    case 'too_long':
      return `Username must be at most ${USERNAME_MAX} characters.`;
    case 'invalid_chars':
      return 'Use only lowercase letters, numbers and underscores.';
    case 'reserved':
      return 'That username isn’t available.';
  }
}
