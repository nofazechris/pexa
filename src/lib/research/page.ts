import 'server-only';
import { sessionFrom } from '@/lib/shopping/browser';
import { readPageInBrowser } from '@/lib/shopping/browser-run';
import { SELLER_LABEL, sellerKind } from '@/lib/shopping/page';
import { itemTitle, savePageRead } from '@/lib/shopping/service';
import type { StepState } from './engine';
import type { PageOutcome, ResearchResult } from './types';

/**
 * A page read in a rented browser, second half: the browser was paid for (and the person's wallet signed it); now open the page in it,
 * read the product, close it, and keep the result with the shopping-list item. Whatever happens, the card says what was spent.
 */
export async function fillPage(userId: string, result: ResearchResult, states: readonly StepState[]): Promise<void> {
  const url = result.request.what;
  const title = result.request.itemId ? await itemTitle(userId, result.request.itemId).catch(() => null) : null;
  const paid = states.find((s) => s.role === 'browse' && s.outcome === 'PAID');
  if (!paid) return; // nothing was rented: the summary already says so

  const fail = (note: string, host = ''): void => {
    const out: PageOutcome = { ok: false, url, itemTitle: title, name: null, priceText: null, seller: host, label: '', availability: null, note };
    result.page = out;
    result.summary = `${note} The browser cost ${result.spent}.`;
  };
  const session = sessionFrom(paid.output);
  if (!session) return fail('I rented the browser, but it didn’t give me a session I could use.');

  const read = await readPageInBrowser(session, url);
  if (!read.ok) return fail(read.message);

  const p = read.page;
  const priceText = p.price === null ? null : `${p.currency ?? ''} ${p.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}`.trim();
  const label = SELLER_LABEL[sellerKind(p.seller)];
  let kept = false;
  if (result.request.itemId) kept = Boolean(await savePageRead(userId, result.request.itemId, p, read.how).catch(() => null));
  result.page = { ok: true, url: p.url, itemTitle: title, name: p.name, priceText, seller: p.seller, label, availability: p.availability, note: read.how };
  result.summary = `Read it: ${p.name ?? p.seller}${priceText ? ` — ${priceText}` : ''} on ${p.seller} (${label.toLowerCase()}).${kept && title ? ` It’s saved with your “${title}”.` : ''}`;
  result.notes.push('The browser only looked at the page — nothing was clicked, filled in or bought. Prices on a page can change, so check it again before you pay.');
}
