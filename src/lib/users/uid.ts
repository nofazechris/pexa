/**
 * Pexa UID — a short, permanent, human-friendly ID for every user ("PX7K2M9Q"), shown next to a username so
 * two people with similar names can always be told apart, and usable as a payee on its own. Unlike a username
 * it never changes. The alphabet leaves out look-alikes (0/O, 1/I/L) so it survives being read aloud or typed.
 */

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 symbols: no 0, O, 1, I
export const UID_PREFIX = 'PX';
const UID_BODY = 6;
const UID_RE = new RegExp(`^${UID_PREFIX}[${ALPHABET}]{${UID_BODY}}$`);

/** A fresh random UID, e.g. "PX7K2M9Q" (32^6 ≈ 1 billion combinations). */
export function generateUid(): string {
  const bytes = new Uint8Array(UID_BODY);
  globalThis.crypto.getRandomValues(bytes);
  // 256 is a multiple of 32, so taking the low 5 bits is unbiased.
  return UID_PREFIX + Array.from(bytes, (b) => ALPHABET[b & 31]).join('');
}

/** Upper-case and trim, so "px7k2m9q" and " PX7K2M9Q " are the same ID. */
export function normalizeUid(input: string): string {
  return input.trim().toUpperCase();
}

export function isUid(input: string): boolean {
  return UID_RE.test(normalizeUid(input));
}
