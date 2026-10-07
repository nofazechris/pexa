import { describe, expect, it } from 'vitest';
import { requestHasSecret, safeEqual } from './secret';

const req = (headers: Record<string, string> = {}, url = 'https://x.test/api/cron') => new Request(url, { headers });

describe('safeEqual', () => {
  it('matches only identical secrets', () => {
    expect(safeEqual('s3cret-value', 's3cret-value')).toBe(true);
    expect(safeEqual('s3cret-value', 's3cret-valuf')).toBe(false);
    expect(safeEqual('s3cret-value', 's3cret')).toBe(false);
    expect(safeEqual('s3cret', 's3cret-value-longer')).toBe(false);
  });
  it('never matches an empty or missing secret, even against itself', () => {
    expect(safeEqual('', '')).toBe(false);
    expect(safeEqual(null, null)).toBe(false);
    expect(safeEqual(undefined, 'x')).toBe(false);
    expect(safeEqual('x', null)).toBe(false);
  });
});

describe('requestHasSecret', () => {
  const S = 'cron-secret-123';
  it('accepts a Bearer header, case-insensitively', () => {
    expect(requestHasSecret(req({ authorization: `Bearer ${S}` }), S)).toBe(true);
    expect(requestHasSecret(req({ authorization: `bearer ${S}` }), S)).toBe(true);
  });
  it('rejects a wrong or missing credential', () => {
    expect(requestHasSecret(req({ authorization: 'Bearer nope' }), S)).toBe(false);
    expect(requestHasSecret(req({ authorization: S }), S)).toBe(false); // no "Bearer"
    expect(requestHasSecret(req(), S)).toBe(false);
  });
  it('accepts only the extra header / query parameter the caller allows', () => {
    expect(requestHasSecret(req({ 'x-cron-secret': S }), S)).toBe(false);
    expect(requestHasSecret(req({ 'x-cron-secret': S }), S, { headers: ['x-cron-secret'] })).toBe(true);
    expect(requestHasSecret(req({}, `https://x.test/e?key=${S}`), S)).toBe(false);
    expect(requestHasSecret(req({}, `https://x.test/e?key=${S}`), S, { queryParams: ['key'] })).toBe(true);
  });
  it('is closed when no secret is configured', () => {
    expect(requestHasSecret(req({ authorization: 'Bearer ' }), undefined)).toBe(false);
    expect(requestHasSecret(req({ authorization: 'Bearer ' }), '')).toBe(false);
    expect(requestHasSecret(req({ 'x-cron-secret': '' }), '', { headers: ['x-cron-secret'] })).toBe(false);
  });
});
