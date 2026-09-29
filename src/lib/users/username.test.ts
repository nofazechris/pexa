import { describe, it, expect } from 'vitest';
import { normalizeUsername, validateUsername, isValidUsername, generateUsernameCandidates, USERNAME_MAX } from './username';

describe('username normalization', () => {
  it('strips a leading @, trims and lowercases', () => {
    expect(normalizeUsername('  @Sarah ')).toBe('sarah');
    expect(normalizeUsername('@@MiKe')).toBe('mike');
  });
});

describe('username validation', () => {
  it('accepts a well-formed username', () => {
    expect(isValidUsername('sarah_01')).toBe(true);
    expect(validateUsername('chris')).toBeNull();
  });

  it('rejects too short and too long', () => {
    expect(validateUsername('ab')).toBe('too_short');
    expect(validateUsername('a'.repeat(USERNAME_MAX + 1))).toBe('too_long');
  });

  it('rejects invalid characters (uppercase survives only via normalize, spaces, symbols)', () => {
    expect(validateUsername('sarah-okafor')).toBe('invalid_chars');
    expect(validateUsername('sarah okafor')).toBe('invalid_chars');
    expect(validateUsername('sarah!')).toBe('invalid_chars');
  });

  it('normalizes case before validating, so @Sarah is valid', () => {
    expect(validateUsername('@Sarah')).toBeNull();
  });

  it('blocks reserved words (case/@-insensitively)', () => {
    expect(validateUsername('admin')).toBe('reserved');
    expect(validateUsername('@PrivyPay')).toBe('reserved');
    expect(validateUsername('@Pexa')).toBe('reserved'); // the product's own name can't be impersonated
    expect(validateUsername('SUPPORT')).toBe('reserved');
  });

  it('allows underscores and digits, and reserved only matches the exact word', () => {
    expect(isValidUsername('a_b_2')).toBe(true);
    // "user" is reserved, but "user_2026" is a distinct, allowed name.
    expect(isValidUsername('user_2026')).toBe(true);
    expect(validateUsername('user')).toBe('reserved');
  });
});

describe('generateUsernameCandidates', () => {
  it('derives valid, distinct suffixed candidates from a taken base', () => {
    const candidates = generateUsernameCandidates('chris', 3);
    expect(candidates.length).toBe(3);
    expect(new Set(candidates).size).toBe(candidates.length);
    for (const c of candidates) {
      expect(c.startsWith('chris')).toBe(true);
      expect(isValidUsername(c)).toBe(true);
    }
  });

  it('sanitizes an unusable base (reserved word, or invalid chars) into a valid stem', () => {
    for (const c of generateUsernameCandidates('admin', 2)) expect(isValidUsername(c)).toBe(true);
    for (const c of generateUsernameCandidates('sarah okafor!', 2)) expect(isValidUsername(c)).toBe(true);
  });

  it('keeps the closest variants first, and falls back to natural prefixes when more are needed', () => {
    const all = generateUsernameCandidates('chris', 20);
    expect(all.slice(0, 3)).toEqual(['chris1', 'chris2', 'chris_1']);
    expect(all).toContain('itschris');
    expect(all).toContain('realchris');
    expect(all.some((c) => /20\d\d$/.test(c))).toBe(false); // no year suffixes that go stale
    for (const c of all) expect(isValidUsername(c)).toBe(true);
  });

  it('never exceeds the max length even for a long base', () => {
    const candidates = generateUsernameCandidates('a'.repeat(USERNAME_MAX), 5);
    for (const c of candidates) expect(c.length).toBeLessThanOrEqual(USERNAME_MAX);
  });
});
