import { describe, expect, it } from 'vitest';
import { parseRelayQuote } from './relay';

const WALLET = '0x52c23c312b27c8361bc37e7c8429f0328c7f5f2a';
const good = () => ({
  requestId: '0x17914867172febe1d4de82e173ff23a6bcb17d96d5b34f24226885a6053c1b11',
  steps: [{ id: 'deposit', depositAddress: '0x21a025c980fa74135e2b9005635df8b16c6a7362' }],
  details: {
    recipient: WALLET,
    currencyOut: { amount: '9960639', currency: { chainId: 42220, address: '0xceba9300f2b948710d2653dd7b07f33a8b32118c' } },
  },
});

describe('parseRelayQuote', () => {
  it('reads a good answer and works out the fee', () => {
    const r = parseRelayQuote(good(), WALLET);
    expect(r.depositAddress).toBe('0x21a025c980fa74135e2b9005635df8b16c6a7362');
    expect(r.estimateFeeUsd).toBe('0.04');
    expect(r.estimateOutAtomic).toBe('9960639');
  });
  it('accepts the wallet in any letter case', () => {
    expect(() => parseRelayQuote(good(), WALLET.toUpperCase().replace('0X', '0x'))).not.toThrow();
  });
  it('never reports a negative fee', () => {
    const q = good();
    q.details.currencyOut.amount = '10010000';
    expect(parseRelayQuote(q, WALLET).estimateFeeUsd).toBe('0.00');
  });
  it('refuses an address that is not headed to this user', () => {
    expect(() => parseRelayQuote(good(), '0x0000000000000000000000000000000000000001')).toThrow('relay_wrong_recipient');
  });
  it('refuses anything that does not land as USDC on Celo', () => {
    const wrongChain = good();
    wrongChain.details.currencyOut.currency.chainId = 1;
    expect(() => parseRelayQuote(wrongChain, WALLET)).toThrow('relay_wrong_destination');
    const wrongToken = good();
    wrongToken.details.currencyOut.currency.address = '0x48065fbbe25f71c9282ddf5e1cd6d6a887483d5e';
    expect(() => parseRelayQuote(wrongToken, WALLET)).toThrow('relay_wrong_destination');
  });
  it('reads a Solana deposit address (base58, case-sensitive)', () => {
    const q = good();
    q.steps = [{ id: 'deposit', depositAddress: 'B7ZtyFcjjJ5z3vA3fKq4p9wH1Zk2mYx6QeRcN8sUdLpa' }];
    expect(parseRelayQuote(q, WALLET, 'svm').depositAddress).toBe('B7ZtyFcjjJ5z3vA3fKq4p9wH1Zk2mYx6QeRcN8sUdLpa');
    expect(() => parseRelayQuote(q, WALLET, 'evm')).toThrow('relay_no_deposit_address');
    expect(() => parseRelayQuote(good(), WALLET, 'svm')).toThrow('relay_no_deposit_address');
  });

  it('refuses a missing or malformed deposit address', () => {
    const none = good();
    none.steps = [{ id: 'deposit', depositAddress: 'not-an-address' }];
    expect(() => parseRelayQuote(none, WALLET)).toThrow('relay_no_deposit_address');
    expect(() => parseRelayQuote({}, WALLET)).toThrow('relay_no_deposit_address');
    expect(() => parseRelayQuote(null, WALLET)).toThrow('relay_no_deposit_address');
  });
});
