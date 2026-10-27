# Changelog

What changed, newest first. Each entry says what it does, where it lives, and whether it has been proven with real money.

## 2026-10-27 — Reading a shop page in a browser rented from Buy

- **When a pasted product link can't be read the plain way** (the shop builds its page in the browser, or turns away automated visits), Pexa now offers **"Read it in a browser (about $0.004)"**. It is the same plan → one approve → your wallet signs path as the other Buy research: a plan card, then Buy's `browser.sessions.create` (2 minutes, about four thousandths of a dollar, cap $0.02).
- **What the browser does:** opens the page, reads the title, the first heading, the page's price label (trying `[itemprop=price]`, `.price` and similar) and the page text, then **closes the session**. It never clicks, signs in, fills in a form or buys. The page's words are data: only a name, a price and an "in stock / out of stock" phrase are taken from them, by fixed rules, and nothing the page says reaches the model. A page with no visible price says so; several prices means "the first one, check it".
- **Safety:** the session addresses must be Buy's own and belong to that one session; the link must pass the same public-internet check as before (a private address is refused, nothing is rented); a redirect to another shop is reported; the result is saved with the shopping-list item like any other page, and the card shows what the browser cost.
- Learned from the Celo Sepolia test lane (random throwaway key, faucet USDC): `get` needs `kind` (`url`, `title`, `text`) and, for text, a `target` CSS selector; `snapshot` lists only interactive elements; closing is `DELETE` on the session's `statusUrl`. A real sandbox session read a demo shop page correctly end to end.
- Also fixed: an amount like "1,200,000" was read as 1.2 by the product-page price reader (a comma is now a decimal point only when it is the single comma with one or two digits after it).
- Code: `src/lib/shopping/browser.ts` (pure), `browser-run.ts` (network), `src/lib/research/page.ts`, research kind `page` in the engine. **Not yet proven with real mainnet money** — only the test lane.

## 2026-10-27 — The shopping list

- **"I want to buy a MacBook Air"** (or "add an iPhone 15 to my shopping list") puts it on a list with what you'd pay and where. **"Find the best options"** searches sellers on Instagram and TikTok through Buy (a few cents, approved once), rates how trustworthy each looks, estimates prices and shows who is closest. The best options are saved, dated, on the item; when you refresh, Pexa says what changed (a new top option, a price that moved 10% or more, a former top option that vanished).
- **The web:** paste a product link and Pexa reads the name and price from the page (the standard product data shops publish) and labels the seller by its domain: official brand store, major retailer, or unverified web store. It never says a page is safe, and a page with no readable price says so instead of guessing. Pages are opened only if they are on the public internet: private and local addresses, odd ports, embedded passwords and tricky number forms are refused, every redirect is re-checked, and pages are size- and time-limited.
- **Payment is a separate step you confirm.** "Pay (you confirm)" on an option explains the risks (a crypto payment can't be reversed, start with a small test payment, get the price and delivery in writing, pay only to the address they gave you), then the normal Confirm card does the rest. Pexa never pays a seller by itself and says escrow isn't available yet.
- New table `shopping_items` and a link from research sessions to items (migration `0029`). Live evals cover adding, listing, researching, asking for a link, refusing a private address, reading a real shop page, the payment step and removing.
- **Not built:** escrow (it would be a real smart contract holding people's money, which needs a deliberate decision, an audit and a cap), automatic price re-checks (they cost Buy purchases, so they are the person's tap), and reading prices from sites that hide them behind scripts.

## 2026-10-22 — Fixes from real use: the failed Aave deposit and the agent misreading the person

Found by reading the saved chat, the deposit record and the chain:

- **The first Aave deposit failed after the approval had already gone through.** Pexa re-read the allowance right after the approval was mined and a lagging node returned the old value, so it said "the approval doesn't cover this deposit" while the chain showed an approval of exactly the right amount. Pexa now trusts the approval's own receipt (its Approval log) and only falls back to reading the allowance, retried a few times. The same latent bug was fixed for conversions. A retry now skips the approval, which is already in place.
- **Answers to button questions were being missed.** A question with buttons is two entries in what the agent sees (the question, then a note that buttons were shown), and every flow only looked at the entry just before your reply. So tapping USDT, or answering the risk question, wasn't recognised: the questions were asked again and a plain X search was bought instead of the stock research. All flows now read the whole run of assistant messages before your reply, and the original request is found across the questions, notes and answers (`src/lib/agent/history.ts`, `original-request.ts`).
- **"I want to stake my USDC, I need the best APY" jumped straight to "how much do you want to deposit into Aave?"** A deposit or withdrawal now needs Aave to be named, and a question about Aave ("is it only with Aave I can invest?") is answered, not treated as an instruction. Asking where to earn goes to research.
- **"Watch them" works:** "watch them", "track all the stocks you just suggested" resolves to the tickers in the stock research just shown.
- **The live evals now use the real shape of the chat history** (question, buttons note, answer). The earlier ones used a hand-built shape that hid the bug, and include the exact phrases that went wrong.

## 2026-10-21 — Watching stocks

- **Watch a stock** with the Watch button on a stock card, or say "watch $NVDA" (a cashtag, or a symbol next to the word "stock"). Pexa saves it with its real price and how much talk there is, and moves no money. A made-up symbol is refused; "stop watching $AMD" and "show my watchlist" work too, and the watchlist card now shows pools and stocks together.
- **Price alerts are free and automatic:** the price is checked when the person opens the app (or their notifications) and once a day; a move of 10% or more since the last message becomes an alert in the bell, at most once a day per kind. The alert states the facts (the old price, the new price, the three-month move) and says plainly that a stock that ran up can fall back.
- **The talk costs money, so it is the person's tap.** "Refresh the talk" plans a tiny Buy search (two on X, one on Reddit, about a cent and a half) that the person approves; it then counts how many different people are talking about that one stock, shows it next to the price, and compares with last time ("15 people talking, up from 4"). A big rise or fade also goes to the bell. Pexa never claims to be watching the talk continuously: that would need automatic signing for purchases, which is not set up.
- New tables `ticker_watches` and `ticker_alerts` (migration `0028`, applied); cron tick has a `tickers` step. Live evals cover watching, refreshing, stopping, and a made-up symbol.

## 2026-10-21 — Getting to know the investor, and stock research

- **Pexa gets to know you first.** The first time someone asks about investing or where to earn, Pexa asks three quick questions with buttons: how they feel about risk, when they might need the money, and roughly how much they could put in. It is asked once, can be skipped, and carries on with what they originally asked. "Reset my investing profile" starts over; "what do you know about me" reflects it back. The answers shape what is shown: pools riskier than the person's comfort (and, for a cautious person, small pools) are hidden, with a note saying how many and how to see them. New table `investor_profiles` (migration `0027`); `src/lib/profile/investor.ts`.
- **Stock research through Buy.** "Find me the stocks that are going viral" plans a small budget (about $0.02, never more than $0.10) that the person approves once: two X searches and two Reddit searches. Tickers that several different people mention are ranked; copy-pasted promotion and tiny accounts are marked down, and posts that are just a list of tickers are ignored. Each ticker is then checked against real price history from Yahoo Finance's public data (a symbol it doesn't know is left out and named). The card shows who is talking and how much, what the price did over a week, a month and three months, how bumpy it is, and plain-words flags such as "lots of talk but the price is down", "already up 55% this month" or "most posts are copies of each other", plus one line on how it sits with the person's profile. It never says buy, sell or safe.
- **Pexa can't trade stocks, and says so.** Asking it to buy or sell a stock gets an honest explanation (no stocks on Celo, not a broker) and an offer to research instead.
- Reddit search added to the research allow-list; the same plan, approve, run flow and spend limits as vendor research. Live evals cover the whole question flow; eval files now run one at a time (they raced on the shared account).
- **Not yet proven with a real run:** Buy's Reddit reply shape (the reader is tolerant but unverified) and how well the X operator queries find good posts. Stock traction watching is not built.

## 2026-10-21 — Real stages, and answering the coin the person actually named

- **The orb now shows what Pexa is really doing, not a timer.** The server reports each thing it starts while a turn runs (a model call, a lookup, a step in a flow) and the browser shows it live: thinking while the model reads the question, searching while it reads pool data or the chain, walking through steps for flows like a deposit or a saved watch, solving while it writes the answer from what it found. A plain greeting only ever thinks. `/api/agent/chat` streams these as it goes (`src/lib/agent/stage.ts`, `runAgentTurn(…, { onStage })`); a live check (`evals/stages.eval.ts`) asserts the order for a lookup question, a flow the app handles itself, and a greeting.
- **Fixed: asked about USDC, got USDT.** The yield answer is now about the coin the person named (`src/lib/yield/coin.ts`; "Celo" is never mistaken for a coin). If another coin pays notably more, Pexa says so openly with the steady versus temporary split, shows what the person holds, and offers "Convert USDC to USDT first" — the person decides. A deposit bigger than the coin held, but covered by the other coin Aave takes, now offers "Deposit USDC instead" or "Convert USDC to USDT first" instead of just refusing. Minimum to start and "add funds first" are said when relevant.

## 2026-10-21 — Thinking orb, and Buy in the investment flow

- **The thinking orb replaces the spinner and the typing dots** (`thinking-orbs`, MIT, no dependencies). Pexa goes through four stages: thinking (calm ring), searching (dotted globe), walking (scattered dots on the move) and solving (converging sphere). It follows the light and dark themes by itself and holds still for reduced-motion users (`src/components/pexa/AgentOrb.tsx`, `src/lib/agent/stage.ts`).
- **Research runs use the real steps:** "Searching…" shows the searching stage, "Checking @x" the walking stage, and a "Reading what came back" beat between purchases the solving stage. **Chat turns use time**: the server does not stream progress yet, so the stage follows how long the wait has lasted and the labels stay generic ("Looking things up…").
- Swap, deposit, Buy-payment, bridge and research cards use the small orb in place of their old spinner.
- **Buy and yields:** the Buy catalog (168 services) has no DeFi, yield, price or on-chain data service, so pool numbers come from DefiLlama and Aave's own contracts. Buy's role in the investment flow is a **"Check what people say"** button on every pool and watchlist item: it searches X and Reddit through Buy for recent hack, exploit, depeg or withdrawal chatter about the protocol, a few cents from the person's own wallet after they approve each quote. The agent reports only what the posts say, never "safe" or "unsafe". Live eval case added.
- The installed orb library (0.3.2) uses a `theme` prop and reads `data-theme` itself; the `dark` prop in the pasted docs does not exist in this version.

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
