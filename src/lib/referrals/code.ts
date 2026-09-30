/**
 * Referral code + link helpers. Pure (no imports, no server-only) so they're shared by the API, the
 * landing page and the app, and are fully unit-tested.
 */

/** Lowercase letters + digits with the look-alikes removed (no i, l, o, 0, 1) — easy to read aloud and type. */
export const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const CODE_LENGTH = 8;

/**
 * A new random code. Uses the platform CSPRNG with rejection sampling so every character is
 * uniformly likely (no modulo bias). 31^8 ≈ 8.5e11 combinations — unguessable enough for a share
 * token, and the database's primary key is the real uniqueness guarantee.
 */
export function generateReferralCode(length = CODE_LENGTH): string {
  const n = CODE_ALPHABET.length;
  const limit = 256 - (256 % n); // accept only bytes below this, so `% n` stays uniform
  let out = '';
  while (out.length < length) {
    const bytes = new Uint8Array(length * 2);
    globalThis.crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (b >= limit) continue;
      out += CODE_ALPHABET[b % n];
      if (out.length === length) break;
    }
  }
  return out;
}

/**
 * Validate + normalize a code from untrusted input (a URL param, a request body, storage). Returns
 * the lowercase code, or null if it isn't shaped like one — so junk never reaches the database.
 */
export function normalizeReferralCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toLowerCase();
  return /^[a-z0-9]{6,16}$/.test(code) ? code : null;
}

/** The public share link for a code, on the given site origin. */
export function buildReferralLink(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, '')}/?ref=${encodeURIComponent(code)}`;
}

/** Ready-made share text. `position` (waitlist only) makes it more compelling when known. */
export function shareMessage(opts?: { position?: number }): string {
  return opts?.position
    ? `I'm #${opts.position} in line for Pexa — a new way to move money on-chain by just talking to an AI agent. Join me on the waitlist:`
    : 'Join me on Pexa — a new way to move money on-chain by just talking to an AI agent:';
}

/** One-tap share URLs for the common channels. */
export function shareUrls(link: string, text: string) {
  const u = encodeURIComponent(link);
  const t = encodeURIComponent(text);
  return {
    x: `https://twitter.com/intent/tweet?text=${t}&url=${u}`,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(`${text} ${link}`)}`,
    telegram: `https://t.me/share/url?url=${u}&text=${t}`,
  };
}
