'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { PrivyProvider, usePrivy, useCreateWallet } from '@privy-io/react-auth';
import { celo, celoSepolia } from 'viem/chains';
import { pickCanonicalWallet, type LinkedAccountLike } from '@/lib/wallets/select';

/**
 * Authentication provider (§8).
 *
 * Wraps the app in Privy for real email + passkey sign-in. Two invariants shape this file:
 *
 * 1. **Graceful when unconfigured.** Until `NEXT_PUBLIC_PRIVY_APP_ID` is set, the app must
 *    still build and run — the marketing landing and styleguide can't depend on a secret. So
 *    when there is no app id we render children directly and expose `configured: false`;
 *    `PrivyProvider` is only mounted when an id exists.
 * 2. **`usePrivy()` only runs inside `PrivyProvider`.** Consumers read {@link useAuth}, which
 *    reads a context this file always provides, so a component never calls `usePrivy()`
 *    outside the provider (which would throw).
 *
 * Embedded-wallet creation is deliberately left off here; Stage 5 turns it on. This stage is
 * auth, session and protected routes only.
 */

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? '';

export interface AuthUser {
  /** Privy DID, e.g. did:privy:… — the stable user id the backend keys on. */
  id: string;
  email?: string;
}

export interface AuthState {
  /** Whether Privy is configured for this deployment. */
  configured: boolean;
  /** Wait for this before trusting `authenticated` / `user`. */
  ready: boolean;
  authenticated: boolean;
  user: AuthUser | null;
  login: () => void;
  logout: () => Promise<void>;
  /** Access token for authenticating API calls (Bearer). Null when signed out. */
  getAccessToken: () => Promise<string | null>;
  /** The provisioned Celo embedded wallet address (from Privy, client-side), or null. */
  walletAddress: string | null;
  /** Ensure an embedded wallet exists, creating one if needed; returns its address. */
  ensureWallet: () => Promise<string | null>;
}

const unconfigured: AuthState = {
  configured: false,
  ready: true,
  authenticated: false,
  user: null,
  login: () => {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[auth] NEXT_PUBLIC_PRIVY_APP_ID is not set — sign-in is unavailable.');
    }
  },
  logout: async () => {},
  getAccessToken: async () => null,
  walletAddress: null,
  ensureWallet: async () => null,
};

const AuthContext = createContext<AuthState>(unconfigured);

/** Read the current auth state. Always safe — never calls `usePrivy()` directly. */
export function useAuth(): AuthState {
  return useContext(AuthContext);
}

// --- Embedded-wallet provisioning -------------------------------------------------------------
//
// One user = one wallet. Privy already creates it at login (`createOnLogin: 'users-without-wallets'`
// below), so this app must NEVER create one eagerly: doing so raced Privy's own create and minted
// duplicate wallets (up to 4 per user). `ensureWallet` therefore only WAITS for Privy's wallet, and
// creates one itself as a last resort — at most once, throttled, and de-duplicated across callers.

/** How long to wait for Privy's own auto-create before considering a manual fallback. */
const WALLET_WAIT_MS = 12_000;
/** A manual fallback create is attempted at most once per user per this window (per browser). */
const WALLET_CREATE_THROTTLE_MS = 10 * 60 * 1000;
/** In-flight `ensureWallet` per Privy DID, so concurrent callers share one attempt. */
const ensureInflight = new Map<string, Promise<string | null>>();
/** DIDs we've already fired a fallback create for in this page session (even if storage is blocked). */
const fallbackCreated = new Set<string>();
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Bridges Privy's hook into our stable AuthState shape. Only rendered inside PrivyProvider. */
function PrivyBridge({ children }: { children: ReactNode }) {
  const privy = usePrivy();
  const { createWallet } = useCreateWallet();

  // Always-current Privy handles for the stable callbacks below. Kept in refs so the context value
  // (and `ensureWallet`) do NOT change identity on every Privy re-render — that churn is what used
  // to re-trigger wallet creation.
  const privyRef = useRef(privy);
  const createWalletRef = useRef(createWallet);
  useEffect(() => {
    privyRef.current = privy;
    createWalletRef.current = createWallet;
  });

  const userId = privy.user?.id ?? null;
  const email = privy.user?.email?.address ?? undefined;
  // The canonical wallet: the oldest embedded one — the same rule the server uses (wallets/select).
  const walletAddress =
    pickCanonicalWallet(privy.user?.linkedAccounts as unknown as LinkedAccountLike[] | undefined)?.address ?? null;

  const ensureWallet = useCallback(async (): Promise<string | null> => {
    const current = () =>
      pickCanonicalWallet(privyRef.current.user?.linkedAccounts as unknown as LinkedAccountLike[] | undefined)?.address ?? null;
    const have = current();
    if (have) return have;
    const did = privyRef.current.user?.id;
    if (!did) return null;

    const pending = ensureInflight.get(did);
    if (pending) return pending;

    const attempt = (async (): Promise<string | null> => {
      // 1) Give Privy's own create-on-login time to finish. Almost always this is all that's needed.
      const deadline = Date.now() + WALLET_WAIT_MS;
      while (Date.now() < deadline) {
        await sleep(500);
        const a = current();
        if (a) return a;
      }

      // 2) Last resort — Privy never produced one. Create exactly one, and never repeatedly.
      if (fallbackCreated.has(did)) return current();
      const key = `pexa:wallet-create:${did}`;
      try {
        const last = Number(localStorage.getItem(key) ?? 0);
        if (Date.now() - last < WALLET_CREATE_THROTTLE_MS) return current();
        localStorage.setItem(key, String(Date.now()));
      } catch {
        /* storage unavailable: the in-memory guards above still hold for this page session */
      }
      fallbackCreated.add(did);
      try {
        const w = await createWalletRef.current();
        return w?.address ?? current();
      } catch (e) {
        // "Already has a wallet" is the expected case here — read it back rather than retry.
        console.error('[wallet] fallback createWallet failed:', e);
        return current();
      }
    })().finally(() => ensureInflight.delete(did));

    ensureInflight.set(did, attempt);
    return attempt;
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      configured: true,
      ready: privy.ready,
      authenticated: privy.authenticated,
      user: userId ? { id: userId, email } : null,
      login: () => privyRef.current.login(),
      logout: () => privyRef.current.logout(),
      getAccessToken: () => privyRef.current.getAccessToken(),
      walletAddress,
      ensureWallet,
    }),
    [privy.ready, privy.authenticated, userId, email, walletAddress, ensureWallet],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  if (!PRIVY_APP_ID) {
    return <AuthContext.Provider value={unconfigured}>{children}</AuthContext.Provider>;
  }

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        // Email + passkey only (§8) — no external wallet connection (§10).
        loginMethods: ['email', 'passkey'],
        appearance: {
          theme: 'light',
          accentColor: '#1B45D7', // a literal hex: Privy's own modal can't read our CSS variables
          landingHeader: 'Sign in to Pexa',
        },
        // Provision a Celo (EVM) embedded wallet automatically for users who don't have one,
        // with no seed phrase or connect-wallet step (§10). Keys stay in Privy's secure
        // custody and never reach us (§11).
        //
        // `showWalletUIs: false` — PrivyPay is the authorization surface (the agent card /
        // send sheet "Confirm payment" step, §16/§46). We sign headlessly via viem so there's
        // no second, redundant Privy confirmation modal and no blank-screen flash before it.
        embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' }, showWalletUIs: false },
        // Celo is the only settlement network; testnet is the default until launch.
        defaultChain: celoSepolia,
        supportedChains: [celoSepolia, celo],
      }}
    >
      <PrivyBridge>{children}</PrivyBridge>
    </PrivyProvider>
  );
}
