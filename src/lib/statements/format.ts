/**
 * A statement: the money that moved in and out of the account over a period, as one readable page. Pure — the same data builds
 * the card, the CSV for a spreadsheet and the print/PDF page — so the three can never disagree.
 */

export type RowKind = 'sent' | 'received' | 'deposit' | 'conversion' | 'purchase';

export interface StatementRow {
  /** ISO time. */
  at: string;
  kind: RowKind;
  description: string;
  /** Signed decimal dollars: money in is positive, money out negative, a conversion 0. */
  amount: number;
  token: string;
  /** "Completed", "Pending"… */
  status: string;
  /** Celoscan link when there is one. */
  url: string | null;
}

export interface StatementTotals {
  moneyIn: number;
  moneyOut: number;
  net: number;
  completed: number;
}

export interface StatementData {
  label: string;
  startIso: string;
  endIso: string;
  generatedAt: string;
  username: string | null;
  totals: StatementTotals;
  /** How many items the period holds in all (the card may show fewer). */
  count: number;
  rows: StatementRow[];
  truncated: boolean;
}

export const MAX_STATEMENT_ROWS = 300;

/** Only completed items count toward the totals; pending ones are listed but not added up. */
export function isCompleted(row: StatementRow): boolean {
  return row.status === 'Completed';
}

export function assembleStatement(input: { label: string; start: Date; end: Date; username: string | null; rows: StatementRow[]; now?: Date }): StatementData {
  const sorted = [...input.rows].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  let moneyIn = 0;
  let moneyOut = 0;
  let completed = 0;
  for (const r of sorted) {
    if (!isCompleted(r)) continue;
    completed++;
    if (r.amount > 0) moneyIn += r.amount;
    else if (r.amount < 0) moneyOut += -r.amount;
  }
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  return {
    label: input.label,
    startIso: input.start.toISOString(),
    endIso: input.end.toISOString(),
    generatedAt: (input.now ?? new Date()).toISOString(),
    username: input.username,
    totals: { moneyIn: round(moneyIn), moneyOut: round(moneyOut), net: round(moneyIn - moneyOut), completed },
    count: sorted.length,
    rows: sorted.slice(0, MAX_STATEMENT_ROWS),
    truncated: sorted.length > MAX_STATEMENT_ROWS,
  };
}

/** $1,234.50 — two decimals, or up to four for amounts under a dollar so cents of fees don't vanish. */
export function money(n: number): string {
  const abs = Math.abs(n);
  const digits = abs > 0 && abs < 1 ? 4 : 2;
  const s = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: digits });
  return `${n < 0 ? '-' : ''}$${s}`;
}

const KIND_LABEL: Record<RowKind, string> = { sent: 'Sent', received: 'Received', deposit: 'Deposit', conversion: 'Conversion', purchase: 'Purchase' };
export const kindLabel = (k: RowKind): string => KIND_LABEL[k];

const csvCell = (v: string | number): string => {
  let s = String(v);
  // Stop a spreadsheet from running text as a formula.
  if (/^[=+\-@\t\r]/.test(s) && typeof v === 'string') s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** A spreadsheet-ready file: one row per item. */
export function statementCsv(d: StatementData): string {
  const header = ['Date (UTC)', 'Type', 'Description', 'Amount (USD)', 'Currency', 'Status', 'Transaction'];
  const lines = d.rows.map((r) => [r.at.replace('T', ' ').slice(0, 19), kindLabel(r.kind), r.description, r.amount.toFixed(6).replace(/\.?0+$/, '') || '0', r.token, r.status, r.url ?? ''].map(csvCell).join(','));
  return [header.map(csvCell).join(','), ...lines].join('\r\n') + '\r\n';
}

export function statementFilename(d: StatementData, ext: 'csv' | 'pdf'): string {
  return `pexa-statement-${d.startIso.slice(0, 10)}-to-${d.endIso.slice(0, 10)}.${ext}`;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const dateOnly = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** A self-contained printable page (the browser's Print → "Save as PDF" turns it into a PDF). No scripts, no external files. */
export function statementHtml(d: StatementData): string {
  const rows = d.rows
    .map(
      (r) =>
        `<tr><td>${esc(dateOnly(r.at))}</td><td>${esc(kindLabel(r.kind))}</td><td>${esc(r.description)}</td><td class="n ${r.amount < 0 ? 'out' : r.amount > 0 ? 'in' : ''}">${r.amount === 0 ? '—' : esc(money(r.amount))}</td><td>${esc(r.token)}</td><td>${esc(r.status)}</td></tr>`,
    )
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(statementFilename(d, 'pdf').replace(/\.pdf$/, ''))}</title><style>
body{font:14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0E1420;margin:32px}
h1{font-size:22px;margin:0 0 2px}.sub{color:#5B6472;margin:0 0 20px}
.sum{display:flex;gap:28px;margin:0 0 22px}.sum div{min-width:110px}.sum b{display:block;font-size:19px}.sum span{color:#5B6472;font-size:12px}
table{border-collapse:collapse;width:100%}th,td{padding:7px 8px;border-bottom:1px solid #E4E7EC;text-align:left;font-size:12.5px;vertical-align:top}
th{color:#5B6472;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.05em}td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.in{color:#167A54}.out{color:#0E1420}
.foot{margin-top:18px;color:#5B6472;font-size:11.5px}@media print{body{margin:14mm}}
</style></head><body>
<h1>Pexa statement</h1>
<p class="sub">${d.username ? `@${esc(d.username)} · ` : ''}${esc(d.label)} (${esc(dateOnly(d.startIso))} – ${esc(dateOnly(d.endIso))}) · generated ${esc(dateOnly(d.generatedAt))}</p>
<div class="sum"><div><b class="in">${esc(money(d.totals.moneyIn))}</b><span>Money in</span></div><div><b>${esc(money(d.totals.moneyOut))}</b><span>Money out</span></div><div><b>${esc(money(d.totals.net))}</b><span>Net</span></div><div><b>${d.count}</b><span>Items</span></div></div>
<table><thead><tr><th>Date</th><th>Type</th><th>Description</th><th style="text-align:right">Amount</th><th>Coin</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>
<p class="foot">Amounts are in dollar stablecoins (USDC, USDT, USAT) on Celo. Only completed items are added up; pending ones are listed but not counted. ${d.truncated ? `Showing the newest ${d.rows.length} of ${d.count} items. ` : ''}Every on-chain item can be checked on Celoscan.</p>
</body></html>`;
}
