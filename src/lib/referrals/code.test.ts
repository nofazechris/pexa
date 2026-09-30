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
  it('builds the link and tolerates a trailing slash on the origin', () => {
    expect(buildReferralLink('https://pexaapp.xyz', 'abc23xyz')).toBe('https://pexaapp.xyz/?ref=abc23xyz');
    expect(buildReferralLink('https://pexaapp.xyz/', 'abc23xyz')).toBe('https://pexaapp.xyz/?ref=abc23xyz');
  });

  it('mentions the position only when known', () => {
    expect(shareMessage({ position: 12 })).toContain('#12');
    expect(shareMessage()).not.toContain('#');
  });

  it('URL-encodes the link and text in every share URL', () => {
    const link = 'https://pexaapp.xyz/?ref=abc23xyz';
    const urls = shareUrls(link, "I'm #3 & ready");
    expect(urls.x).toContain(encodeURIComponent(link));
    expect(urls.x).toContain(encodeURIComponent("I'm #3 & ready"));
    expect(urls.whatsapp).toContain(encodeURIComponent(link));
    expect(urls.telegram).toContain(encodeURIComponent(link));
  });
});
