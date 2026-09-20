import 'server-only';
import { fiatProviderId } from '@/lib/config/fiat';
import type { FiatProvider } from './provider';
import { SandboxFiatProvider } from './sandbox';
import { QuidaxFiatProvider } from './quidax';

/**
 * Fiat provider selection (§16). Resolves the configured adapter from `FIAT_PROVIDER`. Only the
 * sandbox mock exists today; real providers register here as they are integrated. Throws a clear
 * error when fiat is not enabled, so callers fail loudly rather than silently no-op.
 */

let cached: FiatProvider | null = null;

export function getFiatProvider(): FiatProvider {
  if (cached) return cached;
  const id = fiatProviderId();
  switch (id) {
    case 'sandbox':
      cached = new SandboxFiatProvider();
      return cached;
    case 'quidax':
      cached = new QuidaxFiatProvider();
      return cached;
    default:
      throw new Error('Fiat is not enabled (set FIAT_PROVIDER).');
  }
}

export * from './provider';
export * from './state';
