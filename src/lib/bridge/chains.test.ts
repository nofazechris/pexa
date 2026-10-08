import { describe, expect, it } from 'vitest';
import { BRIDGE_CHAINS, availableChains, chainById, chainList, findChain, parseBridgeIntent } from './chains';

const bridge = (text: string, asked = false) => {
  const r = parseBridgeIntent(text, asked);
  if (r.kind === 'bridge') return r.chain?.key ?? 'ask';
  if (r.kind === 'unsupported') return 'unsupported:' + r.name.toLowerCase();
  return r.kind;
};

describe('the supported networks', () => {
  it('have distinct ids and real-looking USDC addresses', () => {
    expect(new Set(BRIDGE_CHAINS.map((c) => c.chainId)).size).toBe(BRIDGE_CHAINS.length);
    for (const c of BRIDGE_CHAINS) expect(c.usdc).toMatch(c.kind === 'evm' ? /^0x[a-fA-F0-9]{40}$/ : /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(chainById(42161)?.label).toBe('Arbitrum');
  });
  it('Solana is offered only when Relay has given us an API key', () => {
    expect(availableChains(false).map((c) => c.key)).not.toContain('solana');
    expect(availableChains(true).map((c) => c.key)).toContain('solana');
    expect(chainList(false)).not.toMatch(/Solana/);
    expect(chainList(true)).toMatch(/Solana/);
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
    ['USDC on Solana', 'solana'],
  ])('%s → %s', (text, key) => expect(findChain(text)?.key).toBe(key));
  it('does not read words that merely contain a network name', () => {
    expect(findChain('I based this on my balance')).toBeNull();
    expect(findChain('What is my Celo balance?')).toBeNull();
    expect(findChain('send 5 to @joyful')).toBeNull();
    expect(findChain('console')).toBeNull();
  });
});

describe('somebody wants to send me money from another network', () => {
  it.each([
    ['somebody wants to send me USDC on Solana', 'solana'],
    ['Somebody wants to send me USDC on Arbitrum', 'arbitrum'],
    ['someone wants to send me money from Base', 'base'],
    ['my friend is sending me USDC from Polygon', 'polygon'],
    ['a client is going to pay me in USDC on Optimism', 'optimism'],
    ['somebody wants to send me USDC', 'ask'],
    ['someone wants to send me money', 'ask'],
    ['my brother wants to send me crypto from another chain', 'ask'],
    ['how can someone send me USDC from Ethereum?', 'ethereum'],
    ['i want to receive USDC from Arbitrum', 'arbitrum'],
  ])('yes: %s', (text, want) => expect(bridge(text)).toBe(want));

  it('a sender who is on Celo or Pexa just needs the normal wallet address', () => {
    expect(bridge('someone on Celo wants to send me USDC')).toBe('celo');
    expect(bridge('Celo', true)).toBe('celo');
    expect(bridge('he is on pexa', true)).toBe('celo');
  });
});

describe('parseBridgeIntent — bringing my own money from another network', () => {
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
    ['I have USDC on Solana, how do I get it to Celo', 'solana'],
  ])('yes: %s', (text, want) => expect(bridge(text)).toBe(want));

  it('recognises the answer to "which network will the USDC come from?"', () => {
    expect(bridge('Arbitrum', true)).toBe('arbitrum');
    expect(bridge('Solana', true)).toBe('solana');
    expect(bridge('base please', true)).toBe('base');
    expect(bridge('Arbitrum', false)).toBe('none');
  });

  it('tells people about networks we cannot do yet', () => {
    expect(bridge('bring usdc from bnb')).toBe('unsupported:bnb');
    expect(bridge('somebody wants to send me USDC on Tron')).toBe('unsupported:tron');
    expect(bridge('bnb', true)).toBe('unsupported:bnb');
  });

  it.each([
    'send 5 USDC to @joyful',
    'Send $5 to joyful on Base',
    'send 5 to joyful',
    'pay @joyful 5 from my wallet',
    "What's my balance?",
    'what can you do?',
    'Add money to my wallet',
    'I have 20 dollars on Celo',
    'Is this Instagram vendor legit? @sneakerplug_ng',
    'hello',
    '@joyful wants to send me $5',
    'joyful is going to pay me back tomorrow',
    'Request $20 from @joyful',
    'Show my recent payments',
    'Save 10% of every payment I get',
  ])('no: %s', (text) => expect(bridge(text)).toBe('none'));
});
