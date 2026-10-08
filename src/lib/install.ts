/**
 * "Add Pexa to your home screen."
 *
 * Android Chrome hands the page a one-time install offer (`beforeinstallprompt`) that has to be caught early and kept;
 * iPhones have no such offer, so people have to be shown Share → Add to Home Screen. Pure helpers decide what to show;
 * the small store below holds the browser's offer.
 */

export type InstallKind =
  /** Already running as an app (or nothing to offer). */
  | 'installed'
  /** iPhone / iPad: show the Share → Add to Home Screen steps. */
  | 'ios'
  /** Android with the browser's own one-tap install ready. */
  | 'prompt'
  /** Android (or another phone) without the one-tap offer: point to the browser menu. */
  | 'manual'
  /** A computer: nothing to suggest. */
  | 'none';

export interface InstallEnv {
  userAgent: string;
  maxTouchPoints: number;
  platform?: string;
  standalone: boolean;
  hasPrompt: boolean;
}

export function isIos(env: Pick<InstallEnv, 'userAgent' | 'maxTouchPoints' | 'platform'>): boolean {
  if (/iphone|ipad|ipod/i.test(env.userAgent)) return true;
  // iPadOS reports itself as a Mac, but a Mac has no touch screen.
  return env.platform === 'MacIntel' && env.maxTouchPoints > 1;
}

export function installKind(env: InstallEnv): InstallKind {
  if (env.standalone) return 'installed';
  if (isIos(env)) return 'ios';
  if (/android/i.test(env.userAgent)) return env.hasPrompt ? 'prompt' : 'manual';
  return 'none';
}

/** The banner nudges once in a while, not on every visit. */
export const INSTALL_NUDGE_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

export function shouldNudge(dismissedAt: number | null, now: number): boolean {
  return dismissedAt === null || now - dismissedAt > INSTALL_NUDGE_COOLDOWN_MS;
}

/* ----------------------------------------------------------------- browser store (client only) */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'pexa-install-dismissed';
let deferred: BeforeInstallPromptEvent | null = null;
let installedNow = false;
let started = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Call once at startup: keeps the browser's one-time install offer for later. */
export function initInstallCapture(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installedNow = true;
    notify();
  });
}

export function subscribeInstall(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getInstallKind(): InstallKind {
  if (typeof window === 'undefined') return 'none';
  const standalone = installedNow || window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return installKind({
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    platform: navigator.platform,
    standalone,
    hasPrompt: deferred !== null,
  });
}

/** Android: show the browser's own install dialog. Resolves true if they installed. */
export async function promptInstall(): Promise<boolean> {
  const e = deferred;
  if (!e) return false;
  deferred = null; // the offer can only be used once
  notify();
  try {
    await e.prompt();
    const choice = await e.userChoice;
    return choice.outcome === 'accepted';
  } catch {
    return false;
  }
}

export function getNudgeDismissedAt(): number | null {
  try {
    const v = Number(localStorage.getItem(DISMISS_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

export function dismissNudge(): void {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
  notify();
}

/** Has the banner been dismissed recently? (Snapshot for the UI.) */
export function getNudgeAllowed(): boolean {
  return shouldNudge(getNudgeDismissedAt(), Date.now());
}
