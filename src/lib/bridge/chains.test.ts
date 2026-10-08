import { describe, expect, it } from 'vitest';
import { BRIDGE_CHAINS, chainById, findChain, parseBridgeIntent } from './chains';

const bridge = (text: string, asked = false) => {
  const r = parseBridgeIntent(text, asked);
  return r.kind === 'bridge' ? (r.chain?.key ?? 'ask') : r.kind === 'unsupported' ? 'unsupported:' + r.name.toLowerCase() : 'none';
};

describe('the supported networks', () => {
  it('have distinct ids and real-looking USDC addresses', () => {
    expect(new Set(BRIDGE_CHAINS.map((c) => c.chainId)).size).toBe(BRIDGE_CHAINS.length);
    for (const c of BRIDGE_CHAINS) expect(c.usdc).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(chainById(42161)?.label).toBe('Arbitrum');
  });
});

describe('findChain', () => {
  it.each([
    ['I have USDC on Arbitrum', 'arbitrum'],
    ['i have usdc on arbitrium', 'arbitrum'],
    ['from base', 'base'],
    ['Polygon', 'polygon'],
    ['OP Mainnet', 'optimism'],
    ['ethereum', 'ethereum'],
  ])('%s → %s', (text, key) => expect(findChain(text)?.key).toBe(key));
  it('does not read words that merely contain a network name', () => {
    expect(findChain('I based this on my balance')).toBeNull();
    expect(findChain('What is my Celo balance?')).toBeNull();
    expect(findChain('send 5 to @joyful')).toBeNull();
  });
});

describe('parseBridgeIntent — bringing money from another network', () => {
  it.each([
    ['i have USDC on arbitrium, how do I get it to Celo', 'arbitrum'],
    ['Bring USDC from Arbitrum', 'arbitrum'],
    ['bridge from base', 'base'],
    ['I want to bridge money to Celo', 'ask'],
    ['how do I move my usdc from ethereum to my wallet', 'ethereum'],
    ['can I receive from another chain?', 'ask'],
    ['deposit usdc from polygon', 'polygon'],
    ['cross-chain deposit', 'ask'],
    ['I hold USDC on Optimism', 'optimism'],
  ])('yes: %s', (text, want) => expect(bridge(text)).toBe(want));

  it('recognises the answer to "which network?"', () => {
    expect(bridge('Arbitrum', true)).toBe('arbitrum');
    expect(bridge('base please', true)).toBe('base');
    expect(bridge('Arbitrum', false)).toBe('none');
  });

  it('tells people about networks we cannot do yet', () => {
    expect(bridge('I have USDC on Solana, how do I get it to Celo')).toBe('unsupported:solana');
    expect(bridge('solana', true)).toBe('unsupported:solana');
    expect(bridge('bring usdc from bnb')).toBe('unsupported:bnb');
  });

  it.each([
    'send 5 USDC to @joyful',
    'Send $5 to joyful on Base',
    'pay @joyful 5 from my wallet',
    "What's my balance?",
    'what can you do?',
    'Add money to my wallet',
    'I have 20 dollars on Celo',
    'Is this Instagram vendor legit? @sneakerplug_ng',
    'hello',
  ])('no: %s', (text) => expect(bridge(text)).toBe('none'));
});
