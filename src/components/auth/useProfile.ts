'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './AuthProvider';

export interface ProfileState {
  loading: boolean;
  /** The user's claimed username, or null if they have none yet (→ onboarding). */
  profile: { username: string; uid?: string | null } | null;
  /** The provisioned Celo wallet address, or null if not synced yet. */
  wallet: { address: string } | null;
  /**
   * True only when the database is genuinely NOT configured (a local dev escape hatch). A transient
   * backend error is `error`, not this — we must never treat a blip as "no DB" and skip onboarding.
   */
  unavailable: boolean;
  /** A transient failure to load the profile (network/DB blip). Distinct from `unavailable`. */
  error: boolean;
  refresh: () => void;
}

/**
 * Loads the signed-in user's profile from /api/profile/me (authenticated with the Privy access
 * token). Gates use `profile === null` to route a new user to onboarding; `unavailable` covers
 * the degraded case where the database isn't configured, so callers can fall back gracefully.
 */
export function useProfile(): ProfileState {
  const { ready, authenticated, getAccessToken } = useAuth();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<{ username: string; uid?: string | null } | null>(null);
  const [wallet, setWallet] = useState<{ address: string } | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState(false);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let active = true;
    const run = async () => {
      if (!ready) return;
      if (!authenticated) {
        if (active) {
          setProfile(null);
          setLoading(false);
        }
        return;
      }
      setLoading(true);
      setUnavailable(false);
      setError(false);
      try {
        // Retry a few times before giving up: a momentary blip (network drop, a 5xx, or a token
        // that isn't ready right after sign-in → 401) shouldn't put a new user on an error screen.
        // `loading` stays true throughout, so they just see the spinner.
        const MAX_ATTEMPTS = 3;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          let res: Response | null = null;
          try {
            const token = await getAccessToken();
            res = await fetch('/api/profile/me', {
              headers: token ? { authorization: `Bearer ${token}` } : {},
              cache: 'no-store',
            });
          } catch {
            res = null; // never reached our API
          }
          if (!active) return;

          if (res && res.ok) {
            const data = (await res.json()) as {
              profile: { username: string; uid?: string | null } | null;
              wallet: { address: string } | null;
            };
            setProfile(data.profile ?? null);
            setWallet(data.wallet ?? null);
            return;
          }

          // A genuinely-unconfigured database is `unavailable` (no point retrying). Every other
          // failure is a transient `error` — never "no DB", which would skip username setup.
          let code = '';
          if (res) {
            try {
              code = ((await res.json()) as { error?: string })?.error ?? '';
            } catch {
              /* no body */
            }
          }
          if (res && res.status === 503 && code === 'database_not_configured') {
            setUnavailable(true);
            setProfile(null);
            return;
          }
          if (attempt < MAX_ATTEMPTS) {
            await new Promise((r) => setTimeout(r, 900 * attempt));
            if (!active) return;
            continue;
          }
          setError(true);
          setProfile(null);
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [ready, authenticated, getAccessToken, tick]);

  return { loading, profile, wallet, unavailable, error, refresh };
}
