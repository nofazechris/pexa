import { describe, expect, it } from 'vitest';
import { checkExternalRecipient } from './recipient';

const GOOD_LOWER = '0x52c23c312b27c8361bc37e7c8429f0328c7f5f2a';
const GOOD_CHECKSUM = '0x52c23C312b27c8361bc37E7c8429f0328c7F5F2A'; // placeholder, replaced below with the real checksum

describe('checkExternalRecipient', () => {
  const real = (() => {
    const r = checkExternalRecipient(GOOD_LOWER);
    return r.ok ? r.address : GOOD_CHECKSUM;
  })();

  it('accepts a lower-case address and returns it checksummed', () => {
    const r = checkExternalRecipient(GOOD_LOWER);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.address.toLowerCase()).toBe(GOOD_LOWER);
      expect(r.address).not.toBe(GOOD_LOWER); // mixed case now
    }
  });

  it('accepts the correct checksum form, and an all-caps form', () => {
    expect(checkExternalRecipient(real).ok).toBe(true);
    expect(checkExternalRecipient('0x' + GOOD_LOWER.slice(2).toUpperCase()).ok).toBe(true);
  });

  it('refuses a mixed-case address whose checksum is wrong (a typo)', () => {
    // flip the case of one letter of a correct checksum address
    const i = real.split('').findIndex((c, idx) => idx > 1 && /[a-f]/i.test(c));
    const flipped = real.slice(0, i) + (real[i] === real[i].toLowerCase() ? real[i].toUpperCase() : real[i].toLowerCase()) + real.slice(i + 1);
    const r = checkExternalRecipient(flipped);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/typo/);
  });

  it.each(['', '0x123', 'joyful', '52c23c312b27c8361bc37e7c8429f0328c7f5f2a', '0x52c23c312b27c8361bc37e7c8429f0328c7f5f2a00', '0xZZc23c312b27c8361bc37e7c8429f0328c7f5f2a'])('refuses a malformed address: %s', (a) => {
    expect(checkExternalRecipient(a).ok).toBe(false);
  });

  it('refuses burn addresses, token contracts and the Uniswap router', () => {
    for (const a of [
      '0x0000000000000000000000000000000000000000',
      '0x000000000000000000000000000000000000dEaD',
      '0xcebA9300f2b948710d2653dD7B07f33A8B32118C', // USDC
      '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e', // USDT
      '0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771', // USAT
      '0x5615cdab10dc425a742d643d949a7f474c01abc4', // Uniswap router
    ]) {
      expect(checkExternalRecipient(a).ok, a).toBe(false);
    }
  });

  it('refuses the sender’s own wallet', () => {
    const r = checkExternalRecipient(GOOD_LOWER, { ownAddress: GOOD_LOWER.toUpperCase().replace('0X', '0x') });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/own/);
  });
});
