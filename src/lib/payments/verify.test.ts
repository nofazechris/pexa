import { describe, expect, it } from 'vitest';
import { TRANSFER_TOPIC, receiptHasTransfer, type ReceiptLog } from './verify';

const USDC = '0xcebA9300f2b948710d2653dD7B07f33A8B32118C';
const ALICE = '0x52c23C312B27c8361BC37E7c8429F0328c7F5F2A';
const BOB = '0x20faAca5F980E29639A0FCC6dcA6988E18ed333B';
const EVE = '0x1111111111111111111111111111111111111111';

const pad = (a: string) => '0x' + '0'.repeat(24) + a.slice(2).toLowerCase();
const word = (n: bigint) => '0x' + n.toString(16).padStart(64, '0');
const transfer = (over: Partial<{ address: string; from: string; to: string; value: bigint }> = {}): ReceiptLog => ({
  address: over.address ?? USDC,
  topics: [TRANSFER_TOPIC, pad(over.from ?? ALICE), pad(over.to ?? BOB)],
  data: word(over.value ?? 1_000_000n),
});
const expected = { token: USDC, from: ALICE, to: BOB, amount: 1_000_000n };

describe('receiptHasTransfer — a payment is real only if the chain says so', () => {
  it('accepts the genuine transfer, whatever the address casing', () => {
    expect(receiptHasTransfer([transfer()], expected)).toBe(true);
    expect(receiptHasTransfer([transfer({ address: USDC.toLowerCase() })], { ...expected, token: USDC.toUpperCase().replace('0X', '0x') })).toBe(true);
  });

  it('finds it among other events (authorization-used, fee transfers…)', () => {
    const noise: ReceiptLog = { address: USDC, topics: ['0x98de503528ee59b575ef0c0a2576a82497bfc029a5685b209e9ec333479b10a5', pad(ALICE), '0x' + '1'.repeat(64)], data: '0x' };
    const fee = transfer({ from: ALICE, to: EVE, value: 5_000n });
    expect(receiptHasTransfer([noise, fee, transfer()], expected)).toBe(true);
  });

  it('rejects an unrelated transaction (no logs, e.g. a plain CELO send or any random hash)', () => {
    expect(receiptHasTransfer([], expected)).toBe(false);
  });

  it('rejects a transfer of the wrong amount — more or less', () => {
    expect(receiptHasTransfer([transfer({ value: 999_999n })], expected)).toBe(false);
    expect(receiptHasTransfer([transfer({ value: 1_000_001n })], expected)).toBe(false);
    expect(receiptHasTransfer([transfer({ value: 100_000_000n })], expected)).toBe(false);
  });

  it('rejects a transfer to someone else, or from someone else', () => {
    expect(receiptHasTransfer([transfer({ to: EVE })], expected)).toBe(false);
    expect(receiptHasTransfer([transfer({ from: EVE })], expected)).toBe(false);
  });

  it('rejects the right-looking event emitted by a DIFFERENT token contract (a fake token)', () => {
    expect(receiptHasTransfer([transfer({ address: EVE })], expected)).toBe(false);
  });

  it('rejects look-alike events: wrong event, wrong topic count (NFT-style), malformed data', () => {
    expect(receiptHasTransfer([{ address: USDC, topics: ['0x' + 'ab'.repeat(32), pad(ALICE), pad(BOB)], data: word(1_000_000n) }], expected)).toBe(false);
    expect(receiptHasTransfer([{ address: USDC, topics: [TRANSFER_TOPIC, pad(ALICE), pad(BOB), word(1n)], data: '0x' }], expected)).toBe(false); // ERC-721 shape
    expect(receiptHasTransfer([{ address: USDC, topics: [TRANSFER_TOPIC, pad(ALICE), pad(BOB)], data: '0xzz' }], expected)).toBe(false);
    expect(receiptHasTransfer([{ address: USDC, topics: [TRANSFER_TOPIC, 'not-a-topic', pad(BOB)], data: word(1_000_000n) }], expected)).toBe(false);
    expect(receiptHasTransfer([{ address: USDC, topics: [TRANSFER_TOPIC, pad(ALICE), pad(BOB)], data: '0x' + 'f'.repeat(80) }], expected)).toBe(false);
  });

  it('is not fooled by the addresses being swapped', () => {
    expect(receiptHasTransfer([transfer({ from: BOB, to: ALICE })], expected)).toBe(false);
  });
});
