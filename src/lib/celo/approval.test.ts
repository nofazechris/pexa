import { describe, expect, it } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, erc20Abi, getAddress, type Hex } from 'viem';
import { approvalCovers, approvalInLogs } from './approval';

const TOKEN = getAddress('0xcebA9300f2b948710d2653dD7B07f33A8B32118C');
const OWNER = getAddress('0x52c23C312B27c8361BC37E7c8429F0328c7F5F2A');
const POOL = getAddress('0x3E59A31363E2ad014dcbc521c4a0d5757d9f3402');
const OTHER = getAddress('0x2222222222222222222222222222222222222222');

const approvalLog = (owner: string, spender: string, value: bigint, address: string = TOKEN) => ({
  address,
  topics: encodeEventTopics({ abi: erc20Abi, eventName: 'Approval', args: { owner: owner as Hex, spender: spender as Hex } }) as Hex[],
  data: encodeAbiParameters([{ type: 'uint256' }], [value]),
});

describe('is the approval good?', () => {
  it('trusts the approval’s own log', () => {
    expect(approvalInLogs([approvalLog(OWNER, POOL, 1_000_000n)], TOKEN, OWNER, POOL, 1_000_000n)).toBe(true);
    expect(approvalInLogs([approvalLog(OWNER, POOL, 5_000_000n)], TOKEN, OWNER, POOL, 1_000_000n)).toBe(true);
  });
  it('rejects a smaller amount, another spender, another owner, or another contract’s log', () => {
    expect(approvalInLogs([approvalLog(OWNER, POOL, 999_999n)], TOKEN, OWNER, POOL, 1_000_000n)).toBe(false);
    expect(approvalInLogs([approvalLog(OWNER, OTHER, 9_000_000n)], TOKEN, OWNER, POOL, 1_000_000n)).toBe(false);
    expect(approvalInLogs([approvalLog(OTHER, POOL, 9_000_000n)], TOKEN, OWNER, POOL, 1_000_000n)).toBe(false);
    expect(approvalInLogs([approvalLog(OWNER, POOL, 9_000_000n, OTHER)], TOKEN, OWNER, POOL, 1_000_000n)).toBe(false);
    expect(approvalInLogs([], TOKEN, OWNER, POOL, 1n)).toBe(false);
  });
  it('a node that is a block behind does not make a good approval look missing', async () => {
    let calls = 0;
    // The first two reads come from a node that has not seen the approval yet; the third has.
    const reader = { readContract: async () => (++calls < 3 ? 0n : 1_000_000n) };
    expect(await approvalCovers(reader, { token: TOKEN, owner: OWNER, spender: POOL, amount: 1_000_000n, logs: [], waitMs: 1 })).toBe(true);
    expect(calls).toBe(3);
  });
  it('does not even need to read when the log already proves it', async () => {
    let calls = 0;
    const reader = { readContract: async () => (calls++, 0n) };
    expect(await approvalCovers(reader, { token: TOKEN, owner: OWNER, spender: POOL, amount: 1_000_000n, logs: [approvalLog(OWNER, POOL, 1_000_000n)], waitMs: 1 })).toBe(true);
    expect(calls).toBe(0);
  });
  it('still says no when the approval is genuinely too small, after trying a few times', async () => {
    let calls = 0;
    const reader = { readContract: async () => (calls++, 500_000n) };
    expect(await approvalCovers(reader, { token: TOKEN, owner: OWNER, spender: POOL, amount: 1_000_000n, logs: [], tries: 4, waitMs: 1 })).toBe(false);
    expect(calls).toBe(4);
  });
});
