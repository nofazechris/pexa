import { describe, expect, it } from 'vitest';
import { generateUid, isUid, normalizeUid } from './uid';

describe('Pexa UID', () => {
  it('generates well-formed IDs without look-alike characters', () => {
    for (let i = 0; i < 500; i++) {
      const uid = generateUid();
      expect(uid).toMatch(/^PX[A-HJ-NP-Z2-9]{6}$/);
      expect(isUid(uid)).toBe(true);
    }
  });

  it('is effectively unique', () => {
    const seen = new Set(Array.from({ length: 5000 }, () => generateUid()));
    expect(seen.size).toBeGreaterThan(4990);
  });

  it('normalizes case and whitespace', () => {
    expect(normalizeUid('  px7k2m9q ')).toBe('PX7K2M9Q');
    expect(isUid('px7k2m9q')).toBe(true);
  });

  it('rejects anything that is not a UID', () => {
    for (const bad of ['', 'PX', 'PX7K2M9', 'PX7K2M9QQ', 'AB7K2M9Q', 'PX0K2M9Q', 'PXOK2M9Q', 'PX1K2M9Q', 'chris', '@chris']) expect(isUid(bad)).toBe(false);
  });
});
