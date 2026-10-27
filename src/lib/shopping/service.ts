import 'server-only';
import { and, desc, eq, ne } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import type { ResearchResult } from '@/lib/research/types';
import { fetchProduct } from './fetch';
import { MAX_OPTIONS, diffOptions, optionsFromResult, withWebOption, type OptionSnap } from './options';
import { SELLER_LABEL, SELLER_NOTE, sellerKind } from './page';
import type { ShoppingItemView } from './types';

/**
 * The shopping list: things a person is trying to buy, with the best options Pexa has found for each. Research is run (and paid
 * for through Buy) only when the person asks, so what is saved is a snapshot, dated, and the card says so. Payment is never made
 * here: it is a separate step the person confirms.
 */

export const MAX_ACTIVE_ITEMS = 20;

type Row = typeof schema.shoppingItems.$inferSelect;

const parse = <T,>(s: string, fallback: T): T => {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

function view(r: Row): ShoppingItemView {
  return {
    id: r.id,
    title: r.title,
    targetText: r.targetText,
    place: r.place,
    platforms: r.platforms.split(',').filter(Boolean),
    status: r.status as ShoppingItemView['status'],
    options: parse<OptionSnap[]>(r.optionsJson, []),
    changes: parse<string[]>(r.changesJson, []),
    researchedAt: r.researchedAt ? r.researchedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function listItems(userId: string, status: ShoppingItemView['status'] = 'active'): Promise<ShoppingItemView[]> {
  const rows = await getDb().select().from(schema.shoppingItems).where(and(eq(schema.shoppingItems.userId, userId), eq(schema.shoppingItems.status, status))).orderBy(desc(schema.shoppingItems.updatedAt));
  return rows.map(view);
}

async function activeRows(userId: string): Promise<Row[]> {
  return getDb().select().from(schema.shoppingItems).where(and(eq(schema.shoppingItems.userId, userId), eq(schema.shoppingItems.status, 'active'))).orderBy(desc(schema.shoppingItems.updatedAt));
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** The active item the person means by a few words ("macbook", "the iPhone 15"): exact title first, then one that contains it. */
export async function findItem(userId: string, words: string): Promise<{ item: ShoppingItemView } | { item: null; many: string[] }> {
  const q = norm(words.replace(/^(?:the|my|a|an)\s+/i, ''));
  const rows = await activeRows(userId);
  if (!q) return rows.length === 1 ? { item: view(rows[0]) } : { item: null, many: rows.map((r) => r.title) };
  const exact = rows.filter((r) => norm(r.title) === q);
  if (exact.length === 1) return { item: view(exact[0]) };
  const partial = rows.filter((r) => norm(r.title).includes(q) || q.includes(norm(r.title)));
  if (partial.length === 1) return { item: view(partial[0]) };
  return { item: null, many: (partial.length ? partial : rows).map((r) => r.title) };
}

export async function addItem(userId: string, input: { title: string; targetText: string | null; place: string | null }): Promise<{ ok: true; item: ShoppingItemView; existed: boolean } | { ok: false; message: string }> {
  const title = input.title.trim().slice(0, 80);
  if (title.length < 2) return { ok: false, message: 'What would you like to buy?' };
  const rows = await activeRows(userId);
  const same = rows.find((r) => norm(r.title) === norm(title));
  if (same) {
    if (input.place && !same.place) await getDb().update(schema.shoppingItems).set({ place: input.place, updatedAt: new Date() }).where(eq(schema.shoppingItems.id, same.id));
    return { ok: true, item: view({ ...same, place: same.place || input.place || '' }), existed: true };
  }
  if (rows.length >= MAX_ACTIVE_ITEMS) return { ok: false, message: `Your shopping list has ${MAX_ACTIVE_ITEMS} things on it, which is the most for now. Remove one first.` };
  const [row] = await getDb().insert(schema.shoppingItems).values({ userId, title, targetText: input.targetText, place: input.place ?? '' }).returning();
  return { ok: true, item: view(row), existed: false };
}

export async function setPlace(userId: string, itemId: string, place: string): Promise<void> {
  await getDb().update(schema.shoppingItems).set({ place: place.slice(0, 60), updatedAt: new Date() }).where(and(eq(schema.shoppingItems.id, itemId), eq(schema.shoppingItems.userId, userId)));
}

/** Take an item off the active list: bought it, or no longer wants it. */
export async function closeItem(userId: string, itemId: string, status: 'bought' | 'dropped'): Promise<void> {
  await getDb().update(schema.shoppingItems).set({ status, updatedAt: new Date() }).where(and(eq(schema.shoppingItems.id, itemId), eq(schema.shoppingItems.userId, userId), ne(schema.shoppingItems.status, status)));
}

async function loadOwned(userId: string, itemId: string): Promise<Row | null> {
  if (!/^[0-9a-f-]{36}$/i.test(itemId)) return null;
  const [row] = await getDb().select().from(schema.shoppingItems).where(and(eq(schema.shoppingItems.id, itemId), eq(schema.shoppingItems.userId, userId))).limit(1);
  return row ?? null;
}

/**
 * A research for this item just finished: keep its best options (the web pages the person added are kept too), and work out what
 * changed since last time. Fails soft: saving must never lose the research result itself.
 */
export async function recordResearch(userId: string, itemId: string, result: ResearchResult): Promise<void> {
  const row = await loadOwned(userId, itemId);
  if (!row || row.status !== 'active') return;
  const prev = parse<OptionSnap[]>(row.optionsJson, []);
  const found = optionsFromResult(result, new Date());
  const web = prev.filter((o) => o.source === 'web');
  const rated = found.length ? found : prev.filter((o) => o.source !== 'web');
  const changes = found.length ? diffOptions(prev.filter((o) => o.source !== 'web'), found) : ['This search found no checked sellers, so your earlier options are unchanged.'];
  await getDb()
    .update(schema.shoppingItems)
    .set({ optionsJson: JSON.stringify([...rated.slice(0, MAX_OPTIONS), ...web].slice(0, MAX_OPTIONS + 3)), changesJson: JSON.stringify(changes), researchedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.shoppingItems.id, row.id));
}

/** Read the price on a product page the person pasted, and keep it with the item. */
export async function addLink(userId: string, itemId: string, url: string): Promise<{ ok: true; option: OptionSnap; item: ShoppingItemView } | { ok: false; message: string }> {
  const row = await loadOwned(userId, itemId);
  if (!row || row.status !== 'active') return { ok: false, message: 'I can’t find that item on your list any more.' };
  const got = await fetchProduct(url);
  if (!got.ok) return got;
  const kind = sellerKind(got.page.seller);
  const option: OptionSnap = {
    source: 'web',
    name: got.page.name ?? got.page.seller,
    handle: null,
    url: got.page.url,
    rating: null,
    label: SELLER_LABEL[kind],
    distanceKm: null,
    price: got.page.price === null ? null : { text: `${got.page.currency ?? ''} ${got.page.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}`.trim(), median: got.page.price, currency: got.page.currency ?? '' },
    phone: null,
    whatsapp: null,
    note: `${got.page.seller}: ${SELLER_NOTE[kind]}${got.page.availability ? ` (${got.page.availability})` : ''}`,
    checkedAt: new Date().toISOString(),
  };
  const prev = parse<OptionSnap[]>(row.optionsJson, []);
  const next = withWebOption(prev, option);
  const [updated] = await getDb().update(schema.shoppingItems).set({ optionsJson: JSON.stringify(next), updatedAt: new Date() }).where(eq(schema.shoppingItems.id, row.id)).returning();
  return { ok: true, option, item: view(updated) };
}
