import 'server-only';
import QRCode from 'qrcode';
import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { getWalletByUserId } from '@/lib/wallets/service';
import { requestDepositAddress } from './relay';
import { type BridgeChain } from './chains';

export interface BridgeDeposit {
  chain: string;
  chainId: number;
  address: string;
  /** Rough fee for a 10 USDC transfer. */
  estimateFeeUsd: string;
  qr: string;
}

/**
 * The deposit address for "bring USDC from <network>": the one we made before, or a new one the first time. It always
 * points at the user's own pinned Pexa wallet — if that were ever different from what was stored, a new address is made.
 */
export async function getBridgeDeposit(userId: string, chain: BridgeChain): Promise<BridgeDeposit | null> {
  const wallet = await getWalletByUserId(userId);
  if (!wallet) return null;
  const db = getDb();
  const where = and(eq(schema.bridgeAddresses.userId, userId), eq(schema.bridgeAddresses.originChainId, chain.chainId));
  const [existing] = await db.select().from(schema.bridgeAddresses).where(where).limit(1);

  let row = existing && existing.recipient.toLowerCase() === wallet.address.toLowerCase() ? existing : null;
  if (!row) {
    const made = await requestDepositAddress(chain, wallet.address);
    const values = { userId, originChainId: chain.chainId, depositAddress: made.depositAddress, requestId: made.requestId, recipient: wallet.address, estimateFeeUsd: made.estimateFeeUsd };
    if (existing) {
      // Its wallet changed since it was made: point it at the current one.
      await db.update(schema.bridgeAddresses).set(values).where(where);
    } else {
      // Two chats asking at once end up with ONE address: whoever inserts first wins and both read it back.
      await db.insert(schema.bridgeAddresses).values(values).onConflictDoNothing();
    }
    [row] = await db.select().from(schema.bridgeAddresses).where(where).limit(1);
  }
  if (!row) return null;

  let qr = '';
  try {
    qr = await QRCode.toDataURL(row.depositAddress, { margin: 1, width: 240 });
  } catch {
    /* the copyable address is enough */
  }
  return { chain: chain.label, chainId: chain.chainId, address: row.depositAddress, estimateFeeUsd: row.estimateFeeUsd, qr };
}
