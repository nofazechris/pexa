import { describe, expect, it } from 'vitest';
import { fromDataSuffix } from '@celo/attribution-tags';
import { appendTag } from './tag';

const TAG = 'celo_958bdac0d45b';
const DATA = '0x095ea7b30000000000000000000000005615cdab10dc425a1b6a7a2d5c2e6e4a3e1abc4000000000000000000000000000000000000000000000000000000000000f4240' as const;

describe('appendTag', () => {
  it('adds the tag after the original calldata, leaving the call itself untouched', () => {
    const out = appendTag(DATA, TAG);
    expect(out.startsWith(DATA)).toBe(true);
    expect(out.length).toBeGreaterThan(DATA.length);
    expect(fromDataSuffix(out)?.codes).toEqual([TAG]);
  });
  it('does not tag twice', () => {
    const once = appendTag(DATA, TAG);
    expect(appendTag(once, TAG)).toBe(once);
  });
  it('leaves empty calldata alone (a plain transfer)', () => {
    expect(appendTag('0x', TAG)).toBe('0x');
  });
  it('does nothing without a tag', () => {
    expect(appendTag(DATA, undefined)).toBe(DATA);
    expect(appendTag(DATA, null)).toBe(DATA);
  });
});
