# Pexa security notes

What protects a money app, what was found and fixed, and what is knowingly left open.
Last full review: 2026-10-07.

## How money is protected

| Layer | What it does | Where |
|---|---|---|
| Sign-in | Every protected route verifies a Privy token server-side; the user is never taken from the request body. | `lib/http.ts` `withUser` |
| Confirm before money moves | The AI never sends money. It prepares; the user's tap on Confirm does. Typed "yes" is refused. | `lib/agent/runtime.ts`, `send-intent.ts` |
| Payment is real only if the chain says so | A payment is CONFIRMED only when its transaction contains a USDC `Transfer` from the sender to the recipient for the exact amount. A client-supplied hash is never trusted. | `lib/payments/verify.ts`, `engine.ts` |
| One transaction, one payment | A tx hash can settle only one payment (app check + unique DB index). | `engine.ts` `recordBroadcast`, migration 0018 |
| Requests can't be marked paid by claim | A request is settled only by a matching real payment (payer, recipient, amount, token, status). | `lib/requests/fulfil.ts` |
| Gasless relayer | Only relays a payment the user already authorized; re-checks from/to/value against OUR record. | `api/payments/[id]/relay` |
| Buy purchases | Host allowlist, payee pinned to the catalog's, exact amount/resource, $5 hard cap, atomic claim, never auto-retried. | `lib/buy/*` |
| Cross-site forgery | A cookie-authenticated write must come from our own site. | `lib/security/csrf.ts` |
| Browser hardening | No framing (clickjacking), nosniff, referrer and permission policies. HSTS comes from Vercel. | `next.config.ts` |
| Abuse limits | Per-user / per-IP limits on chat, execute, pay, relay, previews, lookups, image generation, MCP. In-memory, per instance. | `lib/security/ratelimit.ts` |
| Secrets | Cron/admin secrets compared in constant time; no secret → endpoint disabled. MCP tokens: 192-bit random, only the hash is stored. | `lib/security/secret.ts`, `lib/mcp/tokens.ts` |
| Prompt injection | Text inside purchased results is data, never instructions; money still needs a tap or sits under user limits. | agent system prompt |

## Fixed in the 2026-10-07 review

1. **Fake payment confirmations (critical).** A user could attach any successful transaction hash to a payment and have it shown as "Completed" to the recipient, and trigger the recipient's automations. Now verified from the transaction's event log. Existing mainnet payments were re-verified: all genuine.
2. **Requests could be marked PAID with no payment (high).** Now requires a matching, real payment.
3. **Next.js RCE in `next/og` (critical, CVE range 16.2.0–16.3.5).** Upgraded to 16.3.8. The public `/api/og/waitlist` route uses it.
4. **`/api/rpc` was an open, unauthenticated proxy to the paid RPC (high).** It was unused; deleted.
5. **No clickjacking protection / security headers (medium).** Added.
6. **Cross-site request forgery via the cookie fallback (medium).** Added origin check.
7. **Secrets compared with `===` (low).** Constant-time compare.
8. **No rate limits on costly endpoints (medium).** Added.
9. **Activity/recents showed oldest payments and unsent drafts** (correctness; hid real activity).

## Knowingly left open (accepted)

- **`ws` advisory (npm audit "high").** Inside the browser wallet-connection libraries bundled by Privy; a fix needs a major `@privy-io/react-auth` upgrade. Not reachable from our server code. Revisit when upgrading Privy.
- **Rate limits are per server instance.** They stop scripts and retry loops, not a distributed attack. Add Vercel Firewall rules if abuse appears.
- **No full script-source CSP.** The wallet SDK loads frames/workers/sockets from several hosts; a wrong policy would lock people out. Try `Content-Security-Policy-Report-Only` first.
- **Wallet pin fallback.** If Privy hasn't returned a wallet yet, `POST /api/wallet` pins the browser-supplied address once. It only affects that user's own account (spending still needs their signature).
- **Waitlist form reveals whether an email is on the list** (product choice; rate-limited, returns no personal data).
- **`/api/waitlist/export?key=`** accepts the admin secret in the URL for convenience; it can land in logs. Prefer the `Authorization: Bearer` header.
- **Four September test payments** (Celo Sepolia testnet) can't be re-verified on-chain; no mainnet funds involved.

## Operating checklist

- Keep `.env` out of git (it is). Rotate any secret that was ever pasted into chat or a screenshot.
- `RELAYER_PRIVATE_KEY` should hold only a small CELO float; top up rather than overfund.
- Run `npm audit --omit=dev` monthly and after upgrading `next`, `viem`, `@privy-io/*`.
- After any change near payments, run the payment tests (`npx vitest run src/lib/payments src/lib/requests`).
