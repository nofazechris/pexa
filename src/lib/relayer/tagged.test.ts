import { describe, expect, it } from 'vitest';
import { verifyTx } from '@celo/attribution-tags';
import { createPublicClient, custom, parseTransaction, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { celo } from 'viem/chains';
import { walletWithTag } from './tagged';

const account = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const TAG = 'celo_b7k3p9da';
const TO = '0x000000000000000000000000000000000000dEaD';

/** A fake chain node: answers the few calls a send needs and keeps the raw transaction it was handed. */
function fakeNode() {
  const sent: string[] = [];
  const transport = custom({
    async request({ method, params }: { method: string; params?: unknown }) {
      switch (method) {
        case 'eth_chainId': return toHex(celo.id);
        case 'eth_getTransactionCount': return '0x1';
        case 'eth_estimateGas': return '0x5208';
        case 'eth_gasPrice': return '0x3b9aca00';
        case 'eth_maxPriorityFeePerGas': return '0x3b9aca00';
        case 'eth_getBlockByNumber': return { number: '0x1', baseFeePerGas: '0x3b9aca00', timestamp: '0x1', transactions: [] };
        case 'eth_sendRawTransaction': sent.push((params as string[])[0]); return '0x' + '11'.repeat(32);
        case 'eth_getTransactionByHash': return { hash: '0x' + '11'.repeat(32), input: parseTransaction(sent[0] as `0x${string}`).data ?? '0x', from: account.address, to: TO, blockNumber: '0x1' };
        default: throw new Error('unexpected ' + method);
      }
    },
  });
  return { sent, transport };
}

describe('every transaction the relayer sends is tagged', () => {
  it('a plain CELO transfer carries the tag, and it verifies from the chain data', async () => {
    const { sent, transport } = fakeNode();
    const wallet = walletWithTag({ account, chain: celo, transport, tag: TAG });
    const hash = await wallet.sendTransaction({ to: TO, value: 1n });
    const result = await verifyTx({ client: createPublicClient({ chain: celo, transport }), hash });
    expect(sent).toHaveLength(1);
    expect(result?.codes).toEqual([TAG]);
  });
  it('a contract call carries the tag too', async () => {
    const { transport } = fakeNode();
    const wallet = walletWithTag({ account, chain: celo, transport, tag: TAG });
    const hash = await wallet.writeContract({ address: TO, abi: [{ name: 'ping', type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [] }], functionName: 'ping' });
    const result = await verifyTx({ client: createPublicClient({ chain: celo, transport }), hash });
    expect(result?.codes).toEqual([TAG]);
  });
  it('without a tag nothing is added', async () => {
    const { sent, transport } = fakeNode();
    const wallet = walletWithTag({ account, chain: celo, transport, tag: undefined });
    await wallet.sendTransaction({ to: TO, value: 1n });
    expect(parseTransaction(sent[0] as `0x${string}`).data ?? '0x').toBe('0x');
  });
});
