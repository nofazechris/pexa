/**
 * Cross-site request forgery guard.
 *
 * The app's own calls prove who they are with an explicit `Authorization: Bearer` header, which another website
 * cannot attach to a request it makes from a visitor's browser. But the server will also accept the login COOKIE
 * as a fallback — and a browser attaches cookies to requests started by ANY site. So a hostile page could make a
 * signed-in visitor's browser fire a state-changing request (confirm, save, delete…) at us.
 *
 * Rule: a write (anything but GET/HEAD/OPTIONS) that is NOT carrying a bearer header must have come from this
 * same site, as shown by the browser's own `Sec-Fetch-Site` / `Origin` headers, which a page cannot forge.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isCrossSiteWrite(req: Request): boolean {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return false;

  // An explicit bearer header can't be sent cross-site without a CORS preflight, which we never grant.
  const auth = req.headers.get('authorization');
  if (auth && /^bearer\s+\S/i.test(auth)) return false;

  const site = req.headers.get('sec-fetch-site');
  if (site === 'cross-site' || site === 'same-site') return true; // same-site = a sibling subdomain: not us
  if (site === 'same-origin' || site === 'none') return false;

  // No Sec-Fetch-Site (older browsers, non-browser clients): fall back to the Origin header.
  const origin = req.headers.get('origin');
  if (origin) {
    try {
      return new URL(origin).host !== new URL(req.url).host;
    } catch {
      return true; // "null" or malformed origin on a cookie-authenticated write: refuse
    }
  }
  return false; // no browser provenance headers at all: not a browser-driven forgery
}
