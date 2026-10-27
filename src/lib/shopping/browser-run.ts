import 'server-only';
import { isAllowedBuyUrl } from '@/lib/buy/x402';
import { checkUrl } from './ssrf';
import { PRICE_TARGETS, getText, getTitle, getUrl, openPage, readLooked, resultOf, sameShop, textOf, type BrowserCommand, type BrowserSession, type CommandResult, type Looked, type PageReading } from './browser';

/**
 * Drives the browser Buy rented for this one page: open it, read what is on it, close it. Every request goes to Buy's own gateway with
 * the session's key; a command that fails is simply "not found", and the session is always closed afterwards (closing early isn't
 * refunded, but it stops anything running on the person's behalf).
 */

const COMMAND_TIMEOUT_MS = 25_000;

async function send(session: BrowserSession, command: BrowserCommand): Promise<CommandResult> {
  if (!isAllowedBuyUrl(session.commandUrl)) return { ok: false, message: 'not Buy’s address' };
  try {
    const res = await fetch(session.commandUrl, {
      method: 'POST',
      redirect: 'manual',
      cache: 'no-store',
      headers: { authorization: `Bearer ${session.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(command),
      signal: AbortSignal.timeout(COMMAND_TIMEOUT_MS),
    });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, message: `the browser answered ${res.status}` };
    return resultOf(body);
  } catch {
    return { ok: false, message: 'the browser didn’t answer' };
  }
}

async function close(session: BrowserSession): Promise<void> {
  if (!isAllowedBuyUrl(session.statusUrl)) return;
  await fetch(session.statusUrl, { method: 'DELETE', redirect: 'manual', headers: { authorization: `Bearer ${session.accessToken}` }, signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
}

/** Open `url` in the rented browser and read the product on it. */
export async function readPageInBrowser(session: BrowserSession, url: string): Promise<PageReading & { opened?: boolean }> {
  const asked = checkUrl(url);
  if (!asked.ok) return { ok: false, message: asked.reason };
  try {
    const opened = await send(session, openPage(asked.url.href));
    if (!opened.ok) return { ok: false, message: `The browser couldn’t open that page (${opened.message}).`, opened: false };

    const urlR = await send(session, getUrl());
    const titleR = await send(session, getTitle());
    const finalUrl = urlR.ok && typeof urlR.data.url === 'string' ? urlR.data.url : asked.url.href;
    const final = checkUrl(finalUrl);
    if (!final.ok) return { ok: false, message: 'The page sent the browser somewhere I won’t read.', opened: true };

    const heading = textOf(await send(session, getText('h1')));
    let priceText: string | null = null;
    for (const target of PRICE_TARGETS) {
      const t = textOf(await send(session, getText(target)));
      if (t && t.length <= 200) {
        priceText = t;
        break;
      }
    }
    const pageText = textOf(await send(session, getText('body')));
    const looked: Looked = { finalUrl: final.url.href, title: titleR.ok && typeof titleR.data.title === 'string' ? titleR.data.title : null, heading: heading && heading.length <= 200 ? heading : null, priceText, pageText };
    const read = readLooked(looked);
    if (read.ok && !sameShop(asked.url.href, final.url.href)) read.how += ` The link redirected to ${final.url.hostname.replace(/^www\./, '')}.`;
    return { ...read, opened: true };
  } finally {
    await close(session);
  }
}
