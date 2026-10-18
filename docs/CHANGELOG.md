# Changelog

What changed, newest first. Each entry says what it does, where it lives, and whether it has been proven with real money.

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
