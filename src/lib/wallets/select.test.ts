import { describe, expect, it } from 'vitest';
import { findWalletByAddress, listEmbeddedWallets, pickCanonicalWallet } from './select';

const w = (address: string, extra: Record<string, unknown> = {}) => ({
  type: 'wallet',
  address,
  walletClientType: 'privy',
  chainType: 'ethereum',
  ...extra,
});

describe('pickCanonicalWallet', () => {
  it('returns null when there is no embedded wallet', () => {
    expect(pickCanonicalWallet([])).toBeNull();
    expect(pickCanonicalWallet(null)).toBeNull();
    expect(pickCanonicalWallet([{ type: 'email', address: 'a@b.c' }])).toBeNull();
  });

  it('ignores external wallets and non-Ethereum chains', () => {
    const accounts = [
      { type: 'wallet', address: '0xEXT', walletClientType: 'metamask', chainType: 'ethereum' },
      { type: 'wallet', address: '0xSOL', walletClientType: 'privy', chainType: 'solana' },
      w('0xMINE'),
    ];
    expect(pickCanonicalWallet(accounts)?.address).toBe('0xMINE');
  });

  it('picks the OLDEST wallet even if Privy lists a newer one first', () => {
    const accounts = [w('0xNEW', { firstVerifiedAt: new Date('2026-09-29') }), w('0xOLD', { firstVerifiedAt: new Date('2026-09-13') })];
    expect(pickCanonicalWallet(accounts)?.address).toBe('0xOLD');
  });

  it('understands epoch seconds and falls back to verifiedAt', () => {
    const accounts = [w('0xB', { firstVerifiedAt: 1790000200 }), w('0xA', { firstVerifiedAt: 1790000100 }), w('0xC', { verifiedAt: 1790000300 })];
    expect(listEmbeddedWallets(accounts).map((a) => a.address)).toEqual(['0xA', '0xB', '0xC']);
  });

  it('is stable: unknown ages keep Privy’s own order, so the choice never flips between calls', () => {
    const accounts = [w('0x1'), w('0x2'), w('0x3')];
    expect(pickCanonicalWallet(accounts)?.address).toBe('0x1');
    expect(pickCanonicalWallet([...accounts].reverse())?.address).toBe('0x3'); // order-driven, deterministic
    expect(pickCanonicalWallet(accounts)?.address).toBe(pickCanonicalWallet(accounts)?.address);
  });
});

describe('findWalletByAddress', () => {
  const accounts = [w('0xAbC0000000000000000000000000000000000001'), w('0xdef0000000000000000000000000000000000002')];

  it('matches case-insensitively', () => {
    expect(findWalletByAddress(accounts, '0xABC0000000000000000000000000000000000001')?.address).toBe('0xAbC0000000000000000000000000000000000001');
  });

  it('returns null for an address that is not one of the user’s wallets (fail closed)', () => {
    expect(findWalletByAddress(accounts, '0x0000000000000000000000000000000000000dead')).toBeNull();
  });
});
