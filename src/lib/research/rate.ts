/**
 * Rating and negotiating. A rating is four plain parts — does it look real (trust), does it match what was asked (fit), how close
 * (nearby), how the prices compare (price) — averaged with fixed weights, skipping any part we don't know rather than guessing it.
 * The same facts then feed a negotiation tip: what others typically charge, how this seller compares, and a sensible first offer.
 *
 * It only ever helps a person decide and haggle. Nothing here moves money, and every number is something a seller published or a
 * distance we measured.
 *
 * Pure.
 */
import { money, niceAmount, rangeText, summarize, versus, type Currency, type PriceSummary } from './price';
import type { ItemPrices, MarketPrice, Negotiation, Rating, ResearchItem, ResearchKind, Signal } from './types';

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(n)));

/** From the good and worrying facts on a card: 55 to start, +12 per good fact, −20 per worry. */
export function trustScore(signals: readonly Signal[]): number {
  const goods = signals.filter((s) => s.tone === 'good').length;
  const warns = signals.filter((s) => s.tone === 'warn').length;
  return clamp(55 + 12 * goods - 20 * warns, 5, 98);
}

/** How much of what was asked for shows up: no matching word → 35, all of them → 100. Null when nothing specific was asked. */
export function fitScore(hits: number, wanted: number): number | null {
  if (wanted <= 0) return null;
  return clamp(35 + 65 * Math.min(1, hits / wanted));
}

export function nearbyScore(item: Pick<ResearchItem, 'distanceKm' | 'nearness'>): number | null {
  if (item.distanceKm !== null) {
    const d = item.distanceKm;
    return d < 2 ? 98 : d < 5 ? 92 : d < 10 ? 85 : d < 20 ? 75 : d < 40 ? 60 : d < 100 ? 40 : 20;
  }
  return { area: 95, city: 70, other: 20, unknown: null }[item.nearness];
}

/** Cheaper than usual scores well (but "far too cheap" is a flag, not a bargain); well above usual scores badly. */
export function priceScore(v: { kind: 'below' | 'near' | 'above'; percent: number } | null): number | null {
  if (!v) return null;
  if (v.percent < -45) return 50;
  if (v.kind === 'below') return v.percent <= -25 ? 90 : 85;
  if (v.kind === 'near') return 70;
  return v.percent <= 25 ? 50 : v.percent <= 50 ? 35 : 20;
}

const WEIGHTS = { trust: 0.45, fit: 0.25, nearby: 0.2, price: 0.1 } as const;

/** The weighted average of the parts that are known (null when trust is unknown — an unchecked account isn't rated). */
export function overall(parts: Omit<Rating, 'overall'>): number | null {
  if (parts.trust === null) return null;
  let sum = 0;
  let weight = 0;
  for (const k of ['trust', 'fit', 'nearby', 'price'] as const) {
    const v = parts[k];
    if (v !== null) {
      sum += v * WEIGHTS[k];
      weight += WEIGHTS[k];
    }
  }
  return weight ? clamp(sum / weight) : null;
}

/** A first rating from what the scorer knows; nearness and price are filled in when the whole shortlist is rated. */
export function initialRating(trust: number | null, fit: number | null): Rating | null {
  const parts = { trust, fit, nearby: null, price: null };
  const o = overall(parts);
  return o === null ? null : { overall: o, ...parts };
}

/** "4.4" out of 5. */
export const stars = (score: number) => (score / 20).toFixed(1);

export interface RateContext {
  what: string;
  place: string;
  kind: ResearchKind;
}

/** The typical price across sellers: needs comparable prices (for the thing asked about) from at least 3 sellers — 4 prices in all — in one currency. Fewer is not a market. */
export function marketOf(items: readonly ResearchItem[]): { summary: PriceSummary; view: MarketPrice } | null {
  // Only prices for the thing that was asked for count: a seller's slides next to their sneakers say nothing about the sneakers.
  const withPrices = items.filter((i) => i.prices?.matched);
  if (withPrices.length < 3) return null;
  const byCurrency = new Map<string, { amounts: number[]; sellers: number }>();
  for (const i of withPrices) {
    const e = byCurrency.get(i.prices!.currency) ?? { amounts: [], sellers: 0 };
    e.amounts.push(...i.prices!.points);
    e.sellers++;
    byCurrency.set(i.prices!.currency, e);
  }
  const best = [...byCurrency.entries()].sort((a, b) => b[1].amounts.length - a[1].amounts.length)[0];
  if (!best || best[1].amounts.length < 4 || best[1].sellers < 3) return null;
  const summary = summarize(best[1].amounts.map((amount) => ({ amount, currency: best[0] as Currency })));
  if (!summary) return null;
  return { summary, view: { currency: summary.currency, low: summary.low, median: summary.median, high: summary.high, n: summary.n, text: rangeText(summary), middle: money(summary.median, summary.currency) } };
}

const firstName = (name: string) => {
  const w = name.replace(/^@/, '').split(/[\s._]+/)[0];
  return w && /^[A-Za-z]{2,15}$/.test(w) ? w[0].toUpperCase() + w.slice(1) : '';
};

/** What to say to a seller, and what to aim for. */
export function negotiationFor(item: ResearchItem, market: { summary: PriceSummary; view: MarketPrice } | null, ctx: RateContext): Negotiation {
  const hi = firstName(item.name);
  const greet = hi ? `Hi ${hi}` : 'Hi';
  const what = ctx.what;

  if (ctx.kind === 'hire') {
    return {
      tip: 'Ask what they would charge for your specific job, what is included, and how long it takes. Get two quotes before you agree.',
      offer: null,
      message: `${greet}, I'm looking for ${what}${ctx.place ? ` in ${ctx.place}` : ''}. Could you share examples of your recent work, your rate for this job and your timeline? I'm comparing a few people before I decide.`,
    };
  }

  const p = item.prices;
  const comparable = Boolean(p?.matched);
  const sellerSummary: PriceSummary | null = p && comparable ? { currency: p.currency as Currency, low: p.low, median: p.median, high: p.high, n: p.n } : null;

  if (sellerSummary && market && sellerSummary.currency === market.summary.currency) {
    const v = versus(sellerSummary, market.summary);
    if (v?.kind === 'above') {
      const target = niceAmount(Math.max(market.summary.low, sellerSummary.median * 0.88));
      const offer = money(target, sellerSummary.currency);
      return {
        tip: `Their prices run about ${v.percent}% above what others charge (${market.view.text}, usually around ${market.view.middle}). Open near ${offer} and don't go much higher.`,
        offer,
        message: `${greet}, I like your ${what}. I saw yours around ${money(sellerSummary.median, sellerSummary.currency)}, but I've compared a few sellers and similar ones are about ${market.view.middle}. Could you do ${offer} if I order today? Please confirm it's available and the delivery time.`,
      };
    }
    if (v?.kind === 'below') {
      const tooLow = v.percent < -45;
      return {
        tip: tooLow
          ? `Their prices are far below others (${Math.abs(v.percent)}% under the usual ${market.view.middle}). That can mean a scam or poor quality — ask for a video of the actual item before you go further.`
          : `Cheaper than most (about ${Math.abs(v.percent)}% under the usual ${market.view.middle}). Good sign, but confirm what's included and the quality before treating it as a bargain.`,
        offer: null,
        message: `${greet}, I'm interested in your ${what}. Could you confirm the price, what's included, and a short video or photos of the actual item? Also, how long does delivery take?`,
      };
    }
    const offer = money(niceAmount(sellerSummary.median * 0.93), sellerSummary.currency);
    return {
      tip: `In line with the usual ${market.view.middle}. You can still ask for 5–10% off for ordering more than one, or for paying promptly — start near ${offer}.`,
      offer,
      message: `${greet}, I like your ${what}. Your price is fair — could you do ${offer} if I take it today? Please confirm availability and delivery time.`,
    };
  }

  if (sellerSummary) {
    const offer = money(niceAmount(sellerSummary.median * 0.93), sellerSummary.currency);
    return {
      tip: `Their posts show ${rangeText(sellerSummary)}. I couldn't compare with other sellers yet — ask for 5–10% off (about ${offer}) and get a second quote.`,
      offer,
      message: `${greet}, I saw your ${what} at around ${money(sellerSummary.median, sellerSummary.currency)}. Could you do ${offer} if I order today? Please confirm availability and delivery time.`,
    };
  }

  if (p && !comparable) {
    return {
      tip: `Their posts show prices from ${money(p.low, p.currency as Currency)} to ${money(p.high, p.currency as Currency)} across different items, so I can't tell what you'd pay for ${what}. Ask for the exact price of what you want${market ? ` — others charge ${market.view.text}, usually around ${market.view.middle}` : ' and get a second quote to compare'}.`,
      offer: null,
      message: `${greet}, I'm interested in ${what}. What's your price for it, and how long does delivery take? I'm comparing a few sellers.`,
    };
  }

  return {
    tip: market ? `No prices published — ask for a quote. Others charge ${market.view.text}, usually around ${market.view.middle}, so a quote far above that is a reason to push back.` : 'No prices published — ask for a quote, and get at least two before you decide.',
    offer: market ? market.view.middle : null,
    message: `${greet}, I'm interested in ${what}. What's your price and how long does delivery take? I'm comparing a few sellers.`,
  };
}

/**
 * Rate and annotate the whole shortlist: work out the typical price, compare each seller to it, fill in nearness and price scores,
 * average them, and write each seller's negotiation help. Returns new items; the input is not changed.
 */
export function applyRatings(items: readonly ResearchItem[], ctx: RateContext): { items: ResearchItem[]; market: MarketPrice | null } {
  const market = ctx.kind === 'vendors' ? marketOf(items) : null;
  const rated = items.map((item): ResearchItem => {
    const prices: ItemPrices | null = item.prices
      ? { ...item.prices, vsMarket: market && item.prices.matched && market.summary.currency === item.prices.currency ? versus({ currency: item.prices.currency as Currency, low: item.prices.low, median: item.prices.median, high: item.prices.high, n: item.prices.n }, market.summary) : null }
      : null;
    const base = item.rating;
    const rating: Rating | null = base
      ? (() => {
          const parts = { trust: base.trust, fit: base.fit, nearby: nearbyScore(item), price: priceScore(prices?.vsMarket ?? null) };
          const o = overall(parts);
          return o === null ? null : { overall: o, ...parts };
        })()
      : null;
    const withPrices = { ...item, prices, rating };
    return { ...withPrices, negotiation: item.checked ? negotiationFor(withPrices, market, ctx) : null };
  });
  return { items: rated, market: market?.view ?? null };
}

/** Best rating first; unrated (not looked inside) last; closer wins a tie. */
export function rankByRating(items: readonly ResearchItem[]): ResearchItem[] {
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => (b.item.rating?.overall ?? -1) - (a.item.rating?.overall ?? -1) || (a.item.distanceKm ?? 9e9) - (b.item.distanceKm ?? 9e9) || a.i - b.i)
    .map((x) => x.item);
}
