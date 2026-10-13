import 'server-only';
import { formatUnits } from 'viem';
import { activeNetwork, getToken } from '@/lib/config';
import { getErc20Balance } from '@/lib/celo/balance';
import { getWalletByUserId } from '@/lib/wallets/service';
import { getBridgeStatuses } from '@/lib/bridge/service';
import { recentDeposits, scanDeposits } from './service';
import { composeDepositCheck, mapRelayStatus, FRESH_DEPOSIT_MS, type CheckFacts } from './check-reply';

/**
 * Has the money arrived? Reads the chain (new deposits are scanned first) and the bridge's own status, then builds the answer
 * from those facts. Shared by the agent's `check_deposit` tool and the chat's quick path, so they can never disagree.
 */
export async function depositCheck(userId: string): Promise<{ facts: CheckFacts; summary: string; arrived: boolean }> {
  await scanDeposits(userId); // finds anything new on Celo; never throws
  const [recent, statuses, wallet] = await Promise.all([recentDeposits(userId, 5), getBridgeStatuses(userId).catch(() => []), getWalletByUserId(userId)]);
  let balance: string | null = null;
  try {
    const usdc = getToken('USDC', activeNetwork.network)?.address;
    if (wallet && usdc) balance = formatUnits(await getErc20Balance(usdc, wallet.address), 6);
  } catch {
    /* the answer simply leaves the balance out */
  }
  const facts: CheckFacts = {
    recent: recent.map((d) => ({ amount: d.amount, token: d.token, at: d.at })),
    bridges: statuses.map((b) => ({ chain: b.chain, state: mapRelayStatus(b.status) })),
    balance,
    now: Date.now(),
  };
  const latest = facts.recent[0];
  return { facts, summary: composeDepositCheck(facts), arrived: Boolean(latest && facts.now - new Date(latest.at).getTime() <= FRESH_DEPOSIT_MS) };
}
