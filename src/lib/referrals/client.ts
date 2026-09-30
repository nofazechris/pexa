/**
 * Browser-side referral memory. Remembers (a) the code from a friend's share link, so it can be
 * credited when this visitor joins the waitlist or finishes onboarding, and (b) this visitor's own
 * waitlist share code, so a returning visit shows their place in line. Storage can be blocked or
 * unavailable (private windows, embedded browsers), so every access is guarded and failures are silent.
 */
import { normalizeReferralCode } from './code';

const REF_KEY = 'pexa:ref';
const OWN_KEY = 'pexa:waitlist-code';
const REF_TTL_MS = 30 * 24 * 60 * 60 * 1000; // a friend's link counts for 30 days

/** Save `?ref=` from the current URL, if there's a valid one. Call once when the landing page loads. */
export function captureReferralFromUrl(): void {
  try {
    const code = normalizeReferralCode(new URLSearchParams(window.location.search).get('ref'));
    if (code) localStorage.setItem(REF_KEY, JSON.stringify({ code, at: Date.now() }));
  } catch {
    /* storage unavailable */
  }
}

/** The friend's code to credit, if one was captured recently. */
export function getStoredReferral(): string | null {
  try {
    const raw = localStorage.getItem(REF_KEY);
    if (!raw) return null;
    const { code, at } = JSON.parse(raw) as { code?: unknown; at?: unknown };
    if (typeof at !== 'number' || Date.now() - at > REF_TTL_MS) return null;
    return normalizeReferralCode(code);
  } catch {
    return null;
  }
}

export function clearStoredReferral(): void {
  try {
    localStorage.removeItem(REF_KEY);
  } catch {
    /* ignore */
  }
}

export function rememberOwnWaitlistCode(code: string): void {
  try {
    localStorage.setItem(OWN_KEY, code);
  } catch {
    /* ignore */
  }
}

export function getOwnWaitlistCode(): string | null {
  try {
    return normalizeReferralCode(localStorage.getItem(OWN_KEY));
  } catch {
    return null;
  }
}
