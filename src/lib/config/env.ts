import { z } from 'zod';

/**
 * Typed access to environment configuration.
 *
 * Every variable is optional here so the app builds and runs with no `.env` at all — this is
 * the Stage 0 foundation, and secrets arrive stage by stage. A feature that genuinely needs a
 * value calls {@link requireEnv} at the point of use, which fails loudly and specifically
 * rather than letting an `undefined` slip into a signing call or a database URL.
 *
 * Server-only secrets (anything that can move money or read the database) must never be read
 * from client code. Keep those reads inside route handlers and server modules; `NEXT_PUBLIC_`
 * is reserved for values that are safe to ship to the browser.
 */
const schema = z.object({
  // Runtime
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ENV: z.enum(['local', 'development', 'staging', 'production']).default('local'),
  /** Public origin for metadata and integration hand-off links (e.g. https://privypay.app). */
  NEXT_PUBLIC_SITE_URL: z.string().url().optional(),

  // Database (Stage: Foundation / §33)
  DATABASE_URL: z.string().url().optional(),

  // Auth session (Stage 3 / §8)
  AUTH_SECRET: z.string().min(1).optional(),

  // AI agent (Stage 9 / §24) — OpenAI, behind the agent module's provider abstraction.
  AI_PROVIDER: z.enum(['openai']).default('openai'),
  AI_API_KEY: z.string().min(1).optional(),
  AI_MODEL: z.string().min(1).optional(),

  // Wallet provider (Stage 5 / §11–12) — Privy embedded wallets.
  WALLET_PROVIDER: z.enum(['privy']).default('privy'),
  PRIVY_APP_ID: z.string().min(1).optional(),
  PRIVY_APP_SECRET: z.string().min(1).optional(),
  NEXT_PUBLIC_PRIVY_APP_ID: z.string().min(1).optional(),
  /**
   * Privy authorization key (private) for server-side wallet signing via delegated actions.
   * Required only for the MCP "confirm in agent" path, where the server settles a delegated
   * wallet's payment without the app. Absent → server signing is disabled and confirm_payment
   * falls back to in-app approval. Server-only secret; never exposed to the client.
   */
  PRIVY_AUTHORIZATION_KEY: z.string().min(1).optional(),

  // Celo settlement (Stage 6 / §13–15). Chain id and RPC per network; addresses stay in
  // config so nothing chain-specific is hard-coded across the app.
  CELO_NETWORK: z.enum(['mainnet', 'sepolia']).default('sepolia'),
  CELO_RPC_URL: z.string().url().optional(),
  CELO_SEPOLIA_RPC_URL: z.string().url().optional(),
  CELO_USDC_ADDRESS: z.string().optional(),
  /**
   * Gasless relayer key (EIP-3009). A funded server wallet (holds a little CELO for gas) that
   * submits `transferWithAuthorization` on the user's behalf — the user signs typed data and
   * never pays gas. Server-only; never exposed to the client or the AI. Absent → the app falls
   * back to the user paying native CELO gas via their embedded wallet.
   */
  RELAYER_PRIVATE_KEY: z.string().min(1).optional(),
  /**
   * The most the agent may settle on its own, per payment, without a human tapping approve — the
   * autonomous ceiling for the delegated worker path (recurring + on-chain auto-save). Above this
   * (but within the per-payment/daily caps) the payment waits for the user. Decimal USDC; default $100.
   */
  AGENT_AUTONOMOUS_CAP_USDC: z.string().optional(),

  // Fiat / NGN↔USDT (autonomous money feature). The provider is pluggable behind FiatProvider.
  // 'sandbox' is a clearly-labeled MOCK adapter for development — it never moves real money and
  // never presents its rates as live. A real, compliant provider is a separate, later config.
  // Absent → the fiat feature is disabled (endpoints/tools return "not enabled").
  FIAT_PROVIDER: z.enum(['sandbox', 'quidax']).optional(),
  /** Shared secret used to verify inbound fiat-provider webhook signatures. Absent → webhooks rejected. */
  FIAT_WEBHOOK_SECRET: z.string().min(1).optional(),
  // Quidax on/off-ramp (used when FIAT_PROVIDER=quidax). Server-only secrets — never exposed to
  // the client or the LLM. The webhook key verifies the `quidax-signature` HMAC.
  QUIDAX_SECRET_KEY: z.string().min(1).optional(),
  QUIDAX_WEBHOOK_KEY: z.string().min(1).optional(),
  QUIDAX_BASE_URL: z.string().url().optional(),
  /** Chain Pexa settles USDT on with Quidax (Celo is supported). */
  QUIDAX_USDT_NETWORK: z.string().min(1).optional(),
  /** Real naira funding/on-ramp is live. Default off — beta shows "funding coming soon". Set "true" to enable. */
  FUNDING_LIVE: z.string().optional(),
  /**
   * Show the NGN↔USDT (naira) features in the consumer app + in-app agent. Default OFF while the
   * business/Quidax merchant account isn't live — the app then presents naira conversion as
   * "coming soon" and shows only the core Celo payment experience. The sandbox + MCP tools stay
   * available for internal testing regardless. Set "true" to surface it publicly.
   */
  FIAT_PUBLIC: z.string().optional(),

  // Transactional email (waitlist welcome, etc.) via Resend. Both must be set to send; absent → the
  // app simply doesn't send email (nothing breaks). EMAIL_FROM must be on a domain verified in Resend,
  // e.g. "Pexa <hello@pexaapp.xyz>".
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(3).optional(),

  // Integrations (Stages 14–17)
  MCP_SECRET: z.string().min(1).optional(),
  WHATSAPP_WEBHOOK_SECRET: z.string().min(1).optional(),
  /** Shared secret protecting the recurring-execution cron endpoint. Absent → endpoint disabled. */
  CRON_SECRET: z.string().min(1).optional(),
});

export type Env = z.infer<typeof schema>;

/**
 * Validate an environment source into typed config. Exported for testing; the app calls it
 * once with `process.env`.
 *
 * A key present but empty (e.g. `DATABASE_URL=` in a .env copied from .env.example) means "not
 * set", not "malformed" — empty strings are coerced to undefined so optionals and defaults
 * apply. Only a present, non-empty, actually-invalid value fails validation.
 */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const cleaned: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(source)) {
    cleaned[key] = value === '' ? undefined : value;
  }
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return parsed.data;
}

export const env: Env = parseEnv(process.env);

/**
 * Read a variable that a feature cannot run without. Throws a specific error naming the
 * missing key and the stage that introduces it, so a missing secret is never silently
 * coerced into `undefined` inside a payment or signing path.
 */
export function requireEnv<K extends keyof Env>(key: K, hint?: string): NonNullable<Env[K]> {
  const value = env[key];
  if (value === undefined || value === null || value === '') {
    throw new Error(`Missing required environment variable ${key}.${hint ? ` ${hint}` : ''}`);
  }
  return value as NonNullable<Env[K]>;
}

export const isProd = env.APP_ENV === 'production';
export const isServer = typeof window === 'undefined';
