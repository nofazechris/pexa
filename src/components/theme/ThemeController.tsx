'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { THEME_COLOR, THEME_KEY, parseThemePref, resolveTheme, type ThemePref } from '@/lib/theme';
import { initInstallCapture } from '@/lib/install';

/** The remembered choice, shared by the controller and the Settings toggle. */
const listeners = new Set<() => void>();

function readPref(): ThemePref {
  try {
    return parseThemePref(localStorage.getItem(THEME_KEY));
  } catch {
    return 'system';
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === THEME_KEY) cb();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', onStorage);
  };
}

export function useThemePref(): [ThemePref, (p: ThemePref) => void] {
  const pref = useSyncExternalStore(subscribe, readPref, () => 'system' as ThemePref);
  const set = (p: ThemePref) => {
    try {
      localStorage.setItem(THEME_KEY, p);
    } catch {
      /* private mode: the choice just lasts until the page closes */
    }
    listeners.forEach((l) => l());
  };
  return [pref, set];
}

/**
 * Keeps <html data-theme> in step with the choice, the phone's setting and the screen (the landing page stays light).
 * The pre-paint script in the layout does the first paint; this takes over from there (including client-side navigation).
 */
export function ThemeController() {
  const pathname = usePathname();
  const pref = useSyncExternalStore(subscribe, readPref, () => 'system' as ThemePref);

  useEffect(() => {
    // Start listening for the browser's "install this app" offer as early as possible; it fires only once.
    initInstallCapture();
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const theme = resolveTheme(pref, pathname, mq.matches);
      const html = document.documentElement;
      if (theme === 'dark') html.setAttribute('data-theme', 'dark');
      else html.removeAttribute('data-theme');
      document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', THEME_COLOR[theme]));
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [pref, pathname]);

  return null;
}
