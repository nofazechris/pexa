# Pexa — an AI financial agent on Celo

**Talk to your money.** Pexa is a chat-first agent that moves and manages dollar stablecoins on **Celo mainnet** — and, through **Buy (Celo's x402 marketplace)**, *spends* them on the user's behalf to answer questions people actually have before they pay: *Is this vendor legit? Who sells this near me? Who can I hire?*

- **Live app:** https://pexaapp.xyz (Celo mainnet, beta)
- **Hackathon tracks:** Celo x402 — **Buy** (marketplace) and **USA₮** (settle real USAT payments)
- **Not a chatbot over a wallet:** the model *proposes*, a deterministic backend *decides*, and the user's own wallet *signs*. Intent is never authorization.

## What Pexa does with Buy (x402)

Pexa is a real Buy *buyer*: every paid lookup is an x402 `transferWithAuthorization` signed by the user's own embedded wallet (headless, gasless) and settled on Celo.

| Feature | What the user sees | Buy services used |
| --- | --- | --- |
| **Check before you pay** | "Is @vendor legit?" → age, activity, follower quality, what people say → plain verdict | `instagram.profile`, `x.posts.search`, `reddit.posts.search` |
| **Find, price and rate vendors / people to hire** | "Find me a sneaker seller in Lagos" or "a graphic designer close to me" → **one** Approve for a stated budget (≈ $0.03, never more than $0.08) → a shortlist **rated out of 5** (trust, fit, nearness, price), each seller's published prices compared with what others charge, an opening offer and a ready-to-send negotiation message, plus location/distance and the phone / WhatsApp / email each account published | Instagram user search + profile, X people search, LinkedIn people search |
| **Ask for anything in the catalog** | "What are people saying about X on Reddit today?" → priced, approved, summarised, receipt saved | any Buy service via search → quote → approve |
| **External agents** | ChatGPT / Claude use Pexa's tools (incl. `buy_*`) over MCP | `/api/mcp` |

**Pexa researches; it never pays the vendor.** The agent spends a few cents of the user's own money on *information* (Buy lookups) so the user can decide — and haggle — before spending their own money elsewhere. Each seller gets a legitimacy score with hard red flags (no posts, a tiny or brand-new page, a bio saying it replaces a disabled account, a name stuffed with search words cap the score), and anything that isn't actually selling the item — a sneaker-*cleaning* service, an unrelated account — is left out and named. Prices are only compared like-for-like (posts that name the item), a "typical price" needs at least three sellers, and every result says plainly that a public profile can't prove delivery.

**Why it is safe to let an agent spend.** The order of operations is the whole design (`src/lib/buy/service.ts`):

1. **Quote** — ask the gateway for the exact price (a free 402) and verify we would pay *only* Buy's published payee, for exactly this resource, in a supported stablecoin, under the hard cap ($5).
2. **Decide** — a pure policy engine answers: pay automatically (opt-in only), ask first, or refuse.
3. **Sign** — the user's wallet signs one EIP-3009 authorization for exactly that price.
4. **Claim** — an atomic `QUOTED → SUBMITTING` update, so one quote can never be paid twice.
5. **Pay & record** — send the payment, classify the reply, record PAID / FAILED / UNCERTAIN. An uncertain payment is **never retried**.

The research budget works inside that: the user approves "up to $0.08" once; the server then picks each next lookup from an **allow-list of five services**, refuses anything over budget or past a purchase limit, and every purchase is still its own payment signed by the user's wallet. Results are treated as untrusted data — never as instructions.

## USA₮ and the dollar stablecoins

- Buy purchases can be paid in **USDC, USDT or USAT** (the user's preference, falling back to a coin they hold); all three are 6-decimal EIP-3009 tokens on Celo.
- **Convert in chat** between USDC ⇄ USDT ⇄ USAT (Uniswap v3 on Celo, 0.5% slippage guard, sanity-checked quotes, gas topped up by the relayer).
- **Send** USDC / USDT / USAT to a `@username` or any Celo wallet address, with external-wallet safety checks.
- **Get paid from other chains** (Arbitrum, Base, Ethereum, Optimism, Polygon, Arc) — USDC sent to a per-chain deposit address arrives as USDC on Celo (via Relay).

## Verify the demand yourself

Every Buy purchase Pexa makes is a public Celo transaction. This command lists them and checks **each one on-chain** (receipt succeeded, and it really moved the stated token, payer → Buy's payee, for the stated amount):

```bash
npm run buy:report -- --verify        # add --csv or --json for a spreadsheet / machine-readable form
```

Snapshot on 2026-10-17: 3 paid purchases, all 3 verified on Celo mainnet, payee `0x20faAca5F980E29639A0FCC6dcA6988E18ed333B`.
Run it for the current numbers — they are read live from the database and the chain, not typed here.

## The agent

A server-side tool-calling agent (`src/lib/agent/runtime.ts`) with ~45 tools shared with the MCP server. Money-moving tools are never run by the model: they return a confirm card, and the person's tap (and signature) executes. Deterministic fast paths handle the basics (statements, deposit checks, bridge addresses, conversions, plain sends) and double as the fallback when the AI provider is down, so the chat never hangs.

Quality is measured, not assumed: ~980 unit tests plus a **live evaluation** that runs real conversations against the real model and database and checks the tool and settings chosen (`npm run agent:eval`, 26 cases). Every misreading we find becomes a case.

## Status — honest

| Area | State |
| --- | --- |
| Buy purchases (X search, LinkedIn search) | **Proven on mainnet**, verified on-chain |
| Check-before-you-pay, vendor/hire research, "near me" | Live; first real LinkedIn search worked end-to-end; Instagram/X paths pending a real run |
| Pay Buy in **USAT** | Implemented (signature verified against the real token contract); first live USAT purchase pending |
| USDC ⇄ USDT ⇄ USAT conversion | Implemented, live Uniswap quotes verified; first live conversion pending |
| Bridge deposit (other chain → Celo) | **Proven** with a real deposit |
| Autonomous buying | Off by default; needs the user to enable agent signing |

## Run it

```bash
npm install
cp .env.example .env     # DATABASE_URL, Privy, AI key, Celo network settings (see DEPLOY.md)
npm run db:migrate
npm run dev              # http://localhost:3000
npm test                 # unit tests
npm run agent:eval       # live agent evaluation (real model + database; costs a few cents)
```

Stack: Next.js 16 · React 19 · TypeScript · Drizzle + Postgres (Supabase) · Privy embedded wallets · viem · OpenAI behind a provider boundary · Vercel. See [`DEPLOY.md`](DEPLOY.md), [`SECURITY.md`](SECURITY.md) and [`PEXA_BRIEF.md`](PEXA_BRIEF.md). The original design-pipeline notes live in [`docs/DESIGN_PIPELINE.md`](docs/DESIGN_PIPELINE.md).

## Where things are

- `src/lib/buy/` — Buy integration: catalog, x402 signing/verification, policy, service, tokens
- `src/lib/research/` — find-a-vendor / hire: readers, scoring, planner, budgeted runner
- `src/lib/agent/` — runtime, intent parsing, resilience, live evals
- `src/lib/swap/`, `src/lib/bridge/` — USAT conversion and cross-chain deposits
- `src/lib/mcp/tools.ts` — the tools the in-app agent and external agents share
- `scripts/buy-report.mjs` — the on-chain verified Buy volume report
