import { ERC_8021_MARKER, toDataSuffix } from '@celo/attribution-tags';
import type { Hex } from 'viem';

/**
 * Add the ERC-8021 attribution tag to the end of some calldata. Contracts ignore extra trailing calldata, so a contract call
 * (a swap, an approval) works exactly as before; only calldata that already ends in a tag, or has nothing in it, is left alone
 * — empty data is a plain transfer, where adding data could change which function of the receiving contract runs.
 * No tag configured: the data is returned unchanged.
 */
export function appendTag(data: Hex, tag: string | null | undefined): Hex {
  if (!tag || data === '0x') return data;
  if (data.toLowerCase().endsWith(ERC_8021_MARKER.slice(2).toLowerCase())) return data;
  return (data + toDataSuffix(tag).slice(2)) as Hex;
}
