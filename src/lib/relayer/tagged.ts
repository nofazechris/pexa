import { withAttribution } from '@celo/attribution-tags';
import { createWalletClient, type Account, type Chain, type Transport } from 'viem';

/**
 * A wallet client whose every transaction carries the ERC-8021 attribution tag (plain CELO transfers included). With no tag the
 * client is returned as is. Kept free of server-only imports so it can be tested with a fake transport.
 */
export function walletWithTag(opts: { account: Account; chain: Chain; transport: Transport; tag?: string | null }) {
  const base = createWalletClient({ account: opts.account, chain: opts.chain, transport: opts.transport });
  return opts.tag ? base.extend(withAttribution(opts.tag)) : base;
}
