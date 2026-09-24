import { env } from './env';

/**
 * Feature flags (§119).
 *
 * Integrations and later capabilities ship dark and are enabled independently, so an
 * incomplete channel is never reachable in production. Everything defaults off; a flag turns
 * on only when its stage is built and its config is present.
 */
export interface FeatureFlags {
  readonly mcp: boolean;
  readonly chatgpt: boolean;
  readonly codex: boolean;
  readonly whatsapp: boolean;
  readonly recurring: boolean;
  /** Gasless payments via the EIP-3009 relayer (user never pays gas). */
  readonly gaslessRelayer: boolean;
  /** NGN↔USDT fiat conversion + payouts, behind the FiatProvider abstraction. */
  readonly fiat: boolean;
  /** True only while the fiat provider is the sandbox mock — surfaced to the UI so nothing looks live. */
  readonly fiatSandbox: boolean;
  /** Real naira funding/on-ramp is available. Off in beta — the UI/agent say "funding coming soon". */
  readonly fundingLive: boolean;
  /** Surface NGN↔USDT features in the consumer app + agent. Off in beta → naira shows "coming soon". */
  readonly fiatPublic: boolean;
  readonly x402: boolean;
  readonly advancedPrivacy: boolean;
}

export const features: FeatureFlags = {
  mcp: Boolean(env.MCP_SECRET),
  chatgpt: false,
  codex: false,
  whatsapp: Boolean(env.WHATSAPP_WEBHOOK_SECRET),
  recurring: false,
  gaslessRelayer: Boolean(env.RELAYER_PRIVATE_KEY),
  fiat: Boolean(env.FIAT_PROVIDER),
  fiatSandbox: env.FIAT_PROVIDER === 'sandbox',
  fundingLive: env.FUNDING_LIVE === 'true',
  fiatPublic: env.FIAT_PUBLIC === 'true',
  x402: false,
  advancedPrivacy: false,
};
