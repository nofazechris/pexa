import { describe, expect, it } from 'vitest';
import { cityFromHeader, locationHelp } from './approx';

describe('cityFromHeader', () => {
  it.each([
    ['Lagos', 'Lagos'],
    ['Port%20Harcourt', 'Port Harcourt'],
    ['S%C3%A3o%20Paulo', 'São Paulo'],
    ["Ibadan", 'Ibadan'],
    ["O'Fallon", "O'Fallon"],
    ['  Abuja  ', 'Abuja'],
  ])('%s → %s', (raw, want) => expect(cityFromHeader(raw)).toBe(want));

  it.each([null, undefined, '', 'x', '123', 'Lagos<script>', 'a'.repeat(80), '%E0%A4%A'])('%s → no guess', (raw) => expect(cityFromHeader(raw as string | null)).toBeNull());
});

describe('locationHelp', () => {
  it('gives iPhone, Android and desktop their own steps', () => {
    expect(locationHelp('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)').steps.join(' ')).toMatch(/Location Services/);
    expect(locationHelp('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120').steps.join(' ')).toMatch(/Permissions/);
    expect(locationHelp('Mozilla/5.0 (Windows NT 10.0) Chrome/120').title).toMatch(/this site/);
  });
  it('always has a title and at least two steps', () => {
    for (const ua of ['', 'curl/8', 'Mozilla/5.0 (Macintosh)']) {
      const h = locationHelp(ua);
      expect(h.title.length).toBeGreaterThan(5);
      expect(h.steps.length).toBeGreaterThanOrEqual(2);
    }
  });
});
