/**
 * "Did this transaction really pay that person that amount?" — checked from the transaction's own on-chain
 * event log, never from what a client told us.
 *
 * A payment is only CONFIRMED when the receipt contains an ERC-20 `Transfer` emitted BY THE PAYMENT TOKEN'S
 * CONTRACT, from the sender's wallet, to the recipient, for exactly the payment amount. Without this check a
 * user could attach any unrelated successful transaction hash to a payment and have it shown as completed
 * (and have the recipient's automations fire on money that never moved).
 *
 * Pure so it can be tested with synthetic and real logs.
 */

export interface ReceiptLog {
  address: string;
  topics: readonly string[];
  data: string;
}

export interface ExpectedTransfer {
  /** The token contract that must have emitted the event. */
  token: string;
  from: string;
  to: string;
  /** Smallest-unit amount, exactly. */
  amount: bigint;
}

/** keccak256("Transfer(address,address,uint256)") */
export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const lower = (s: string) => s.toLowerCase();

/** The address stored in an indexed 32-byte topic (its last 20 bytes). */
function topicToAddress(topic: string | undefined): string | null {
  if (!topic || !/^0x[0-9a-fA-F]{64}$/.test(topic)) return null;
  return '0x' + topic.slice(26).toLowerCase();
}

export function receiptHasTransfer(logs: readonly ReceiptLog[], expected: ExpectedTransfer): boolean {
  const token = lower(expected.token);
  const from = lower(expected.from);
  const to = lower(expected.to);
  for (const log of logs) {
    if (lower(log.address) !== token) continue;
    if (log.topics.length !== 3 || lower(log.topics[0]) !== TRANSFER_TOPIC) continue;
    if (topicToAddress(log.topics[1]) !== from || topicToAddress(log.topics[2]) !== to) continue;
    if (!/^0x[0-9a-fA-F]+$/.test(log.data) || log.data.length > 66) continue;
    try {
      if (BigInt(log.data) === expected.amount) return true;
    } catch {
      /* malformed data — not a match */
    }
  }
  return false;
}
