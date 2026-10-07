import type { NextConfig } from "next";

/**
 * Browser security headers for every page and API response.
 *
 * - frame-ancestors / X-Frame-Options: nobody else's site may embed Pexa in a frame. Without this an
 *   attacker could load the app invisibly under their own page and trick a signed-in user into clicking
 *   Confirm/Approve ("clickjacking"). Pexa itself embeds Privy's wallet frames — that's the other direction
 *   and is unaffected.
 * - nosniff: browsers must not guess a file's type (stops uploaded/echoed text being run as script).
 * - Referrer-Policy: other sites only see our origin, never the full URL (which can carry a referral code).
 * - Permissions-Policy: the app never needs the camera, microphone or location.
 * - base-uri / object-src: closes two classic injection routes without restricting scripts.
 *
 * A full script-source CSP is deliberately not set here: the wallet SDK loads frames, workers and
 * connections from several hosts, and a wrong policy would lock people out of their money. See SECURITY.md.
 * HSTS is already sent by Vercel.
 */
const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
