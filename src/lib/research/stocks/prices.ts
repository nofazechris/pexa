/**
 * Price facts for a stock, from Yahoo Finance's public chart data (no key). Only arithmetic on published closing prices: how far it
 * moved over a week, a month, three months, the year so far and the year; how bumpy the ride was; and the worst fall in the last
 * three months. A symbol the source doesn't know is not a stock we can talk about. Pure parsing here; the fetch is on the server.
 */

export interface PriceStats {
  symbol: string;
  name: string | null;
  currency: string;
  last: number;
  /** Percent moves. Null when there isn't enough history. */
  ret1w: number | null;
  ret1m: number | null;
  ret3m: number | null;
  retYtd: number | null;
  ret1y: number | null;
  /** How bumpy: the yearly-rate standard deviation of daily moves, percent. */
  vol: number | null;
  /** The biggest peak-to-trough fall over the last three months, percent (a positive number). */
  drawdown3m: number | null;
  /** The market it trades on, e.g. "NasdaqGS". */
  exchange: string | null;
}

const pctMove = (from: number, to: number) => (from > 0 ? Math.round(((to / from - 1) * 100) * 10) / 10 : null);

/** The closes of a Yahoo chart response, paired with their timestamps, with gaps removed. */
function closes(json: unknown): { t: number; c: number }[] {
  const r = (json as { chart?: { result?: { timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[] } })?.chart?.result?.[0];
  const ts = r?.timestamp ?? [];
  const cs = r?.indicators?.quote?.[0]?.close ?? [];
  const out: { t: number; c: number }[] = [];
  for (let i = 0; i < ts.length; i++) {
    const c = cs[i];
    if (typeof c === 'number' && Number.isFinite(c) && c > 0) out.push({ t: ts[i], c });
  }
  return out;
}

export function parsePrices(json: unknown, symbol: string, now: Date): PriceStats | null {
  const meta = (json as { chart?: { result?: { meta?: Record<string, unknown> }[] } })?.chart?.result?.[0]?.meta ?? {};
  const series = closes(json);
  if (series.length < 5) return null;
  const last = series[series.length - 1].c;
  const back = (days: number) => (series.length > days ? series[series.length - 1 - days].c : null);
  const ret = (days: number) => {
    const b = back(days);
    return b === null ? null : pctMove(b, last);
  };

  const yearStart = Date.UTC(now.getUTCFullYear(), 0, 1) / 1000;
  const first = series.find((p) => p.t >= yearStart);
  const prevYearClose = [...series].reverse().find((p) => p.t < yearStart);
  const ytdBase = prevYearClose?.c ?? first?.c ?? null;

  let vol: number | null = null;
  if (series.length >= 30) {
    const rets: number[] = [];
    for (let i = 1; i < series.length; i++) rets.push(Math.log(series[i].c / series[i - 1].c));
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
    vol = Math.round(Math.sqrt(variance) * Math.sqrt(252) * 1000) / 10;
  }

  let drawdown3m: number | null = null;
  const window = series.slice(-64);
  if (window.length >= 20) {
    let peak = window[0].c;
    let worst = 0;
    for (const p of window) {
      peak = Math.max(peak, p.c);
      worst = Math.max(worst, (peak - p.c) / peak);
    }
    drawdown3m = Math.round(worst * 1000) / 10;
  }

  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    symbol: symbol.toUpperCase(),
    name: str(meta.longName) ?? str(meta.shortName),
    currency: str(meta.currency) ?? 'USD',
    last: Math.round(last * 100) / 100,
    ret1w: ret(5),
    ret1m: ret(21),
    ret3m: ret(63),
    retYtd: ytdBase ? pctMove(ytdBase, last) : null,
    ret1y: series.length > 240 ? pctMove(series[0].c, last) : null,
    vol,
    drawdown3m,
    exchange: str(meta.fullExchangeName) ?? str(meta.exchangeName),
  };
}
