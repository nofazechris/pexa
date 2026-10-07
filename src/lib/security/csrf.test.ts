import { describe, expect, it } from 'vitest';
import { isCrossSiteWrite } from './csrf';

const req = (method: string, headers: Record<string, string> = {}, url = 'https://pexaapp.xyz/api/contacts') => new Request(url, { method, headers });

describe('isCrossSiteWrite', () => {
  it('never blocks reads', () => {
    expect(isCrossSiteWrite(req('GET', { 'sec-fetch-site': 'cross-site' }))).toBe(false);
    expect(isCrossSiteWrite(req('HEAD', { origin: 'https://evil.test' }))).toBe(false);
  });

  it('never blocks the app’s own calls, which carry an explicit bearer header', () => {
    expect(isCrossSiteWrite(req('POST', { authorization: 'Bearer abc.def', 'sec-fetch-site': 'same-origin' }))).toBe(false);
    expect(isCrossSiteWrite(req('POST', { authorization: 'Bearer abc.def', origin: 'https://evil.test' }))).toBe(false);
  });

  it('blocks a cookie-authenticated write started by another website', () => {
    expect(isCrossSiteWrite(req('POST', { 'sec-fetch-site': 'cross-site' }))).toBe(true);
    expect(isCrossSiteWrite(req('PUT', { 'sec-fetch-site': 'same-site' }))).toBe(true);
    expect(isCrossSiteWrite(req('DELETE', { origin: 'https://evil.test' }))).toBe(true);
    expect(isCrossSiteWrite(req('POST', { origin: 'https://pexaapp.xyz.evil.test' }))).toBe(true);
    expect(isCrossSiteWrite(req('POST', { origin: 'null' }))).toBe(true);
  });

  it('allows a cookie-authenticated write from our own pages', () => {
    expect(isCrossSiteWrite(req('POST', { 'sec-fetch-site': 'same-origin' }))).toBe(false);
    expect(isCrossSiteWrite(req('POST', { origin: 'https://pexaapp.xyz' }))).toBe(false);
  });

  it('does not treat a bare "Authorization: Bearer" with no token as proof', () => {
    expect(isCrossSiteWrite(req('POST', { authorization: 'Bearer ', 'sec-fetch-site': 'cross-site' }))).toBe(true);
  });

  it('leaves non-browser clients (no provenance headers) alone — they cannot be forged from a victim’s browser', () => {
    expect(isCrossSiteWrite(req('POST'))).toBe(false);
  });
});
