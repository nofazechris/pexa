# Pexa × Buy — Track 3 write-up

**One line:** Pexa is a chat-first money agent on Celo. With Buy, the same agent can now go and *buy*
things — live Reddit/X data, a headless browser, a cloud VM — and pay for them itself, inside limits the
user sets.

## The problem
Peer-to-peer payments are irreversible, and a lot of them go to strangers found on Instagram, TikTok or X — where scams are routine. Pexa's answer: **check before you pay.** Before money moves, the agent buys a vendor's public profile and what people say about them (Reddit, X) for ~2¢ and returns a plain-language verdict, then suggests a small test payment first.

More generally, Agents can reason, but they can't safely spend. Handing an agent a card is reckless; making a human
approve every $0.01 API call defeats the point. People want to say "what is Reddit saying about Celo
today?" and get an answer — paid for, receipted, and capped.

## What we built (integration depth)
- **Full x402 client for Buy**, written against the real gateway: catalog discovery, exact quote via the
  402 challenge, USDC EIP-3009 authorization signed by the user's Privy wallet, `X-PAYMENT` submission,
  receipt + Celoscan link, and async result polling for compute jobs.
- **Agent tools** (`buy_search_catalog`, `buy_get_service`, `buy_purchase`, `buy_get_purchase`,
  `buy_poll_result`, `buy_list_purchases`, `buy_get_spending`) shared by the in-app chat agent *and* the
  MCP server — so any MCP client can use Pexa's wallet to shop on Buy.
- **A real spending policy**: autonomy off by default; per-purchase limit; daily budget; hard $5 cap;
  anything over limit becomes an Approve card with the exact price.
- **Search that works on the real catalog (168 listings):** curated first-party listings are preferred over near-duplicate third-party scrapers, flat and tiered prices are both read (so nothing shows as free), and trust questions ("is this legit?") are routed to the community sources. Results are pruned before the agent reads them (media links and tracking noise dropped, lists shortened) so answers are about the content, not the JSON.
- **Safety by construction:** the model never sees a URL or an address — it names a catalog item and the
  server resolves it; payee pinned to the catalog's; atomic claim so a purchase can't be paid twice;
  never auto-retry an irreversible payment; every outcome recorded (`PAID` / `UNCERTAIN` / `FAILED`).
- **UI:** Approve & result cards in chat, and a Buy page with spending limits and receipts.
- 61 dedicated tests (real captured 402 challenge, real signature sign/verify, hostile catalog entries).

## Demand it creates for Buy
Every Pexa user's wallet becomes a Buy customer, and the agent *generates* purchases: each question
that needs fresh data or compute is a paid call. Because it is exposed over MCP, other agents and
clients route their spend through Buy as well. Small, frequent, autonomous purchases are exactly the
usage x402 exists for.

## Demo script
1. Fund the Pexa wallet with ~$1 USDC on Celo. 2. Chat: "What is Reddit saying about Celo today?"
3. Agent finds the service, states the price, shows Approve → one tap → answer + receipt.
4. Buy page → turn on Autonomous buying ($0.10 limit) → ask again → bought with no prompt, receipt appears.
5. Ask something costing more than the limit → it asks first.

---

# Track 2b — USA₮ over x402 (same integration)

Pexa pays Buy's x402 invoices in **USA₮ (Tether America USD, issued by Anchorage)** as well as USDC and USDT.
The user picks the token on the Buy page; if it's empty or a service doesn't take it, Pexa falls back to one
the wallet holds and always shows which token a purchase will use.

- **Real USA₮ settlement:** the Buy gateway offers USDC, USDT and USA₮ on every purchase. Pexa signs an
  EIP-3009 `transferWithAuthorization` under USA₮'s own EIP-712 domain ("Tether America USD", v1,
  `0xD2ab…F771` on Celo) and sends it as `X-PAYMENT`; the gateway's facilitator settles it on Celo.
- **Verified, not assumed:** for all three tokens, the signing domain we compute equals the token
  contract's on-chain `DOMAIN_SEPARATOR()`.
- **Safety unchanged per token:** payee pinned to the catalog's, exact resource and amount, hard $5 cap,
  window ≤10 min, atomic claim, never auto-retry; plus a pre-claim check that the authorization matches the
  stored quote byte for byte (token, domain, payee, amount, payer).

**To demo:** hold a little USA₮ on Celo in the Pexa wallet → Buy → Pay with USAT → ask "What is Reddit saying
about Celo?" → Approve → the receipt shows `USAT` and the Celoscan transfer of USA₮.

## Tracks we're not entering (and why)
- **Track 1 (LatAm wFIAT):** wARS/wMXN/wBRL exist on Celo but have no gasless EIP-3009 transfer, we have no
  way to source them without a Textile API key, and no LatAm users — a weak entry we'd rather not make.
- **Track 2a (Textile FX):** judged on quoted volume/profit; needs capital and an API key.
