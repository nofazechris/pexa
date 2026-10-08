import { describe, expect, it } from 'vitest';
import { INSTALL_NUDGE_COOLDOWN_MS, installKind, isIos, shouldNudge } from './install';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const base = { maxTouchPoints: 0, platform: '', standalone: false, hasPrompt: false };

describe('installKind', () => {
  it('iPhone gets the manual Share steps', () => {
    expect(installKind({ ...base, userAgent: IPHONE, maxTouchPoints: 5 })).toBe('ios');
  });
  it('iPad that pretends to be a Mac is still an iPad', () => {
    expect(isIos({ userAgent: MAC, maxTouchPoints: 5, platform: 'MacIntel' })).toBe(true);
    expect(isIos({ userAgent: MAC, maxTouchPoints: 0, platform: 'MacIntel' })).toBe(false);
  });
  it('Android uses the one-tap install when the browser offered it', () => {
    expect(installKind({ ...base, userAgent: ANDROID, hasPrompt: true })).toBe('prompt');
  });
  it('Android without the offer falls back to the browser menu', () => {
    expect(installKind({ ...base, userAgent: ANDROID })).toBe('manual');
  });
  it('a computer gets nothing', () => {
    expect(installKind({ ...base, userAgent: WINDOWS })).toBe('none');
  });
  it('already installed wins over everything', () => {
    expect(installKind({ ...base, userAgent: IPHONE, standalone: true })).toBe('installed');
    expect(installKind({ ...base, userAgent: ANDROID, standalone: true, hasPrompt: true })).toBe('installed');
  });
});

describe('shouldNudge', () => {
  const now = 1_000_000_000_000;
  it('asks when they never dismissed it', () => expect(shouldNudge(null, now)).toBe(true));
  it('stays quiet right after a dismissal', () => expect(shouldNudge(now - 1000, now)).toBe(false));
  it('asks again after the cooldown', () => expect(shouldNudge(now - INSTALL_NUDGE_COOLDOWN_MS - 1, now)).toBe(true));
});
