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

**Email (waitlist welcome + your referral link)** — optional; nothing is sent until both are set
- You do **not** need your own mail server. Sending is done by an email service (we use
  [Resend](https://resend.com); free tier is enough to start). Steps:
  1. Create a Resend account → **Domains → Add domain** → `pexaapp.xyz`.
  2. Resend shows a few DNS records (SPF, DKIM, and optionally DMARC). Add them at wherever the
     domain is registered/managed (Namecheap, Cloudflare, Vercel Domains, …). Wait until Resend
     says **Verified** (minutes to a few hours).
  3. Resend → **API Keys** → create one (sending access).
  4. In Vercel set `RESEND_API_KEY` = that key and `EMAIL_FROM` = e.g. `Pexa <hello@pexaapp.xyz>`
     (must be an address on the verified domain), then redeploy.
- Also set `NEXT_PUBLIC_SITE_URL` = `https://pexaapp.xyz` so referral links inside emails use your
  real domain (the app deliberately doesn't trust request headers for this).
- Until configured, signup still works and the on-screen "#N in line" + share link still appear;
  only the email is skipped. Failures to send are logged (Vercel → Logs → `[email]`), never shown to users.
- Sending to **everyone** on the waitlist (e.g. an "app is live" invite): export the list
  (`/api/waitlist/export`, below) and import the CSV into Resend Audiences / Mailchimp / Loops, or
  ask to have a bulk-invite script added. Only email people the invite promises (they joined for it).

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
- **One wallet per user.** Privy creates the embedded wallet at login (`createOnLogin`); the app
  never creates one eagerly and the wallet pinned in the `wallets` table is permanent and is the
  only one ever displayed or signed with. To prove the invariant after a deploy or a batch of
  sign-ups, run the read-only audit (needs `DATABASE_URL`, `PRIVY_APP_ID`, `PRIVY_APP_SECRET` in
  `.env`): `npm run wallets:audit` — it lists every user's Privy wallets, balances, and flags any
  mismatch. Privy has no API to delete a single wallet; pre-fix duplicates are empty and unused.
- **Referrals.** Everyone on the waitlist and every app user has a share link (`/r/<code>`; the
  older `/?ref=<code>` form still works). Waitlist: joining shows "#N in line" (with confetti for a
  new signup); each friend who joins through your link moves you up (ranking = most referrals
  first, ties by who joined earlier). **Anyone already on the list — including people who joined
  before referrals existed — gets their link by typing their email into the waitlist form again**
  ("You're already on the list — here's your link"); a code is created on the spot if they have none.
  So to bring the early people in, just message them the site and ask them to re-enter their email.
  Trade-off: that makes the form reveal whether an email is on the list (it returns no email/name,
  only the entry's share link and rank; per-IP rate limiting slows enumeration).
  **Ready-made tweet:** "Post on X" opens X's compose box pre-filled ("I'm #N on the Pexa waitlist…
  use my referral link to climb up the ranking", their link, `#Pexa`). Posting the link unfurls a
  personal 1200×630 picture ("I'm #N on the Pexa waitlist") rendered by `/api/og/waitlist` and wired
  in by the `/r/<code>` page's `og:image` / `twitter:image`. X's web intent can't attach an uploaded
  image, so the picture appears as the link's preview card. Set `NEXT_PUBLIC_SITE_URL` so those
  preview URLs use your real domain. App: the Wallet screen has an "Invite friends" card; a referral
  counts when the friend finishes onboarding (claims a username).
  Attribution is stored permanently in `referral_codes` / `referrals` (one referrer per person, ever),
  so sharing fees with referrers later is a query over that ledger — no data migration needed.
  Known limit: waitlist referrals count on signup (emails aren't verified yet), so someone could
  inflate their rank with fake addresses; per-IP rate limiting slows this. Once email is live, the
  fix is to count a referral only after the friend confirms their email.
- **Waitlist** submissions land in the `waitlist` table via `/api/waitlist`. Export them as a CSV
  spreadsheet from `GET /api/waitlist/export` (admin-only — gated on `CRON_SECRET`):
  `curl -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/waitlist/export -o waitlist.csv`
  (or open `https://<domain>/api/waitlist/export?key=<CRON_SECRET>` in a browser to download).

## Feature readiness — live now vs. needs config
What actually works depends on which secrets are set. Nothing below is faked; features that can't
run yet **skip safely** rather than pretend.

| Feature | Works with core config | Needs delegated signing¹ | Needs a paid RPC² |
|---|---|---|---|
| Manual send / request / pay (user signs in-app) | ✅ | — | ✅ |
| Savings **vaults** (create/deposit/withdraw) | ✅ | — | — |
| **Auto-save into a vault** (rule) | ✅ | — | — |
| Balance alerts | ✅ | — | ✅ (reads balance) |
| **Recurring auto-pay** (unattended) | ⚠️ skips until ¹ | ✅ | ✅ |
| **Auto-save on-chain to a @username** (rule) | ⚠️ skips until ¹ | ✅ | ✅ |
| Gasless sends (user holds no CELO) | ⚠️ off until relayer funded | ✅³ | ✅ |
| NGN↔USDT (naira) | ❌ hidden | — | — (needs Quidax merchant) |

¹ **Delegated signing** = `PRIVY_AUTHORIZATION_KEY` set in Vercel **and** the user has delegated
their wallet in-app ("enable agent payments"). Without it, the recurring/on-chain-autosave workers
return `not_configured`/`not_delegated` and **skip** — no money moves, nothing breaks.
² Use an SLA RPC in production; the public `forno.celo.org` drops connections.
³ The recurring and auto-save workers now use the **gasless relayer automatically** when
`RELAYER_PRIVATE_KEY` is set and the token is USDC: the server signs an EIP-3009
`transferWithAuthorization` on the user's behalf (delegated) and the relayer pays the CELO gas — so
unattended payments don't require the user's wallet to hold CELO. If the relayer isn't configured,
they fall back to a direct delegated send (the user's wallet pays gas).

**Vaults are earmarks, not transfers.** A vault sets USDC aside *within the user's own wallet*
(the neobank "Pots/Spaces" model) — the funds never move on-chain, so vault deposits/withdrawals
need no gas, no delegation and no RPC, and work the moment the DB migration is applied. "Available"
balance = on-chain balance − everything earmarked.

## Launch checklist (mainnet)
- [ ] `CELO_NETWORK=mainnet` + paid `CELO_RPC_URL` set in Vercel
- [ ] `APP_ENV=production`, `NEXT_PUBLIC_SITE_URL` = live origin
- [ ] Relayer wallet `0x4F8a2a0f36E11F9064595c792d28ce48F87a6D9a` funded with CELO, then
      `RELAYER_PRIVATE_KEY` set (otherwise users pay their own gas)
- [ ] Privy allowed origins include the live domain
- [ ] `MCP_SECRET`, `CRON_SECRET` set; `AI_API_KEY` set (or accept rule-based fallback)
- [ ] Migrations run against the production DB (through `0011` — adds savings vaults)
- [ ] `PRIVY_AUTHORIZATION_KEY` set + delegated actions enabled, if you want recurring auto-pay and
      on-chain auto-save to run unattended (vaults + vault auto-save work without it)
- [ ] Fiat stays hidden: `FIAT_PUBLIC` / `FUNDING_LIVE` unset until Quidax merchant is live

## Buy (Celo x402 marketplace)
Pexa's agent can buy live data, browser access and cloud compute from Celo's Buy marketplace,
paid in USDC on Celo **mainnet** (`CELO_NETWORK=mainnet`; on any other network Buy switches itself
off and the agent tools disappear).

- **No new env vars.** Migrations `0014` (`buy_settings`, `buy_purchases`) and `0015` (`pay_token` columns) — apply them like the others.
- **Pay in USDC, USDT or USA₮ (USAT).** The user's choice lives on the Buy page; the server falls back to a token the wallet holds. To pay in USAT/USDT the wallet needs a balance of it (send it on Celo to the Pexa address).
- **Payment format** (verified against the live gateway): x402 v1, scheme `exact`, network `celo`,
  header `X-PAYMENT`; the payment is one USDC EIP-3009 `transferWithAuthorization`. The gateway pays gas.
- **Two ways a purchase is approved.** Default: the agent shows an Approve card with the exact price and
  the user signs once in the browser. Optional: **Autonomous buying** (Buy page toggle) lets Pexa
  sign small purchases itself — it needs `PRIVY_AUTHORIZATION_KEY` + the user's delegated-actions consent,
  and is capped by the user's per-purchase limit and daily budget.
- **Hard limits (code, not config):** $5 per purchase; only the marketplace's own hosts; the payee
  address is pinned to the one the catalog publishes; USDC only; authorization valid ≤10 minutes.
- **Never retried:** Buy payments are irreversible and a 5xx may mean the payment settled, so those
  purchases are marked "Needs checking" and are never re-sent automatically.
- **Vercel:** the agent chat and `/api/buy/pay` use `maxDuration = 300` (compute purchases can take minutes).
  This needs a plan that allows long functions (Pro).
- **Try it:** fund the Pexa wallet with a few cents of USDC on Celo, open **Buy**, tap "Research Reddit".
