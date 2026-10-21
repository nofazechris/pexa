import 'server-only';
import { getErc20Balance } from '@/lib/celo/balance';
import { getWalletByUserId } from '@/lib/wallets/service';
import { availableBalanceRaw } from '@/lib/vaults/service';
import { formatAmount, tokenAddress } from '@/lib/swap/route';
import type { Holdings } from './view';

/** What the person can spend of each dollar coin right now (USDC net of what's set aside in savings vaults), or null if it can't be read. */
export async function readHoldings(userId: string): Promise<Holdings | null> {
  try {
    const wallet = await getWalletByUserId(userId);
    if (!wallet) return null;
    const [usdc, usdt, usat] = await Promise.all((['USDC', 'USDT', 'USAT'] as const).map((t) => getErc20Balance(tokenAddress(t), wallet.address)));
    const spendableUsdc = await availableBalanceRaw(userId, usdc.toString(), 'USDC');
    return { USDC: formatAmount(spendableUsdc, 6), USDT: formatAmount(usdt, 6), USAT: formatAmount(usat, 6) };
  } catch {
    return null;
  }
}
