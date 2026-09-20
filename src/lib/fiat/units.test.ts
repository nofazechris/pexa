import { describe, it, expect } from 'vitest';
import { parseNgnToKobo, parseUsdtToUnits, formatKoboToNgn, formatUnitsToUsdt } from './units';

describe('fiat NGN parsing', () => {
  it('parses plain, comma-grouped and ₦-prefixed amounts to kobo', () => {
    expect(parseNgnToKobo('100000')).toBe('10000000');
    expect(parseNgnToKobo('₦100,000')).toBe('10000000');
    expect(parseNgnToKobo('50000 naira')).toBe('5000000');
    expect(parseNgnToKobo('1,000.50')).toBe('100050');
  });
  it('expands k/m suffixes', () => {
    expect(parseNgnToKobo('50k')).toBe('5000000');
    expect(parseNgnToKobo('₦1.5m')).toBe('150000000');
  });
  it('rejects nonsense', () => {
    expect(parseNgnToKobo('abc')).toBeNull();
    expect(parseNgnToKobo('')).toBeNull();
  });
});

describe('fiat USDT parsing', () => {
  it('parses to 6dp units', () => {
    expect(parseUsdtToUnits('100')).toBe('100000000');
    expect(parseUsdtToUnits('100.5 USDT')).toBe('100500000');
    expect(parseUsdtToUnits('0.000001')).toBe('1');
  });
  it('truncates beyond 6dp', () => {
    expect(parseUsdtToUnits('1.1234567')).toBe('1123456');
  });
});

describe('fiat formatting', () => {
  it('formats kobo → grouped naira with 2dp', () => {
    expect(formatKoboToNgn('10000000')).toBe('100,000.00');
    expect(formatKoboToNgn('160700')).toBe('1,607.00');
  });
  it('formats 6dp units → trimmed USDT', () => {
    expect(formatUnitsToUsdt('61724565')).toBe('61.724565');
    expect(formatUnitsToUsdt('100000000')).toBe('100');
  });
});
