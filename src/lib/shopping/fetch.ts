import 'server-only';
import { lookup } from 'node:dns/promises';
import { readProductPage, type ProductPage } from './page';
import { checkUrl, isPublicIp } from './ssrf';

/**
 * Opens a web page a person pointed us at and reads its product price — carefully. The server only ever talks to the public
 * internet: the address is checked before the request and again for every redirect, every IP the name resolves to must be public,
 * the page is size- and time-limited, and only HTML is read. (A hostile DNS server could in principle change its answer between our
 * check and the connection; the exposure is a read-only fetch whose result is shown only to the person who asked.)
 */

const MAX_BYTES = 1_500_000;
const MAX_HOPS = 3;
const TIMEOUT_MS = 8_000;

async function readLimited(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks));
}

async function open(url: URL, hop: number): Promise<{ html: string; finalUrl: string }> {
  const check = checkUrl(url.href);
  if (!check.ok) throw new Error(check.reason);
  const addrs = await lookup(check.url.hostname, { all: true });
  if (!addrs.length || addrs.some((a) => !isPublicIp(a.address))) throw new Error('That address isn’t on the public internet, so I won’t open it.');
  const res = await fetch(check.url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; PexaBot/0.1; +https://pexaapp.xyz)', accept: 'text/html,application/xhtml+xml' },
  });
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get('location');
    if (!loc || hop >= MAX_HOPS) throw new Error('That page sent me around in circles.');
    return open(new URL(loc, check.url), hop + 1);
  }
  if (!res.ok) throw new Error(`That page answered with an error (${res.status}).`);
  const type = res.headers.get('content-type') ?? '';
  if (!/text\/html|application\/xhtml/i.test(type)) throw new Error('That link isn’t a web page I can read.');
  return { html: await readLimited(res), finalUrl: check.url.href };
}

/** `browsable`: a rented browser might do better (a shop that builds its page in the browser, or blocks plain visits) — never true for an address that was refused. */
export type FetchProduct = { ok: true; page: ProductPage } | { ok: false; message: string; browsable: boolean };

/** Read the product on a web page: its name and price (never a guess: a page with no price says so). */
export async function fetchProduct(rawUrl: string): Promise<FetchProduct> {
  const first = checkUrl(rawUrl);
  if (!first.ok) return { ok: false, message: first.reason, browsable: false };
  try {
    const { html, finalUrl } = await open(first.url, 0);
    const page = readProductPage(html, finalUrl);
    if (!page) return { ok: false, message: 'I couldn’t find a product on that page.', browsable: true };
    if (page.price === null) return { ok: false, message: `I opened the page${page.name ? ` (“${page.name.slice(0, 60)}”)` : ''} but it doesn’t show a price I can read. Many shops only show prices after you pick a size or colour. Open the exact product and paste that link.`, browsable: true };
    return { ok: true, page };
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    // Our own plain-words messages pass through; anything technical becomes a plain one.
    const refused = /isn.t on the public internet|isn.t a web page/.test(msg);
    return { ok: false, message: /^(That|I )/.test(msg) ? msg : 'I couldn’t open that page just now. It may block automated visits, or be slow.', browsable: !refused };
  }
}
