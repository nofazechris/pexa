# PEXA — PROJECT BRIEF & BUILD PROMPT

> Paste this into Claude Code as the guiding context for the Pexa project. It describes what Pexa
> is, the current architecture and design, what is already built, the rules to follow, and the
> new requirements to implement. **This is an existing, working codebase — extend it, do not
> rebuild it.**

---

## 1. WHAT PEXA IS

Pexa is **an AI financial agent** — a new way to interact with money on-chain. Instead of
navigating a crypto wallet or an exchange, the user **talks to Pexa** in plain language and Pexa
does the work: send, request, schedule and manage payments, and (for Nigeria) buy/sell USDT with
naira, link a bank account, fund, convert and withdraw.

Positioning line: **"Talk to your money."** Pexa is a new way to interact with finance on-chain —
not a crypto exchange with a chatbot, not a generic AI assistant, not a banking dashboard.

Core interaction model:

```
UNDERSTAND → PLAN → VALIDATE → PREVIEW → AUTHORIZE → EXECUTE → MONITOR → RECEIPT
```

The single most important principle: **the LLM is autonomous in ORCHESTRATION but the backend is
deterministic in AUTHORIZATION.** The model proposes; the backend decides. Intent is never
authorization.

---

## 2. TECH STACK (do not change without reason)

- **Framework:** Next.js 16 (App Router, Turbopack), React 19, TypeScript. NOTE: this Next version
  has breaking changes vs training data — read `node_modules/next/dist/docs/` before writing Next code.
- **DB:** Postgres (Supabase) via Drizzle ORM. Migrations in `drizzle/`.
- **Auth + wallets:** Privy (embedded wallets; keys live in Privy's TEE, never exposed).
- **Chain:** Celo (currently Sepolia testnet). USDC on-chain today; USDT is the fiat-conversion
  asset (USDT on Celo is supported by the fiat provider).
- **AI:** OpenAI behind a provider boundary (`AI_PROVIDER`/`AI_MODEL`, currently `gpt-4.1-nano`),
  with a deterministic rule-based fallback.
- **Integrations:** MCP server (ChatGPT/Claude) at `/api/mcp`. NO WhatsApp, NO Codex.
- **Testing:** Vitest. **Deploy:** Vercel.

---

## 3. ARCHITECTURE

```
CLIENT (chat-first)                    LLM never moves money
  Chat · Wallet · Activity · Payments · Settings
        │
        ▼
  APPLICATION API (/api/*)
        │
        ▼
  PEXA AI AGENT (server-side tool-calling runtime)   ← proposes actions
        │
        ▼
  AGENT POLICY ENGINE (deterministic)                ← decides ALLOW/BLOCK/REQUIRE_*
        │
        ▼
  TRANSACTION / PAYMENT ENGINE  ·  FIAT SERVICE
        │                              │
        ▼                              ▼
  CELO (USDC, Privy signing / relayer)   FIAT PROVIDER (NGN↔USDT, bank payouts)
        │                              │
        ▼                              ▼
  On-chain confirmation            Provider webhooks (signed)
        └──────────────┬───────────────┘
                       ▼
              RECONCILIATION → receipt → user
```

The AI never signs, never holds a key, and never settles by itself. Money moves only through:
**preview/quote → policy → single-use authorization (bound to exact params) → idempotent execution
→ on-chain/provider confirmation.**

---

## 4. DATA MODEL (Drizzle, `src/lib/db/schema.ts`)

Existing tables (reuse — do not duplicate):
- `users` (Privy DID → internal id), `profiles` (unique username), `wallets` (per-user, per-chain).
- `payments` (send state machine + idempotency), `authorizations` (single-use, param-bound),
  `contacts`, `requests`, `recurring_payments`, `mcp_tokens`, `waitlist`.
- Fiat: `fiat_quotes`, `fiat_orders` (the FinancialAction for fiat; buy/sell state machines),
  `payout_accounts` (tokenized bank refs), `compliance_profiles` (KYC), `provider_webhook_events`
  (idempotency + audit).

All money amounts are **integer smallest-unit decimal strings** (USDC/USDT 6dp; NGN in kobo, 2dp).
Never floats.

---

## 5. SECURITY MODEL (non-negotiable)

- LLM output never bypasses backend authorization. The **AgentPolicyEngine** (`src/lib/policy/`)
  is the boundary: ALLOW / REQUIRE_CONFIRMATION / BLOCK / REQUIRE_KYC / REQUIRE_REAUTH.
- Explicit user confirmation for every irreversible money move; authorization bound to exact
  amount/recipient/token/network and single-use.
- Idempotency on payments and fiat orders. Quote expiry (fiat). Balance re-checked at execution.
- Private keys never in the frontend, localStorage, logs, the LLM, or chat.
- MCP authenticates per-user by token; same policy engine applies to MCP as to the app.
- Webhooks are signature-verified and idempotent; never trust a client-claimed status.

---

## 6. THE AI AGENT (`src/lib/agent/`)

The in-app bot is a **server-side tool-calling agent** (`runtime.ts`, `/api/agent/chat` +
`/api/agent/execute`). It reuses the same tools MCP exposes (`src/lib/mcp/tools.ts`), run as the
authenticated user.

Three autonomy levels:
- **READ** (auto): balance, USDT balance, profile, contacts, transactions, quotes, limits,
  compliance, list payout accounts.
- **PREPARE** (auto): create payment preview, get NGN↔USDT quote, verify/link a bank account.
- **EXECUTE** (never auto): confirm_payment, create_buy_usdt_order, create_sell_usdt_order — the
  runtime intercepts these and returns a **pending action** the user must confirm; execution runs
  server-side through the policy engine.

The chat UI (`useAgentChat` + `PexaApp`) renders the agent's text plus confirmation cards
(payment preview / fiat quote) and receipts. Crypto sends settle via the client-sign path; fiat
settles server-side.

---

## 7. FIAT NGN↔USDT (`src/lib/fiat/`)

Everything provider-specific sits behind the **`FiatProvider` interface** (`provider.ts`):
`getQuote, createBuyOrder, createSellOrder, getOrderStatus, getFundingInstructions,
verifyBankAccount, createPayout, getPayoutStatus, getLimits, getKycStatus, handleWebhook`.

- **`sandbox.ts`** — clearly-labeled MOCK (default, `FIAT_PROVIDER=sandbox`). Never shows live
  rates; in dev it auto-settles orders so the full loop is demoable end-to-end.
- **`quidax.ts`** — real Quidax adapter (scaffold, inert until `QUIDAX_SECRET_KEY` is set). Quidax
  is the chosen provider: SEC-regulated, per-user sub-accounts, on/off-ramp, bank payouts, USDT on
  Celo. On-ramp initiate→confirm returns an NGN bank account to fund; off-ramp initiate→add
  bank→confirm returns a USDT deposit address; webhooks signed with `quidax-signature`.
- Quote pricing is **locked** from quote → order → settlement (settlement only changes status).
- Routes: `/api/fiat/quote`, `/api/fiat/orders(/[id])`, `/api/fiat/payout-accounts(/[id])`,
  `/api/fiat/balance`, `/api/fiat/webhooks/[provider]`, `/api/cron/fiat-reconcile`.

---

## 8. DESIGN SYSTEM (`src/lib/design/tokens.ts`, `globals.css`)

Premium, AI-native fintech — restrained and deliberate. NOT a generic crypto dashboard: no AI
purple, no neon, no decorative gradients.

- **Palette:** cobalt primary `#1B45D7` (hover `#153AB4`, soft `#EDF1FE`); ink/navy `#0E1420`;
  background off-white `#F6F7F9`, surface `#FFFFFF`; blue-gray text `#5B6472`/`#5F6878`/`#6C7484`;
  borders `#E4E7EC`/`#DCE0E7`/`#EDEFF3`; success `#167A54`, warning `#8A6A1E`, danger `#C0362A`.
- **Radius:** cards 12–16px (`14`), controls 10–12px (`11`); nothing becomes a pill except chips.
- **Shadows:** high-offset, low-opacity (`0 30px 60px -38px rgba(14,20,32,.34)`).
- **Type:** Geist (sans) + Geist Mono; mono for addresses, codes, eyebrows, amounts-as-data.
- Chat is the center of the product. Cards are the primary structured surface. Mobile works.

---

## 9. ROUTES & SCREENS

`/` landing (marketing + waitlist + interactive demo), `/login`, `/onboarding`,
`/app` (chat), `/app` tabs: **Chat · Wallet · Activity · Payments · Settings**.
Wallet shows balances (USDC + derived USDT), quick actions (Buy/Convert/Send/Withdraw — all hand
off to chat), identity + Celo address, and linked bank accounts.

---

## 10. CURRENT BUILD STATE (already done — preserve)

- Auth, usernames, wallet provisioning, Celo/USDC, payment engine (preview→auth→broadcast→confirm),
  requests, recurring + cron worker, contacts, activity.
- MCP server (token-authed, per-user), waitlist.
- Agentic in-app bot (tool-calling runtime + confirm gate).
- Fiat NGN↔USDT: config, provider abstraction, sandbox (auto-settles in dev), policy engine,
  quote→order service (price-locked, idempotent), buy/sell/withdraw, payout accounts, signed
  webhook settlement + reconciliation, derived USDT balance, Wallet UI, landing copy + demo.
- Quidax adapter (inert until keys). Sandbox is the default.

Health: typecheck clean, full test suite green.

---

## 11. NEW REQUIREMENTS TO IMPLEMENT (this round)

1. **Beta / deploying status in the app.** The dashboard/app must clearly show that Pexa is in
   **beta** and **being deployed** (e.g. a subtle "Beta" badge in the header/sidebar and a
   short "Pexa is in beta — deploying" note). Positioning copy: *"Pexa is a new way to interact
   with finance on-chain."*

2. **Funding is not live yet — say so honestly.** Real funding/on-ramp is not available in the
   current demo (you cannot actually fund). Surface this clearly wherever funding is offered
   (Wallet "Buy/Fund", chat) — e.g. a "Funding is coming soon / not available in beta" state —
   rather than implying money can move. Keep it on the roadmap; do not fake a successful fund.

3. **A smarter agent for the unknown.** When a request doesn't map cleanly to a fixed intent/tool
   (something outside the current constraints, or a feature that doesn't exist yet), the agent
   must **reason about it and respond helpfully** — clarify, explain what Pexa can/can't do yet,
   or capture it — instead of a flat "I didn't catch that." If a user describes a new feature or
   asks for something novel, use it to understand intent and respond intelligently. Never invent
   capabilities or fake success; be smart AND honest, always within the policy/security boundary.

4. **Agent memory — learn the user.** Pexa should remember useful, non-sensitive facts and
   preferences per user (e.g. frequent recipients, preferred amounts/cadence, default bank,
   naming, tone) and use them to personalize future conversations. Store memory server-side,
   scoped per user; never store secrets, keys, or full bank/card numbers. Memory informs
   orchestration only — it can never relax limits, KYC, or confirmation.

---

## 12. HARD RULES

- Do NOT rebuild working systems. Reuse; extend; fix. Only add new architecture where required.
- Do NOT fake anything: no live rates, funding, payouts, KYC, or settlement unless a real
  provider is connected. The sandbox is clearly labeled; production is behind config.
- Chat is the primary experience. Everything (fund, convert, withdraw, add bank) happens through
  the bot; UI buttons are shortcuts into chat.
- The LLM is not the security boundary. Confirmation + policy engine are mandatory for money moves.
- Amounts are integer smallest-units as strings. Celo settlement details (chain/token/address/tx)
  come from config, never hard-coded.
- Preserve the design system and tokens; keep it premium and restrained.

---

## 13. ENV (see `.env.example`)

Core: `DATABASE_URL`, `PRIVY_APP_ID/SECRET/NEXT_PUBLIC_PRIVY_APP_ID`, `CELO_NETWORK`,
`CELO_*_RPC_URL`, `CELO_USDC_ADDRESS`, `NEXT_PUBLIC_SITE_URL`, `APP_ENV`.
AI: `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`. MCP: `MCP_SECRET`. Cron: `CRON_SECRET`.
Fiat: `FIAT_PROVIDER` (sandbox|quidax), `FIAT_WEBHOOK_SECRET`, and for Quidax
`QUIDAX_SECRET_KEY/QUIDAX_WEBHOOK_KEY/QUIDAX_BASE_URL/QUIDAX_USDT_NETWORK`.

---

## 14. HOW TO RUN

```bash
npm run dev        # dev server
npm run typecheck  # tsc --noEmit
npm test           # vitest
npm run db:generate && npm run db:migrate   # after schema changes
```

Work in small, reviewable, verified increments. After changing schema, generate + apply a
migration. After changing observable behavior, verify in the browser and share proof.
