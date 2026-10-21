import { decodeFunctionData, encodeFunctionData, getAddress, parseAbi, toFunctionSelector, type Address, type Hex } from 'viem';
import { CELO_CHAIN_ID, parseAmount, formatAmount, tokenAddress, type SwapToken } from '@/lib/swap/route';

/**
 * Depositing into Aave v3 on Celo and taking it back out. Pure: this file only knows the contract addresses, how to build the
 * calldata, what the browser must see before it signs, and how to read an Aave rate.
 *
 * The addresses below were read from the chain on 2026-10-21 (Pool and DataProvider via the PoolAddressesProvider; USDT and USDC
 * both active, not frozen, not paused). USAT is NOT an Aave market, so only USDT and USDC can be deposited.
 */

export const AAVE = {
  provider: getAddress('0x9F7Cf9417D5251C59fE94fB9147feEe1aAd9Cea5'),
  pool: getAddress('0x3E59A31363E2ad014dcbc521c4a0d5757d9f3402'),
  dataProvider: getAddress('0x2e0f8D3B1631296cC7c56538D6Eb6032601E15ED'),
} as const;

export type EarnToken = Extract<SwapToken, 'USDT' | 'USDC'>;
export const EARN_TOKENS: readonly EarnToken[] = ['USDT', 'USDC'];
export const isEarnToken = (v: unknown): v is EarnToken => v === 'USDT' || v === 'USDC';

/** Beta limits per deposit, in 6-decimal units: $0.10 to $25. */
export const EARN_LIMITS = { minAtomic: 100_000n, maxAtomic: 25_000_000n } as const;

export type EarnAction = 'deposit' | 'withdraw';

export const MAX_UINT256 = (1n << 256n) - 1n;

export const poolAbi = parseAbi([
  'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)',
  'function withdraw(address asset, uint256 amount, address to) returns (uint256)',
  'function getReserveData(address asset) view returns ((uint256 configuration,uint128 liquidityIndex,uint128 currentLiquidityRate,uint128 variableBorrowIndex,uint128 currentVariableBorrowRate,uint128 currentStableBorrowRate,uint40 lastUpdateTimestamp,uint16 id,address aTokenAddress,address stableDebtTokenAddress,address variableDebtTokenAddress,address interestRateStrategyAddress,uint128 accruedToTreasury,uint128 unbacked,uint128 isolationModeTotalDebt))',
]);

export const dataProviderAbi = parseAbi([
  'function getReserveConfigurationData(address asset) view returns (uint256 decimals,uint256 ltv,uint256 liquidationThreshold,uint256 liquidationBonus,uint256 reserveFactor,bool usageAsCollateralEnabled,bool borrowingEnabled,bool stableBorrowRateEnabled,bool isActive,bool isFrozen)',
  'function getReserveCaps(address asset) view returns (uint256 borrowCap,uint256 supplyCap)',
  'function getPaused(address asset) view returns (bool)',
  'function getATokenTotalSupply(address asset) view returns (uint256)',
]);

const approveAbi = parseAbi(['function approve(address spender, uint256 amount) returns (bool)']);

export interface EarnTx {
  kind: 'approve' | 'supply' | 'withdraw';
  to: Address;
  data: Hex;
  value: '0';
  chainId: number;
}

export const earnTokenAddress = (t: EarnToken): Address => tokenAddress(t);

/** Let Aave take exactly this amount (never unlimited). */
export function buildApprove(token: EarnToken, amount: bigint): EarnTx {
  return { kind: 'approve', to: earnTokenAddress(token), data: encodeFunctionData({ abi: approveAbi, functionName: 'approve', args: [AAVE.pool, amount] }), value: '0', chainId: CELO_CHAIN_ID };
}

/** Deposit `amount` and credit it to `wallet` (the person's own address — never anyone else's). */
export function buildSupply(token: EarnToken, amount: bigint, wallet: Address): EarnTx {
  return { kind: 'supply', to: AAVE.pool, data: encodeFunctionData({ abi: poolAbi, functionName: 'supply', args: [earnTokenAddress(token), amount, wallet, 0] }), value: '0', chainId: CELO_CHAIN_ID };
}

/** Take money back to `wallet`. `amount` MAX_UINT256 means "everything, including what it has earned". */
export function buildWithdraw(token: EarnToken, amount: bigint, wallet: Address): EarnTx {
  return { kind: 'withdraw', to: AAVE.pool, data: encodeFunctionData({ abi: poolAbi, functionName: 'withdraw', args: [earnTokenAddress(token), amount, wallet] }), value: '0', chainId: CELO_CHAIN_ID };
}

const SELECTOR = {
  approve: toFunctionSelector('approve(address,uint256)'),
  supply: toFunctionSelector('supply(address,uint256,address,uint16)'),
  withdraw: toFunctionSelector('withdraw(address,uint256,address)'),
} as const;

/**
 * Is this something the browser should be willing to sign? Only an approve of this coin to the Aave pool, a deposit of this coin
 * credited to the person's OWN address, or a withdrawal of this coin sent to their OWN address. Trailing bytes (the attribution
 * tag) after the call are fine; anything else is refused.
 */
export function isExpectedEarnTx(tx: EarnTx, expect: { token: EarnToken; action: EarnAction; wallet: string }): boolean {
  if (tx.value !== '0' || tx.chainId !== CELO_CHAIN_ID) return false;
  const token = earnTokenAddress(expect.token).toLowerCase();
  const wallet = expect.wallet.toLowerCase();
  const sel = tx.data.slice(0, 10).toLowerCase();
  try {
    if (tx.kind === 'approve') {
      if (expect.action !== 'deposit' || tx.to.toLowerCase() !== token || sel !== SELECTOR.approve) return false;
      const d = decodeFunctionData({ abi: approveAbi, data: tx.data });
      return String(d.args[0]).toLowerCase() === AAVE.pool.toLowerCase();
    }
    if (tx.to.toLowerCase() !== AAVE.pool.toLowerCase()) return false;
    if (tx.kind === 'supply' && expect.action === 'deposit' && sel === SELECTOR.supply) {
      const d = decodeFunctionData({ abi: poolAbi, data: tx.data });
      return d.functionName === 'supply' && String(d.args[0]).toLowerCase() === token && String(d.args[2]).toLowerCase() === wallet;
    }
    if (tx.kind === 'withdraw' && expect.action === 'withdraw' && sel === SELECTOR.withdraw) {
      const d = decodeFunctionData({ abi: poolAbi, data: tx.data });
      return d.functionName === 'withdraw' && String(d.args[0]).toLowerCase() === token && String(d.args[2]).toLowerCase() === wallet;
    }
  } catch {
    return false;
  }
  return false;
}

const RAY = 10n ** 27n;
const SECONDS_PER_YEAR = 31_536_000;

/** Aave's `currentLiquidityRate` is an annual rate in ray (1e27). Returns the compounded APY as a percent, e.g. 0.24. */
export function rayToApyPercent(rate: bigint): number {
  const apr = Number((rate * 1_000_000n) / RAY) / 1_000_000;
  if (!Number.isFinite(apr) || apr < 0) return 0;
  return (Math.pow(1 + apr / SECONDS_PER_YEAR, SECONDS_PER_YEAR) - 1) * 100;
}

export { parseAmount, formatAmount };
