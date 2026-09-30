import { describe, expect, it } from 'vitest';
import { buildReferralLink, CODE_ALPHABET, CODE_LENGTH, generateReferralCode, normalizeReferralCode, shareMessage, shareUrls } from './code';

describe('generateReferralCode', () => {
  it('is the right length and only uses the unambiguous alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const c = generateReferralCode();
      expect(c).toHaveLength(CODE_LENGTH);
      for (const ch of c) expect(CODE_ALPHABET).toContain(ch);
    }
  });

  it('never contains look-alike characters', () => {
    expect(CODE_ALPHABET).not.toMatch(/[il o01]/);
  });

  it('is effectively unique across many draws', () => {
    const seen = new Set(Array.from({ length: 5000 }, () => generateReferralCode()));
    expect(seen.size).toBe(5000);
  });

  it('is roughly uniform across the alphabet (no modulo bias)', () => {
    const counts = new Map<string, number>();
    const draws = 4000; // 32,000 characters over 31 symbols ≈ 1,032 each
    for (let i = 0; i < draws; i++) for (const ch of generateReferralCode()) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    const expected = (draws * CODE_LENGTH) / CODE_ALPHABET.length;
    for (const ch of CODE_ALPHABET) expect(Math.abs((counts.get(ch) ?? 0) - expected) / expected).toBeLessThan(0.2);
  });
});

describe('normalizeReferralCode', () => {
  it('accepts and lowercases a well-formed code', () => {
    expect(normalizeReferralCode('  AbC23xyZ  ')).toBe('abc23xyz');
  });

  it('rejects junk so it never reaches the database', () => {
    for (const bad of ['', 'abc', 'a'.repeat(17), 'has space1', "x'; drop table users;--", '../etc/passwd', 12345, null, undefined, {}]) {
      expect(normalizeReferralCode(bad)).toBeNull();
    }
  });
});

describe('links and sharing', () => {
  it('builds the /r/<code> share link and tolerates a trailing slash on the origin', () => {
    expect(buildReferralLink('https://pexaapp.xyz', 'abc23xyz')).toBe('https://pexaapp.xyz/r/abc23xyz');
    expect(buildReferralLink('https://pexaapp.xyz/', 'abc23xyz')).toBe('https://pexaapp.xyz/r/abc23xyz');
  });

  it('the ready-made tweet states the position and asks people to use the referral link to climb', () => {
    const t = shareMessage({ position: 12 });
    expect(t).toContain("I'm #12 on the Pexa waitlist");
    expect(t.toLowerCase()).toContain('referral link');
    expect(t.toLowerCase()).toContain('climb up the ranking');
  });

  it('has a sensible tweet when the position is not known, with no stray "#"', () => {
    expect(shareMessage()).not.toContain('#');
    expect(shareMessage().toLowerCase()).toContain('referral link');
  });

  it('URL-encodes the link and text in every share URL', () => {
    const link = 'https://pexaapp.xyz/r/abc23xyz';
    const urls = shareUrls(link, "I'm #3 & ready");
    expect(urls.x).toContain(encodeURIComponent(link));
    expect(urls.x).toContain(encodeURIComponent("I'm #3 & ready"));
    expect(urls.whatsapp).toContain(encodeURIComponent(link));
    expect(urls.telegram).toContain(encodeURIComponent(link));
  });

  it('the X link opens a ready-to-post tweet: text + link + the #Pexa hashtag', () => {
    const u = new URL(shareUrls('https://pexaapp.xyz/r/abc23xyz', 'hello').x);
    expect(u.hostname).toBe('twitter.com');
    expect(u.pathname).toBe('/intent/tweet');
    expect(u.searchParams.get('text')).toBe('hello');
    expect(u.searchParams.get('url')).toBe('https://pexaapp.xyz/r/abc23xyz');
    expect(u.searchParams.get('hashtags')).toBe('Pexa');
  });
});
