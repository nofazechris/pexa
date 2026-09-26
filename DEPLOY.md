# Deploying Pexa

Next.js 16 app (App Router, Turbopack). Deploys cleanly on **Vercel**. `next build` is the
production build (verified: 39 routes, typecheck + tests green).

Pexa is positioned as **a new way to interact with money on-chain** (Celo/USDC). The NGN↔USDT
(naira) rails exist in the codebase but ship **hidden** until the merchant account is live — see
§Fiat below. Nothing in this checklist turns naira on unless you explicitly set `FIAT_PUBLIC`.

## 1. Push, then import the repo
The code lives on GitHub. In Vercel: **Add New → Project → Import** the repo. Framework preset is
auto-detected (Next.js); build command `next build`. Pick the branch to deploy as production
(`main`, or set the release branch as the production branch).

## 2. Environment variables (Project → Settings → Environment Variables)
Set these for **Production** (and Preview if you use it). `.env*` is gitignored, so nothing is
committed — enter them here. Names are copied from `.env.example` / `src/lib/config/env.ts`.

**Required for the core app**
- `DATABASE_URL` — Supabase Postgres connection string
- `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `NEXT_PUBLIC_PRIVY_APP_ID`
- `NEXT_PUBLIC_SITE_URL` — the deployed origin, e.g. `https://pexa.vercel.app`
- `APP_ENV` = `production`

**Celo settlement — set to mainnet for launch**
- `CELO_NETWORK` = `mainnet`
- `CELO_RPC_URL` — a **paid/SLA RPC endpoint** for mainnet. Do **not** rely on the public
  `forno.celo.org` for production; we hit transient DNS/connection drops on it during testing.
  Use a provider with an SLA (e.g. a dedicated Celo RPC). `CELO_SEPOLIA_RPC_URL` is only for the
  `sepolia` testnet.
- `CELO_USDC_ADDRESS` — mainnet USDC `0xcebA9300f2b948710d2653dD7B07f33A8B32118C`

**Gasless relayer (EIP-3009)** — strongly recommended on mainnet
- `RELAYER_PRIVATE_KEY` — private key of a **funded** server wallet that submits
  `transferWithAuthorization` so users never pay CELO gas. Public address for the current
  keypair is `0x4F8a2a0f36E11F9064595c792d28ce48F87a6D9a`; **fund it with CELO** before enabling.
  Absent → users pay their own native CELO gas from their embedded wallet. Server-only secret;
  never exposed to the client or the AI.

**AI agent (in-app + MCP)** — until set, the agent uses the safe rule-based fallback
- `AI_PROVIDER` = `openai`, `AI_API_KEY` = your OpenAI key
- `AI_MODEL` (optional) — pinned to `gpt-4.1-nano` for latency; unset falls back to the provider default

**MCP (ChatGPT/Claude connector)** — required to enable the MCP endpoint
- `MCP_SECRET` = any non-empty value (feature flag that turns `/api/mcp` on)

**Delegated server signing (autonomous confirm + recurring/rules execution)** — optional
- `PRIVY_AUTHORIZATION_KEY` — Privy authorization private key (register the keypair in the Privy
  dashboard, enable delegated actions). Without it, `confirm_payment` and the workers safely fall
  back to in-app approval / skip.

**Cron secret** — required for the schedules to run
- `CRON_SECRET` = any non-empty value. Vercel Cron calls the endpoints in `vercel.json` hourly
  with `Authorization: Bearer $CRON_SECRET`, which each endpoint checks. Without it the cron
  endpoints are disabled.

**Fiat / NGN↔USDT (naira)** — leave UNSET for launch (feature stays hidden)
- `FIAT_PROVIDER` — `sandbox` (labeled mock, never moves real money) or `quidax` (live). Absent
  → the fiat feature is disabled entirely.
- `FIAT_PUBLIC` — set `true` to surface naira in the consumer app + in-app agent. **Leave unset**
  until the Quidax merchant/KYB account is live; the app then shows only the on-chain experience.
- `FUNDING_LIVE` — set `true` only when real naira funding/on-ramp is actually live; otherwise the
  UI honestly says "funding coming soon".
- Quidax (only when `FIAT_PROVIDER=quidax`): `QUIDAX_SECRET_KEY`, `QUIDAX_WEBHOOK_KEY`,
  `QUIDAX_BASE_URL`, `QUIDAX_USDT_NETWORK`, and `FIAT_WEBHOOK_SECRET` for webhook signature
  verification. Requires a Quidax **merchant/business (KYB)** account — a personal key returns
  403. Keep off until that's approved.

## 3. Privy dashboard
Add the deployed origin (`https://<your-domain>`) to Privy's **allowed origins / redirect URLs**,
or login and embedded wallets won't work on the live site. If using delegated signing, register
the authorization keypair and enable delegated actions.

## 4. Database migrations
Run migrations against the production database if it's fresh:

```bash
npm run db:migrate
```

with the production `DATABASE_URL`. Current migrations through `0010` cover: core payments,
waitlist (`0007`), fiat (`0008`), agent memories (`0009`), and money rules (`0010`).

## 5. After deploy
- **MCP endpoint** is public at `https://<your-domain>/api/mcp` — paste it plus a generated token
  (in-app: Connected → Connect ChatGPT/Claude) into the agent's custom connector.
- **Cron** — `vercel.json` registers **one daily** job, `/api/cron/tick`, which runs every worker
  in sequence: recurring payments, money rules (auto-save, balance alerts), and fiat
  reconciliation (a no-op while fiat is disabled). This is deliberately a single daily job so it
  fits the **Hobby plan limits** (max 2 cron jobs, once-per-day) — otherwise the deploy is
  rejected. For **hourly** cadence you have two options without changing the code:
  - **Vercel Pro** — bump `vercel.json` back to hourly (`0 * * * *`) and point at the three
    individual endpoints, or keep `/api/cron/tick` hourly.
  - **External scheduler** (free) — e.g. cron-job.org or a GitHub Actions cron hitting
    `/api/cron/recurring`, `/api/cron/rules`, `/api/cron/fiat-reconcile` (or `/api/cron/tick`)
    with header `Authorization: Bearer $CRON_SECRET`. The individual endpoints are still live.
- **Waitlist** submissions land in the `waitlist` table via `/api/waitlist`.

## Launch checklist (mainnet)
- [ ] `CELO_NETWORK=mainnet` + paid `CELO_RPC_URL` set in Vercel
- [ ] `APP_ENV=production`, `NEXT_PUBLIC_SITE_URL` = live origin
- [ ] Relayer wallet `0x4F8a2a0f36E11F9064595c792d28ce48F87a6D9a` funded with CELO, then
      `RELAYER_PRIVATE_KEY` set (otherwise users pay their own gas)
- [ ] Privy allowed origins include the live domain
- [ ] `MCP_SECRET`, `CRON_SECRET` set; `AI_API_KEY` set (or accept rule-based fallback)
- [ ] Migrations run against the production DB
- [ ] Fiat stays hidden: `FIAT_PUBLIC` / `FUNDING_LIVE` unset until Quidax merchant is live
