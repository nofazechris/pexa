/**
 * Light / dark theme. The choice (Light, Dark or follow the phone) is remembered in this browser, and it only applies on
 * the signed-in screens: the marketing page always stays light. Colours live in `globals.css`; dark swaps them under
 * `html[data-theme='dark']`.
 */

export type ThemePref = 'light' | 'dark' | 'system';

export const THEME_KEY = 'pexa-theme';
export const THEME_COLOR = { light: '#F6F7F9', dark: '#0A0E15' } as const;

/** Screens that follow the user's theme; everything else (the landing page, share links) stays light. */
export function isThemedPath(pathname: string | null | undefined): boolean {
  return /^\/(app|login|onboarding)(\/|$)/.test(pathname ?? '');
}

export function parseThemePref(v: unknown): ThemePref {
  return v === 'light' || v === 'dark' ? v : 'system';
}

/** Which theme actually shows, given the choice, the screen and whether the phone prefers dark. */
export function resolveTheme(pref: ThemePref, pathname: string | null | undefined, systemDark: boolean): 'light' | 'dark' {
  if (!isThemedPath(pathname)) return 'light';
  if (pref === 'system') return systemDark ? 'dark' : 'light';
  return pref;
}

/**
 * Runs in <head> before the page paints so a dark screen never flashes white. Same rule as `resolveTheme`
 * (kept inline because it has to run before any bundle loads).
 */
export const themeInitScript = `(function(){try{var p=location.pathname;if(!/^\\/(app|login|onboarding)(\\/|$)/.test(p))return;var s=localStorage.getItem('${THEME_KEY}');var d=s==='dark'||(s!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d){document.documentElement.setAttribute('data-theme','dark');var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute('content','${THEME_COLOR.dark}');}}catch(e){}})();`;
