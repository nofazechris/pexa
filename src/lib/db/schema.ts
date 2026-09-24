import { pgTable, uuid, text, integer, timestamp, uniqueIndex, boolean } from 'drizzle-orm/pg-core';

/**
 * Database schema (§34–35).
 *
 * Privy owns authentication and key custody; these tables own PrivyPay's own identity. A
 * `users` row maps a Privy DID to an internal id (never expose the DID as the app-facing id),
 * and a `profiles` row holds the username the product pays by. Usernames are unique at the
 * database level — the ultimate guard behind the application check (§9).
 */

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** Privy DID (did:privy:…). The link to the auth/custody provider. */
    privyDid: text('privy_did').notNull(),
    email: text('email'),
    authProvider: text('auth_provider').notNull().default('privy'),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('users_privy_did_uq').on(t.privyDid)],
);

export const profiles = pgTable(
  'profiles',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Stored normalized (lowercase). Unique across all users. */
    username: text('username').notNull(),
    displayName: text('display_name'),
    avatarUrl: text('avatar_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('profiles_username_uq').on(t.username)],
);

export const wallets = pgTable(
  'wallets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Custody provider (currently Privy). */
    provider: text('provider').notNull().default('privy'),
    /** Provider's wallet identifier, when available. Never a private key. */
    providerWalletId: text('provider_wallet_id'),
    chainId: integer('chain_id').notNull(),
    address: text('address').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // One wallet per user per chain; syncing is idempotent on this key.
  (t) => [uniqueIndex('wallets_user_chain_uq').on(t.userId, t.chainId)],
);

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    senderUserId: uuid('sender_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    recipientUserId: uuid('recipient_user_id').references(() => users.id, { onDelete: 'set null' }),
    recipientAddress: text('recipient_address').notNull(),
    /** Amount in the token's smallest unit, as a decimal string — never a float (§18). */
    amount: text('amount').notNull(),
    token: text('token').notNull(),
    chainId: integer('chain_id').notNull(),
    /** PaymentStatus enum value; the state machine is the authority on transitions (§17). */
    status: text('status').notNull().default('DRAFT'),
    memo: text('memo'),
    txHash: text('tx_hash'),
    feeAmount: text('fee_amount'),
    /** Makes execution idempotent (§20): the same key resolves to the same payment. */
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    authorizedAt: timestamp('authorized_at', { withTimezone: true }),
    broadcastAt: timestamp('broadcast_at', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('payments_sender_idem_uq').on(t.senderUserId, t.idempotencyKey)],
);

export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** The user who owns this contact list entry. */
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The saved person's PrivyPay user id (set when they are a PrivyPay user). */
    contactUserId: uuid('contact_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Saved username, normalized (lowercase, no leading '@'). */
    username: text('username').notNull(),
    /** Optional display name shown in the UI; falls back to the username. */
    displayName: text('display_name'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // One entry per person in a user's contact list; re-adding is idempotent on this key.
  (t) => [uniqueIndex('contacts_owner_username_uq').on(t.ownerUserId, t.username)],
);

export const requests = pgTable('requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  /** Who asked for the money (and receives it when paid). */
  requesterUserId: uuid('requester_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** Who is asked to pay. Must be a real PrivyPay user, resolved at create time. */
  payerUserId: uuid('payer_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** Amount in the token's smallest unit, as a decimal string — never a float (§18). */
  amount: text('amount').notNull(),
  token: text('token').notNull(),
  chainId: integer('chain_id').notNull(),
  memo: text('memo'),
  /** PENDING | PAID | CANCELLED. */
  status: text('status').notNull().default('PENDING'),
  /** The payment that fulfilled this request, once paid. */
  paymentId: uuid('payment_id').references(() => payments.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
});

export const recurringPayments = pgTable('recurring_payments', {
  id: uuid('id').defaultRandom().primaryKey(),
  /** Who set up (and pays) the recurring payment. */
  ownerUserId: uuid('owner_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** Who receives it. A real PrivyPay user, resolved at create time. */
  payeeUserId: uuid('payee_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  amount: text('amount').notNull(),
  token: text('token').notNull(),
  chainId: integer('chain_id').notNull(),
  /** Human cadence label, e.g. "Every Friday" / "Monthly". */
  cadence: text('cadence').notNull(),
  /** active | paused | cancelled. Automated execution is a later worker; this is the schedule. */
  status: text('status').notNull().default('active'),
  /** When the next run is due (computed from the cadence). */
  nextRun: timestamp('next_run', { withTimezone: true }),
  memo: text('memo'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const mcpTokens = pgTable(
  'mcp_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 of the bearer token — the plaintext is shown once at mint time and never stored. */
    tokenHash: text('token_hash').notNull(),
    /** A short, non-secret prefix (e.g. "pk_live_ab12") for display/identification in the UI. */
    tokenPrefix: text('token_prefix').notNull(),
    /** User-facing label, e.g. "ChatGPT" / "Claude". */
    label: text('label'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  // The hash is what we look up on every MCP call; unique so a token maps to exactly one row.
  (t) => [uniqueIndex('mcp_tokens_hash_uq').on(t.tokenHash)],
);

export const authorizations = pgTable('authorizations', {
  id: uuid('id').defaultRandom().primaryKey(),
  paymentId: uuid('payment_id')
    .notNull()
    .references(() => payments.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  // Bound to every payment parameter so an approval can't be replayed against a different one (§46).
  amount: text('amount').notNull(),
  recipientAddress: text('recipient_address').notNull(),
  token: text('token').notNull(),
  chainId: integer('chain_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  /** Set when consumed; single-use — a second consume is rejected. */
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
});

export const waitlist = pgTable(
  'waitlist',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** Stored normalized (lowercase, trimmed). Unique across the table (§26). */
    email: text('email').notNull(),
    firstName: text('first_name'),
    /** active | invited | converted | unsubscribed (§25). */
    status: text('status').notNull().default('active'),
    /** Where the signup came from, e.g. "landing". Never PII. */
    source: text('source').notNull().default('landing'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // The database-level guard behind the application dedupe check (§26–27).
  (t) => [uniqueIndex('waitlist_email_uq').on(t.email)],
);

/**
 * Fiat domain (NGN↔USDT). New tables only — the working `payments` table is untouched. `fiat_orders`
 * is the FinancialAction for fiat legs; crypto legs stay in `payments`. All monetary columns are
 * integer smallest-unit decimal strings (NGN in kobo, USDT in 6dp) — never floats.
 */

/** Per-user KYC/compliance state, mirrored from the provider. The policy engine gates on this. */
export const complianceProfiles = pgTable('compliance_profiles', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  /** The provider's customer id, when a customer has been created. Never a secret. */
  providerCustomerId: text('provider_customer_id'),
  /** none | pending | verified | rejected. */
  kycStatus: text('kyc_status').notNull().default('none'),
  /** Optional risk flags as a JSON string; absence means none. */
  riskFlags: text('risk_flags'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Verified NGN payout accounts, stored as tokenized provider references — never raw bank details (§7). */
export const payoutAccounts = pgTable(
  'payout_accounts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    /** Tokenized reference from the provider; what we use for payouts. Not the account number. */
    providerRef: text('provider_ref').notNull(),
    bankName: text('bank_name').notNull(),
    accountName: text('account_name').notNull(),
    /** Last 4 digits only, for display. */
    last4: text('last4').notNull(),
    status: text('status').notNull().default('verified'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('payout_accounts_user_ref_uq').on(t.userId, t.providerRef)],
);

/** A live conversion quote from a provider. Expires (§14); an order references the quote it was made from. */
export const fiatQuotes = pgTable('fiat_quotes', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** buy (NGN→USDT) | sell (USDT→NGN). */
  side: text('side').notNull(),
  provider: text('provider').notNull(),
  providerQuoteRef: text('provider_quote_ref').notNull(),
  ngnAmount: text('ngn_amount').notNull(),
  usdtAmount: text('usdt_amount').notNull(),
  /** Naira per USDT, human decimal string (display). */
  rate: text('rate').notNull(),
  providerFeeNgn: text('provider_fee_ngn').notNull(),
  pexaFeeNgn: text('pexa_fee_ngn').notNull().default('0'),
  estimatedReceive: text('estimated_receive').notNull(),
  estimatedReceiveCurrency: text('estimated_receive_currency').notNull(),
  /** True when produced by the sandbox mock — surfaced so nothing is shown as a live rate. */
  sandbox: boolean('sandbox').notNull().default(false),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** The FinancialAction for a fiat conversion. Status is a fiat state-machine value (§19). */
export const fiatOrders = pgTable(
  'fiat_orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    quoteId: uuid('quote_id').references(() => fiatQuotes.id, { onDelete: 'set null' }),
    side: text('side').notNull(),
    /** Buy/sell state-machine value; the state module is the authority on transitions. */
    status: text('status').notNull().default('QUOTE_CREATED'),
    ngnAmount: text('ngn_amount').notNull(),
    usdtAmount: text('usdt_amount').notNull(),
    feeNgn: text('fee_ngn').notNull().default('0'),
    asset: text('asset').notNull().default('USDT'),
    provider: text('provider').notNull(),
    providerOrderId: text('provider_order_id'),
    /** For a sell, the payout destination. */
    payoutAccountId: uuid('payout_account_id').references(() => payoutAccounts.id, { onDelete: 'set null' }),
    /** pending | authorized — execution requires an authorized action (§11). */
    authorizationStatus: text('authorization_status').notNull().default('pending'),
    /** Makes order creation idempotent (§14): same key resolves to the same order. */
    idempotencyKey: text('idempotency_key').notNull(),
    failureReason: text('failure_reason'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('fiat_orders_user_idem_uq').on(t.userId, t.idempotencyKey)],
);

/** Provider webhook log — the idempotency + reconciliation record for inbound events (§21–22). */
export const providerWebhookEvents = pgTable(
  'provider_webhook_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    provider: text('provider').notNull(),
    /** The provider's own event id; unique per provider so a re-delivery is a no-op (§21). */
    eventId: text('event_id').notNull(),
    type: text('type').notNull(),
    providerOrderId: text('provider_order_id'),
    status: text('status'),
    /** Raw event payload as received (JSON string), for audit and reconciliation. */
    payload: text('payload'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('provider_webhook_events_provider_event_uq').on(t.provider, t.eventId)],
);

/**
 * Agent memory (learns the user). Short, non-sensitive facts/preferences the agent recalls to
 * personalize conversations (frequent recipients, default bank label, preferred cadence, tone).
 * Never secrets, keys, or full bank/card numbers. Memory informs orchestration only — it can never
 * relax limits, KYC or confirmation. Unique per (user, content) so re-remembering is idempotent.
 */
export const agentMemories = pgTable(
  'agent_memories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('agent_memories_user_content_uq').on(t.userId, t.content)],
);

export type UserRow = typeof users.$inferSelect;
export type ProfileRow = typeof profiles.$inferSelect;
export type WalletRow = typeof wallets.$inferSelect;
export type PaymentRow = typeof payments.$inferSelect;
export type AuthorizationRow = typeof authorizations.$inferSelect;
export type ContactRow = typeof contacts.$inferSelect;
export type RequestRecord = typeof requests.$inferSelect;
export type RecurringRecord = typeof recurringPayments.$inferSelect;
export type McpTokenRow = typeof mcpTokens.$inferSelect;
export type WaitlistRow = typeof waitlist.$inferSelect;
export type ComplianceProfileRow = typeof complianceProfiles.$inferSelect;
export type PayoutAccountRow = typeof payoutAccounts.$inferSelect;
export type FiatQuoteRow = typeof fiatQuotes.$inferSelect;
export type FiatOrderRow = typeof fiatOrders.$inferSelect;
export type ProviderWebhookEventRow = typeof providerWebhookEvents.$inferSelect;
export type AgentMemoryRow = typeof agentMemories.$inferSelect;
