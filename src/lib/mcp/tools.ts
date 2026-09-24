import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { formatUnits } from 'viem';
import { activeNetwork, env, features, getToken, txExplorerUrl, FIAT_LIMITS } from '@/lib/config';
import { getProfileByUserId, resolveUsername } from '@/lib/users/service';
import { normalizeUsername } from '@/lib/users/username';
import { getWalletByUserId } from '@/lib/wallets/service';
import { getUsdcBalance } from '@/lib/celo/balance';
import { previewPayment, authorizePayment, confirmPayment, executeAuthorizedPayment, listPayments } from '@/lib/payments/engine';
import { listContacts } from '@/lib/contacts/service';
import { createRequest } from '@/lib/requests/service';
import { addMemory } from '@/lib/agent/memory';
import { createAutosaveRule, createBalanceAlertRule, listRules, setRuleStatus } from '@/lib/rules/service';
import { getFiatQuote, createFiatOrder, getFiatOrder, orderKeyForQuote, getConvertedUsdtBalanceRaw } from '@/lib/fiat/service';
import { verifyPayoutAccount, listPayoutAccounts, createPayout } from '@/lib/fiat/payouts';
import { presentQuote, presentOrder, presentPayoutAccount } from '@/lib/fiat/present';
import { syncComplianceProfile } from '@/lib/fiat/compliance';
import { formatKoboToNgn, formatUnitsToUsdt } from '@/lib/fiat/units';

/**
 * MCP tool surface (§ integrations).
 *
 * The same PrivyPay agent, reachable from ChatGPT/Claude. Every tool runs server-side as the
 * authenticated user (resolved from the MCP token — never from tool arguments) and reuses the
 * existing services, so policy, authorization, idempotency and recipient resolution are shared
 * with the app. Money never moves in a single tool call: `create_payment_preview` drafts and
 * `confirm_payment` issues the policy-checked, single-use authorization — there is deliberately
 * no unrestricted `send_payment`. The LLM never sees a key and never signs; final settlement
 * still requires explicit human approval (§25, §31, §46).
 */

export interface ToolContext {
  /** Internal PrivyPay user id (from the verified MCP token). */
  userId: string;
}

export interface ToolDef {
  name: string;
  description: string;
  /** Whether the tool moves or commits money (surfaced to clients as a caution). */
  mutating: boolean;
  schema: z.ZodTypeAny;
  handler: (ctx: ToolContext, args: unknown) => Promise<unknown>;
}

function decimals(token = 'USDC'): number {
  return getToken(token, activeNetwork.network)?.decimals ?? 6;
}

/** Build one tool from a typed zod schema, validating args before the handler runs. */
function tool<T extends z.ZodTypeAny>(def: {
  name: string;
  description: string;
  mutating?: boolean;
  schema: T;
  handler: (ctx: ToolContext, args: z.infer<T>) => Promise<unknown>;
}): ToolDef {
  return {
    name: def.name,
    description: def.description,
    mutating: def.mutating ?? false,
    schema: def.schema,
    handler: (ctx, raw) => {
      const parsed = def.schema.safeParse(raw ?? {});
      if (!parsed.success) {
        throw new ToolError('invalid_arguments', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
      }
      return def.handler(ctx, parsed.data);
    },
  };
}

/** A tool-level error the MCP layer turns into a structured (non-crashing) tool result. */
export class ToolError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

export const TOOLS: ToolDef[] = [
  tool({
    name: 'get_profile',
    description: "Get the current PrivyPay user's username and display name.",
    schema: z.object({}),
    handler: async (ctx) => {
      const profile = await getProfileByUserId(ctx.userId);
      if (!profile) throw new ToolError('no_profile', 'This account has no profile yet.');
      return { username: '@' + profile.username, displayName: profile.displayName };
    },
  }),

  tool({
    name: 'remember',
    description:
      "Save a short, durable fact or preference about the user to personalize future chats (e.g. 'usually pays @sarah', 'prefers GTBank for withdrawals', 'likes brief replies'). Do NOT store secrets, passwords, keys, OTPs, or full bank/card numbers.",
    schema: z.object({ content: z.string().min(1).max(240).describe('A concise fact/preference to remember.') }),
    handler: async (ctx, args) => {
      const res = await addMemory(ctx.userId, args.content);
      if (!res.ok) return { saved: false, reason: res.error };
      return { saved: true };
    },
  }),

  tool({
    name: 'create_money_rule',
    description:
      'Set up a programmable money automation. type "autosave_on_income": save `percent` (1-100) of every incoming payment to `destination` (@username). type "balance_alert": notify when USDC balance drops below `threshold` (decimal string). No money moves at setup; auto-saves execute later under policy + the user\'s delegated wallet. Reversible via set_money_rule_status.',
    schema: z.object({
      type: z.enum(['autosave_on_income', 'balance_alert']),
      percent: z.number().min(1).max(100).optional().describe('autosave: percent of incoming to save.'),
      destination: z.string().optional().describe('autosave: @username to save into.'),
      threshold: z.string().optional().describe('balance_alert: decimal USDC threshold, e.g. "20".'),
    }),
    handler: async (ctx, args) => {
      if (args.type === 'autosave_on_income') {
        if (args.percent == null || !args.destination) throw new ToolError('invalid_arguments', 'percent and destination are required for autosave.');
        const res = await createAutosaveRule(ctx.userId, { percent: args.percent, destinationUsername: args.destination });
        if (!res.ok) throw new ToolError('rule_failed', res.error);
        return { rule: res.rule };
      }
      if (!args.threshold) throw new ToolError('invalid_arguments', 'threshold is required for a balance alert.');
      const res = await createBalanceAlertRule(ctx.userId, { threshold: args.threshold });
      if (!res.ok) throw new ToolError('rule_failed', res.error);
      return { rule: res.rule };
    },
  }),

  tool({
    name: 'list_money_rules',
    description: "List the user's active money automations (auto-save, balance alerts).",
    schema: z.object({}),
    handler: async (ctx) => ({ rules: await listRules(ctx.userId) }),
  }),

  tool({
    name: 'set_money_rule_status',
    description: 'Pause, resume (active) or cancel a money automation by its id.',
    mutating: true,
    schema: z.object({ ruleId: z.string().min(1), status: z.enum(['active', 'paused', 'cancelled']) }),
    handler: async (ctx, args) => {
      const res = await setRuleStatus(ctx.userId, args.ruleId, args.status);
      if (!res.ok) throw new ToolError('not_found', res.error);
      return { ok: true, status: args.status };
    },
  }),

  tool({
    name: 'get_balance',
    description: "Get the current user's USDC balance on Celo.",
    schema: z.object({}),
    handler: async (ctx) => {
      const wallet = await getWalletByUserId(ctx.userId);
      if (!wallet) throw new ToolError('no_wallet', 'No wallet is provisioned for this account yet.');
      const bal = await getUsdcBalance(wallet.address);
      return {
        balance: bal ? bal.formatted : '0',
        token: 'USDC',
        network: activeNetwork.name,
        address: wallet.address,
      };
    },
  }),

  tool({
    name: 'find_contact',
    description: 'Look up a PrivyPay user by @username. Reports whether they exist and are in your contacts.',
    schema: z.object({ username: z.string().min(1).describe('The @username to look up.') }),
    handler: async (ctx, args) => {
      const name = normalizeUsername(args.username);
      const resolved = await resolveUsername(name);
      if (!resolved) return { username: '@' + name, exists: false, inContacts: false };
      const contacts = await listContacts(ctx.userId);
      const inContacts = contacts.some((c) => c.username === resolved.profile.username);
      return { username: '@' + resolved.profile.username, displayName: resolved.profile.displayName, exists: true, inContacts };
    },
  }),

  tool({
    name: 'get_recent_transactions',
    description: "List the current user's recent payments, newest first.",
    schema: z.object({ limit: z.number().int().min(1).max(50).optional().describe('Max rows (default 10).') }),
    handler: async (ctx, args) => {
      const rows = await listPayments(ctx.userId, args.limit ?? 10);
      return { transactions: rows };
    },
  }),

  tool({
    name: 'get_payment_status',
    description: 'Get the status of a payment by id. Reflects the on-chain receipt (never claims success before confirmation).',
    schema: z.object({ paymentId: z.string().min(1) }),
    handler: async (ctx, args) => {
      const res = await confirmPayment({ paymentId: args.paymentId, userId: ctx.userId });
      if (!res.ok) throw new ToolError('not_found', res.error);
      const p = res.payment;
      return {
        paymentId: p.id,
        status: p.status,
        amount: formatUnits(BigInt(p.amount), decimals(p.token)),
        token: p.token,
        network: activeNetwork.name,
        txHash: p.txHash,
        explorerUrl: p.txHash ? txExplorerUrl(p.txHash) : null,
      };
    },
  }),

  tool({
    name: 'create_payment_preview',
    description:
      'Draft a USDC payment: validate it, resolve the recipient, and run policy — WITHOUT sending. Returns a paymentId to pass to confirm_payment. Nothing moves until the human approves.',
    mutating: true,
    schema: z.object({
      recipient: z.string().min(1).describe('A @username or 0x address.'),
      amount: z.string().min(1).describe('Decimal USDC amount, e.g. "20".'),
      memo: z.string().max(200).optional(),
      idempotencyKey: z.string().min(8).optional().describe('Supply a stable key to make retries safe.'),
    }),
    handler: async (ctx, args) => {
      const wallet = await getWalletByUserId(ctx.userId);
      if (!wallet) throw new ToolError('no_wallet', 'No wallet is provisioned for this account yet.');
      const res = await previewPayment({
        senderUserId: ctx.userId,
        senderWalletAddress: wallet.address,
        recipient: args.recipient,
        amount: args.amount,
        memo: args.memo,
        idempotencyKey: args.idempotencyKey ?? `mcp_${randomUUID()}`,
      });
      if (!res.ok) throw new ToolError('preview_failed', res.error);
      const { payment, recipientDisplay } = res.result;
      return {
        paymentId: payment.id,
        status: payment.status,
        recipient: recipientDisplay,
        amount: args.amount,
        token: payment.token,
        network: activeNetwork.name,
        next: 'Call confirm_payment with this paymentId, then the user approves in PrivyPay to sign and settle.',
      };
    },
  }),

  tool({
    name: 'confirm_payment',
    description:
      'Confirm a previewed payment: re-runs policy and issues a single-use authorization bound to this exact payment, then settles it. If the user has enabled agent payments (delegated their wallet), Privy signs and broadcasts server-side and this returns the on-chain status. Otherwise it returns awaiting_approval for the user to sign in PrivyPay. Never claims success without an on-chain receipt; never handles a key.',
    mutating: true,
    schema: z.object({ paymentId: z.string().min(1) }),
    handler: async (ctx, args) => {
      const wallet = await getWalletByUserId(ctx.userId);
      if (!wallet) throw new ToolError('no_wallet', 'No wallet is provisioned for this account yet.');
      const res = await authorizePayment({ paymentId: args.paymentId, userId: ctx.userId, senderWalletAddress: wallet.address });
      if (!res.ok) throw new ToolError('authorize_failed', res.error);

      // Settle server-side when the wallet is delegated; otherwise hand back for in-app approval.
      const exec = await executeAuthorizedPayment({ paymentId: args.paymentId, userId: ctx.userId, authorizationId: res.authorizationId });
      if (exec.ok) {
        return {
          paymentId: args.paymentId,
          status: exec.status, // PENDING until the receipt confirms — never a premature success
          txHash: exec.txHash,
          explorerUrl: txExplorerUrl(exec.txHash),
          poll: 'Use get_payment_status to confirm settlement (CONFIRMED).',
        };
      }
      return {
        paymentId: args.paymentId,
        status: 'awaiting_approval',
        reason: exec.code, // not_delegated | not_configured
        message:
          exec.code === 'not_delegated'
            ? 'Authorized by policy. Enable agent payments in PrivyPay (delegate your wallet) to let the agent settle, or approve this payment in the app to sign it.'
            : 'Authorized by policy. The user must approve this payment in PrivyPay to sign and broadcast it.',
        approveUrl: (env.NEXT_PUBLIC_SITE_URL ?? '') + '/app',
        poll: 'Use get_payment_status to watch for CONFIRMED.',
      };
    },
  }),

  tool({
    name: 'create_request',
    description: 'Create a payment request asking a @username to pay the current user. Non-custodial — no funds move.',
    mutating: true,
    schema: z.object({
      payer: z.string().min(1).describe('The @username being asked to pay.'),
      amount: z.string().min(1).describe('Decimal USDC amount.'),
      memo: z.string().max(200).optional(),
    }),
    handler: async (ctx, args) => {
      const res = await createRequest(ctx.userId, { payerUsername: args.payer, amount: args.amount, memo: args.memo });
      if (!res.ok) throw new ToolError('request_failed', res.error);
      return { request: res.request };
    },
  }),

  // --- Fiat / NGN↔USDT (autonomous money). Same policy + authorization model as payments: the
  //     LLM proposes a quote and creates an order, but the AgentPolicyEngine decides, and money
  //     moves only on an explicit confirmation. Disabled unless a fiat provider is configured.
  tool({
    name: 'get_ngn_usdt_quote',
    description:
      'Get a live NGN↔USDT conversion quote. side "buy" spends NGN to receive USDT; side "sell" converts USDT to NGN. By default amount is in NGN for a buy and USDT for a sell — pass amountCurrency:"NGN" with side:"sell" for a naira-target withdrawal (how much USDT to sell to pay out that naira). Returns a paymentless, expiring quote; nothing moves.',
    schema: z.object({
      side: z.enum(['buy', 'sell']),
      amount: z.string().min(1).describe('NGN amount for a buy, USDT amount for a sell (or NGN when amountCurrency is NGN).'),
      amountCurrency: z.enum(['NGN', 'USDT']).optional(),
    }),
    handler: async (ctx, args) => {
      if (!features.fiat) throw new ToolError('fiat_not_enabled', 'Fiat conversion is not enabled.');
      const res = await getFiatQuote({ userId: ctx.userId, side: args.side, amount: args.amount, amountCurrency: args.amountCurrency });
      if (!res.ok) throw new ToolError('quote_unavailable', res.error);
      return { quote: presentQuote(res.result.quote), sandbox: features.fiatSandbox, next: 'Show this quote and, on confirmation, call create_buy_usdt_order / create_sell_usdt_order with the quoteId.' };
    },
  }),

  tool({
    name: 'create_buy_usdt_order',
    description:
      'Confirm a BUY quote (NGN→USDT) into an order. Runs policy + authorization and returns funding instructions. The order settles later via provider webhooks — never claims success here.',
    mutating: true,
    schema: z.object({ quoteId: z.string().min(1), idempotencyKey: z.string().min(8).optional() }),
    handler: async (ctx, args) => {
      if (!features.fiat) throw new ToolError('fiat_not_enabled', 'Fiat conversion is not enabled.');
      const res = await createFiatOrder({ userId: ctx.userId, quoteId: args.quoteId, idempotencyKey: args.idempotencyKey ?? orderKeyForQuote(args.quoteId) });
      if (!res.ok) throw new ToolError('order_failed', res.error);
      return { order: presentOrder(res.order), funding: res.funding ?? null, poll: 'Use get_fiat_order_status to watch for settlement.' };
    },
  }),

  tool({
    name: 'create_sell_usdt_order',
    description:
      "Confirm a SELL quote (USDT→NGN) into an order that pays out to the user's bank. Uses the user's first linked payout account when payoutAccountId is omitted. Runs policy + authorization; settles via webhooks.",
    mutating: true,
    schema: z.object({ quoteId: z.string().min(1), payoutAccountId: z.string().optional(), idempotencyKey: z.string().min(8).optional() }),
    handler: async (ctx, args) => {
      if (!features.fiat) throw new ToolError('fiat_not_enabled', 'Fiat conversion is not enabled.');
      const res = await createFiatOrder({ userId: ctx.userId, quoteId: args.quoteId, payoutAccountId: args.payoutAccountId, idempotencyKey: args.idempotencyKey ?? orderKeyForQuote(args.quoteId) });
      if (!res.ok) throw new ToolError('order_failed', res.error);
      return { order: presentOrder(res.order), poll: 'Use get_fiat_order_status to watch for the payout.' };
    },
  }),

  tool({
    name: 'get_fiat_order_status',
    description: 'Get the status of a fiat (NGN↔USDT) order by id. Reflects the provider/settlement state; never claims success prematurely.',
    schema: z.object({ orderId: z.string().min(1) }),
    handler: async (ctx, args) => {
      if (!features.fiat) throw new ToolError('fiat_not_enabled', 'Fiat conversion is not enabled.');
      const order = await getFiatOrder(ctx.userId, args.orderId);
      if (!order) throw new ToolError('not_found', 'Order not found.');
      return { order: presentOrder(order) };
    },
  }),

  tool({
    name: 'get_user_limits',
    description: "Get the current user's fiat conversion limits (per-order, daily, monthly), in NGN.",
    schema: z.object({}),
    handler: async () => {
      return {
        currency: 'NGN',
        minOrder: '₦' + formatKoboToNgn(FIAT_LIMITS.minOrderNgn),
        perOrder: '₦' + formatKoboToNgn(FIAT_LIMITS.perOrderNgn),
        daily: '₦' + formatKoboToNgn(FIAT_LIMITS.dailyNgn),
        monthly: '₦' + formatKoboToNgn(FIAT_LIMITS.monthlyNgn),
      };
    },
  }),

  tool({
    name: 'get_compliance_status',
    description: "Get the current user's KYC/compliance status for fiat conversion.",
    schema: z.object({}),
    handler: async (ctx) => {
      if (!features.fiat) throw new ToolError('fiat_not_enabled', 'Fiat conversion is not enabled.');
      const status = await syncComplianceProfile(ctx.userId);
      return { kycStatus: status.kycStatus, provider: status.provider, sandbox: features.fiatSandbox };
    },
  }),

  tool({
    name: 'get_usdt_balance',
    description: "Get the current user's USDT balance from their Pexa conversions (naira buys in, sells out).",
    schema: z.object({}),
    handler: async (ctx) => {
      if (!features.fiat) throw new ToolError('fiat_not_enabled', 'Fiat conversion is not enabled.');
      const raw = await getConvertedUsdtBalanceRaw(ctx.userId);
      return { balance: formatUnitsToUsdt(raw), token: 'USDT', sandbox: features.fiatSandbox };
    },
  }),

  tool({
    name: 'get_payout_accounts',
    description: "List the current user's verified bank payout accounts (for receiving naira).",
    schema: z.object({}),
    handler: async (ctx) => {
      if (!features.fiat) throw new ToolError('fiat_not_enabled', 'Fiat conversion is not enabled.');
      const accounts = await listPayoutAccounts(ctx.userId);
      return { accounts: accounts.map(presentPayoutAccount) };
    },
  }),

  tool({
    name: 'verify_payout_account',
    description: 'Verify a Nigerian bank account with the provider and link it for naira payouts. Stores only a tokenized reference — never raw bank details.',
    mutating: true,
    schema: z.object({
      accountNumber: z.string().min(6).describe('The bank account number (NUBAN).'),
      bankCode: z.string().min(3).describe('The bank code / sort code.'),
    }),
    handler: async (ctx, args) => {
      if (!features.fiat) throw new ToolError('fiat_not_enabled', 'Fiat conversion is not enabled.');
      const res = await verifyPayoutAccount(ctx.userId, { accountNumber: args.accountNumber, bankCode: args.bankCode });
      if (!res.ok) throw new ToolError('verification_failed', res.error);
      return { account: presentPayoutAccount(res.account) };
    },
  }),

  tool({
    name: 'create_payout',
    description:
      'Withdraw naira to a linked bank account (off-ramp): sells enough USDT to net the requested NGN and pays it out. Runs policy + authorization; settles via webhooks. If payoutAccountId is omitted, the first linked account is used.',
    mutating: true,
    schema: z.object({
      amountNgn: z.string().min(1).describe('Naira amount to receive, e.g. "100000".'),
      payoutAccountId: z.string().optional(),
      idempotencyKey: z.string().min(8).optional(),
    }),
    handler: async (ctx, args) => {
      if (!features.fiat) throw new ToolError('fiat_not_enabled', 'Fiat conversion is not enabled.');
      const res = await createPayout(ctx.userId, { amountNgn: args.amountNgn, payoutAccountId: args.payoutAccountId, idempotencyKey: args.idempotencyKey });
      if (!res.ok) throw new ToolError('payout_failed', res.error);
      return { orderId: res.orderId, status: res.status, poll: 'Use get_payout_status with this orderId.' };
    },
  }),

  tool({
    name: 'get_payout_status',
    description: 'Get the status of a naira payout/withdrawal by its order id.',
    schema: z.object({ orderId: z.string().min(1) }),
    handler: async (ctx, args) => {
      if (!features.fiat) throw new ToolError('fiat_not_enabled', 'Fiat conversion is not enabled.');
      const order = await getFiatOrder(ctx.userId, args.orderId);
      if (!order) throw new ToolError('not_found', 'Payout not found.');
      return { order: presentOrder(order) };
    },
  }),
];

export const TOOLS_BY_NAME: Map<string, ToolDef> = new Map(TOOLS.map((t) => [t.name, t]));
