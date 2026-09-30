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

/**
 * The public share link for a code, on the given site origin: `/r/<code>`. That page carries the
 * social-preview tags (the personal picture) and then sends the visitor on to the landing page with
 * the code remembered. The older `/?ref=<code>` form keeps working, so links already out there are fine.
 */
export function buildReferralLink(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, '')}/r/${encodeURIComponent(code)}`;
}

/** Ready-made share text. `position` (waitlist only) makes it more compelling when known. */
export function shareMessage(opts?: { position?: number }): string {
  return opts?.position
    ? `I'm #${opts.position} on the Pexa waitlist 🚀 The AI agent for your money on-chain. Use my referral link to climb up the ranking 👇`
    : 'Join me on Pexa 🚀 The AI agent for your money on-chain. Sign up with my referral link 👇';
}

/**
 * One-tap share URLs for the common channels. The X link opens the compose box with the tweet
 * already written — text, the person's link (which X unfurls into their personal picture card), and
 * the #Pexa hashtag — so it's one tap to post.
 */
export function shareUrls(link: string, text: string) {
  const u = encodeURIComponent(link);
  const t = encodeURIComponent(text);
  return {
    x: `https://twitter.com/intent/tweet?text=${t}&url=${u}&hashtags=Pexa`,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(`${text} ${link}`)}`,
    telegram: `https://t.me/share/url?url=${u}&text=${t}`,
  };
}
