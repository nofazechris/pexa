/**
 * Fiat amount parsing & formatting.
 *
 * Converts human amounts ("₦100,000", "100k", "100.5 USDT") to integer smallest-unit strings
 * (NGN kobo / USDT 6dp) and back for display. All storage/compute is integer BigInt — never
 * floats. Parsing returns null on anything it can't make sense of, so callers fail cleanly
 * rather than guessing.
 */

import { NGN, USDT } from '@/lib/config/fiat';

/** Turn a cleaned decimal string into an integer smallest-unit string for `decimals` places. */
function toSmallestUnit(decimal: string, decimals: number): string | null {
  const m = decimal.match(/^(\d+)(?:\.(\d+))?$/);
  if (!m) return null;
  const int = m[1];
  const frac = (m[2] ?? '').slice(0, decimals).padEnd(decimals, '0');
  try {
    return BigInt(int + frac).toString();
  } catch {
    return null;
  }
}

/** Strip currency symbols/words/commas and expand a trailing k/m suffix → a plain decimal string. */
function normalizeDecimal(input: string, extraWords: RegExp): string | null {
  let s = input.trim().toLowerCase();
  s = s.replace(/[₦$,]/g, '').replace(extraWords, '').trim();
  const suffix = s.match(/^([\d.]+)\s*([km])$/);
  if (suffix) {
    const factor = suffix[2] === 'k' ? 1_000 : 1_000_000;
    const n = Number(suffix[1]);
    if (!Number.isFinite(n)) return null;
    // Expand the suffix, then re-stringify without floating error at a sane precision.
    return (n * factor).toFixed(6).replace(/\.?0+$/, '');
  }
  return /^[\d.]+$/.test(s) ? s : null;
}

/** "₦100,000" | "100k" | "50000 naira" → kobo string ("10000000"), or null. */
export function parseNgnToKobo(input: string): string | null {
  const dec = normalizeDecimal(input, /naira|ngn|₦/gi);
  return dec ? toSmallestUnit(dec, NGN.decimals) : null;
}

/** "100" | "100.5 USDT" → 6dp units string ("100500000"), or null. */
export function parseUsdtToUnits(input: string): string | null {
  const dec = normalizeDecimal(input, /usdt|usd/gi);
  return dec ? toSmallestUnit(dec, USDT.decimals) : null;
}

function formatUnits(raw: string, decimals: number, opts: { group?: boolean; trim?: boolean } = {}): string {
  let neg = false;
  let v = raw;
  if (v.startsWith('-')) {
    neg = true;
    v = v.slice(1);
  }
  const padded = v.padStart(decimals + 1, '0');
  const int = padded.slice(0, padded.length - decimals);
  let frac = padded.slice(padded.length - decimals);
  const intGrouped = opts.group ? int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : int;
  if (opts.trim) frac = frac.replace(/0+$/, '');
  const body = frac ? `${intGrouped}.${frac}` : intGrouped;
  return neg ? `-${body}` : body;
}

/** Kobo → "100,000.00" (no symbol; UI adds ₦). */
export function formatKoboToNgn(kobo: string): string {
  return formatUnits(kobo, NGN.decimals, { group: true });
}

/** 6dp units → "61.724565" (trailing zeros trimmed). */
export function formatUnitsToUsdt(units: string): string {
  return formatUnits(units, USDT.decimals, { trim: true }) || '0';
}
