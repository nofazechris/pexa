# Changelog

What changed, newest first. Each entry says what it does, where it lives, and whether it has been proven with real money.

## 2026-10-21 — Yield watchlist and alerts

- **Watch a pool** instead of (or before) depositing: a "Watch" button on every pool in the yield card, or say "watch the Aave USDT pool on Celo and tell me when it hits 3%". The app reads watch/stop/show requests itself (`src/lib/yield/watch-intent.ts`), saves the pool with its current numbers, and moves no money. "Show my watchlist" gives a card with how each pool has changed since it was added, plus Deposit and Stop watching buttons.
- **Alerts in the notification bell** when something that matters changes (`src/lib/yield/watch.ts`): what a pool pays steadily moves a lot, temporary rewards end or start, the money in the pool falls sharply, it reaches the rate the person asked for, or it vanishes from the data. At most one alert per kind per pool per day; each alert is measured against the last values the person was told about.
- **When it checks:** whenever the person opens the app or their notifications (skips pools checked in the last 25 minutes), and on the daily cron tick (new `watch` step). Pexa never promises instant alerts. In-app only; no push or email yet.
- New tables `yield_watches` and `watch_alerts` (migration `0026`, applied); API route `/api/watch`; tools `watch_pool`, `unwatch_pool`, `get_watchlist`.
- **Fixed on the way:** the cheap default model chose the wrong tool for "watch X and tell me if it changes" (now read deterministically); "add … Aave USDC … to my watchlist" was read as a deposit (the earn parser no longer treats "add" or any watch/track/alert wording as a deposit); a watchlist card can no longer pre-empt a watch that was asked for in the same turn.
- No stocks: there are none on Celo and recommending them is broker territory; Pexa says so if asked.

## 2026-10-21 — Aave deposit and withdrawal on Celo (built, tried on dev first)

- **Deposit USDT or USDC into Aave v3 on Celo, and withdraw** (`src/lib/earn/*`, `/api/earn/[id]`, `useEarn.ts`, `EarnCards.tsx`). Read by the app itself ("deposit $10 USDT into Aave", the "Deposit USDT into Aave" button on a yield card, "withdraw everything from Aave"); a Confirm card states what Aave pays (and how much of any headline is temporary rewards) and the risk; the person's own wallet signs; Pexa covers the network fee.
- **Safety:** the browser only signs an approve of the coin to the Aave pool, a deposit credited to the person's OWN address, or a withdrawal sent to their OWN address (`isExpectedEarnTx`). The server re-reads the market (active, not frozen, not paused, under the supply cap, enough liquidity) at prepare time, checks the transaction on-chain at finalize, and reports what the chain says moved. Beta limits $0.10–$25 per deposit.
- **Tagged:** the approve, supply and withdraw calldata carry the attribution tag. Verified by simulation that tagged and untagged calls behave identically against the real pool.
- `get_earn_position` tool: balance in Aave (incl. interest), net deposited through Pexa, interest earned, current rate.
- New table `earn_actions` (migration `0025`, applied). Live eval cases for the coin question, USAT refusal, withdrawal and "can't buy stocks".
- **Unproven until a real deposit is signed:** Privy `sendTransaction` → Aave `supply` on Celo, withdraw-everything, and the tag on-chain.

## 2026-10-21 — Yield research (read-only)

- **`research_yields` agent tool and card** (`src/lib/yield/*`, `src/components/pexa/YieldCards.tsx`): where money can earn on Celo or any chain, from DefiLlama's free public data. Ranks by what a pool pays steadily (base interest or fees, plus 40% of rewards), never the headline rate; splits "pays steadily" from "temporary rewards"; flags small pools, reward-heavy rates, spikes, impermanent loss, non-stable assets, outliers and unusually high stablecoin rates. Never says "safe". Other chains are research only. The agent states no rates itself (the card carries every number); three live eval cases enforce that.
- **Found in a visual check with real data:** the source marks Celo's Aave USD₮ as "not a stablecoin" (now detected by symbol) and marks the big Aave pools as statistical outliers (now kept, flagged). A 27% stablecoin pool no longer reads "lower risk".
- **Verified on-chain (for the next step):** Aave v3 on Celo, Pool `0x3E59A31363E2ad014dcbc521c4a0d5757d9f3402`. USDT and USDC are active reserves; USAT is not a reserve, so it cannot be deposited there.
- Not built yet: the Aave deposit, the thinking-orb UI.

## 2026-10-18 — Celo hackathon requirements, swap tagging, USAT offer (`e8bd630`)

- **Swap and approval calldata carry the ERC-8021 tag** (`src/lib/relayer/tag.ts`, `src/lib/swap/service.ts`). Verified by simulation against the real router and the USDC/USDT/USAT contracts (same result tagged and untagged). **Unproven on a live swap** until one real conversion is made; check it with `npm run agent:tag -- verify 0xTX`.
- **USAT offer after a deposit** (`src/lib/swap/offer.ts`, `src/lib/agent/runtime.ts`): when "check" finds a fresh USDC deposit ($0.10–$250) the agent shows "Turn $X into USAT" / "Keep it as USDC". The convert button is an ordinary conversion request, so the quote card and Confirm still apply. Not automatic: that would need delegated signing.
- **Bridge reply** now says Pexa will offer USAT when the deposit lands.
- **Chat history note** for choice buttons lists the real options (`src/lib/conversations/describe.ts`).

## 2026-10-18 — Agent wallet, tag and ERC-8004 identity (`51e0033`, `6afae50`)

- **Agent wallet = the relayer** `0x4F8a2a0f36E11F9064595c792d28ce48F87a6D9a`. Enter this one at submission and keep it for the whole event.
- **Every relayer transaction is tagged** `celo_958bdac0d45b` (env `CELO_ATTRIBUTION_TAG`, set in `.env` and Vercel; `src/lib/relayer/tagged.ts`, `src/lib/relayer/service.ts`). Tests decode the tag back out of a transaction with `verifyTx`.
- **ERC-8004 identity registered**: agentId **9974**, tx `0x1123b97b4f50f1ea397f04738bf8f06937174db138b8791896bd1b21c3089770` (tagged and verified on-chain). Identity file: `public/agent-registration.json`.
- **`npm run agent:tag`** — `status`, `verify 0xTX`, `register [--send]` (`scripts/agent-tag.mjs`).
- **Not tagged by design:** Buy payments (the user's wallet signs, Buy's gateway settles). Open question for the organisers: do x402 payments to Buy count, and under which address.

## 2026-10-18 — Research quality (`bc5f15d`)

- **Widen-search buttons** (`src/lib/research/expand.ts`): a bigger radius when sellers were left out as too far, or other platforms when fewer than 3 sellers turned up. Never automatic.
- **Quality report** `npm run research:metrics` (`src/lib/research/metrics.ts`, `metrics.test.ts`): precision@5, recall, duplicates, results beyond the radius, unsupported "Established" labels, leaked results, paid calls and cost, per scenario, with floors the tests enforce.

## 2026-10-18 — PRD-inspired research upgrade (`55af50a`–`d6f5c87`)

- **What matters most**: `priority` (balanced / closest / cheapest / trusted) shifts the rating weights (`src/lib/research/rate.ts`).
- **Distance limit**: `radiusKm` is a hard filter once a straight-line distance is measured; sellers whose distance couldn't be measured stay, with a note. New columns `research_sessions.priority` and `radius_km` (migration `0024`, applied to production).
- **Same business on several platforms** merged by phone, WhatsApp, email or own-website host, never by name (`src/lib/research/dedupe.ts`).
- **Profile text is data**: names are sanitized before the model sees them (`src/lib/research/safe.ts`, `src/lib/conversations/describe.ts`).
- **Reuse of a person's own recent paid lookups** at no cost (profiles 12 h, searches 6 h, X timelines 3 h; `freshForMs`, `StepRef.cached`). Never shared across users.
- Agent prompt teaches priority, radius and untrusted profile text.

## Not built / deliberately skipped

- Cross-user cache of paid Buy results — fewer Buy purchases works against the Track 3 goal, and the data isn't ours to hand to other users.
- Fully automatic deposit → USAT conversion — needs delegated signing (`PRIVY_AUTHORIZATION_KEY`).
- Repeated agent-wallet transactions or purchases made only to raise counts.

## Still unproven with real funds

A tagged live swap, a USAT-paid Buy purchase, USDC → USAT conversion end to end, USDT/MetaMask send, TikTok and X-timeline response shapes, "Use my location" on a real phone.
