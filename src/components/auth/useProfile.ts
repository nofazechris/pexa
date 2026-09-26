'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './AuthProvider';

export interface ProfileState {
  loading: boolean;
  /** The user's claimed username, or null if they have none yet (→ onboarding). */
  profile: { username: string } | null;
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
  const [profile, setProfile] = useState<{ username: string } | null>(null);
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
        const token = await getAccessToken();
        const res = await fetch('/api/profile/me', {
          headers: token ? { authorization: `Bearer ${token}` } : {},
          cache: 'no-store',
        });
        if (!active) return;
        if (!res.ok) {
          // Only a genuinely-unconfigured database is `unavailable`; every other failure (a DB/
          // network blip) is a transient `error` so we retry instead of skipping onboarding.
          let code = '';
          try {
            code = ((await res.json()) as { error?: string })?.error ?? '';
          } catch {
            /* no body */
          }
          if (res.status === 503 && code === 'database_not_configured') setUnavailable(true);
          else setError(true);
          setProfile(null);
        } else {
          const data = (await res.json()) as {
            profile: { username: string } | null;
            wallet: { address: string } | null;
          };
          setProfile(data.profile ?? null);
          setWallet(data.wallet ?? null);
        }
      } catch {
        if (active) {
          setError(true); // network error reaching our own API — transient, not "no DB"
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
