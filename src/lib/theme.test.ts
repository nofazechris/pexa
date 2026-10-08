import { describe, expect, it } from 'vitest';
import { isThemedPath, parseThemePref, resolveTheme, themeInitScript } from './theme';

describe('which screens follow the theme', () => {
  it.each(['/app', '/app/', '/login', '/onboarding', '/app/anything'])('themed: %s', (p) => expect(isThemedPath(p)).toBe(true));
  it.each(['/', '/r/abc', '/styleguide', '/application', '/login-help', null, undefined])('stays light: %s', (p) => expect(isThemedPath(p as string)).toBe(false));
});

describe('resolveTheme', () => {
  it('follows the phone by default', () => {
    expect(resolveTheme('system', '/app', true)).toBe('dark');
    expect(resolveTheme('system', '/app', false)).toBe('light');
  });
  it('an explicit choice beats the phone', () => {
    expect(resolveTheme('light', '/app', true)).toBe('light');
    expect(resolveTheme('dark', '/app', false)).toBe('dark');
  });
  it('the landing page is always light', () => {
    expect(resolveTheme('dark', '/', true)).toBe('light');
  });
});

describe('parseThemePref', () => {
  it('only accepts known values', () => {
    expect(parseThemePref('dark')).toBe('dark');
    expect(parseThemePref('light')).toBe('light');
    expect(parseThemePref('system')).toBe('system');
    expect(parseThemePref('purple')).toBe('system');
    expect(parseThemePref(null)).toBe('system');
  });
});

describe('the pre-paint script', () => {
  it('is valid JavaScript with a working path test', () => {
    expect(() => new Function(themeInitScript)).not.toThrow();
    expect(themeInitScript).toContain('(app|login|onboarding)');
    expect(themeInitScript).toContain('pexa-theme');
  });
  it('sets dark only on themed screens', () => {
    const run = (path: string, stored: string | null, prefersDark: boolean) => {
      const attrs: Record<string, string> = {};
      const meta = { content: '', setAttribute(_k: string, v: string) { this.content = v; } };
      new Function('location', 'localStorage', 'window', 'document', themeInitScript)(
        { pathname: path },
        { getItem: () => stored },
        { matchMedia: () => ({ matches: prefersDark }) },
        { documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) }, querySelector: () => meta },
      );
      return { attrs, meta: meta.content };
    };
    expect(run('/app', 'dark', false).attrs['data-theme']).toBe('dark');
    expect(run('/app', null, true).attrs['data-theme']).toBe('dark');
    expect(run('/app', 'light', true).attrs['data-theme']).toBeUndefined();
    expect(run('/', 'dark', true).attrs['data-theme']).toBeUndefined();
    expect(run('/app', 'dark', false).meta).toBe('#0A0E15');
  });
});
