import { describe, expect, it } from 'vitest';
import { MAX_STATEMENT_ROWS, assembleStatement, money, statementCsv, statementFilename, statementHtml, type StatementRow } from './format';

const START = new Date(Date.UTC(2026, 8, 14));
const END = new Date(Date.UTC(2026, 9, 14));
const row = (over: Partial<StatementRow>): StatementRow => ({ at: '2026-10-08T17:46:00.000Z', kind: 'sent', description: 'To @omoefe', amount: -1, token: 'USDC', status: 'Completed', url: null, ...over });

const rows: StatementRow[] = [
  row({ at: '2026-10-08T17:46:00.000Z', kind: 'sent', description: 'To @omoefe', amount: -1 }),
  row({ at: '2026-10-12T16:21:00.000Z', kind: 'deposit', description: 'Deposit from outside Pexa', amount: 0.971427, url: 'https://celoscan.io/tx/0xabc' }),
  row({ at: '2026-10-07T12:38:00.000Z', kind: 'received', description: 'From @joyful', amount: 1 }),
  row({ at: '2026-10-06T23:15:00.000Z', kind: 'purchase', description: 'Buy: x.posts.search', amount: -0.006 }),
  row({ at: '2026-10-09T10:00:00.000Z', kind: 'conversion', description: 'Converted 5 USDC → 5.005 USAT', amount: 0, token: 'USDC→USAT' }),
  row({ at: '2026-10-10T10:00:00.000Z', kind: 'sent', description: 'To @late', amount: -3, status: 'Pending' }),
];

describe('assembleStatement', () => {
  const s = assembleStatement({ label: 'the last 30 days', start: START, end: END, username: 'chris', rows, now: END });
  it('sorts newest first', () => {
    expect(s.rows.map((r) => r.at)).toEqual([...s.rows.map((r) => r.at)].sort().reverse());
    expect(s.rows[0].kind).toBe('deposit');
  });
  it('adds up only completed money in and out; conversions and pending items are not counted', () => {
    expect(s.totals.moneyIn).toBeCloseTo(1.971427, 6);
    expect(s.totals.moneyOut).toBeCloseTo(1.006, 6);
    expect(s.totals.net).toBeCloseTo(0.965427, 6);
    expect(s.totals.completed).toBe(5);
    expect(s.count).toBe(6);
  });
  it('is bounded', () => {
    const many = Array.from({ length: MAX_STATEMENT_ROWS + 25 }, (_, i) => row({ at: new Date(Date.UTC(2026, 9, 1, 0, 0, i)).toISOString() }));
    const big = assembleStatement({ label: 'x', start: START, end: END, username: null, rows: many });
    expect(big.rows).toHaveLength(MAX_STATEMENT_ROWS);
    expect(big.truncated).toBe(true);
    expect(big.count).toBe(MAX_STATEMENT_ROWS + 25);
  });
  it('an empty period still makes a valid, zeroed statement', () => {
    const e = assembleStatement({ label: 'the last 7 days', start: START, end: END, username: null, rows: [] });
    expect(e.count).toBe(0);
    expect(e.totals).toEqual({ moneyIn: 0, moneyOut: 0, net: 0, completed: 0 });
  });
});

describe('money', () => {
  it.each([[5, '$5.00'], [-1.5, '-$1.50'], [0.971427, '$0.9714'], [1234.5, '$1,234.50'], [0, '$0.00'], [-0.006, '-$0.006']])('%s → %s', (n, want) => expect(money(n)).toBe(want));
});

describe('statementCsv', () => {
  const s = assembleStatement({ label: 'x', start: START, end: END, username: 'chris', rows, now: END });
  const csv = statementCsv(s);
  it('has a header and one line per item', () => {
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('Date (UTC),Type,Description,Amount (USD),Currency,Status,Transaction');
    expect(lines).toHaveLength(1 + s.rows.length);
    expect(lines[1]).toContain('2026-10-12 16:21:00,Deposit,Deposit from outside Pexa,0.971427,USDC,Completed,https://celoscan.io/tx/0xabc');
  });
  it('escapes commas and quotes, and defuses spreadsheet formulas', () => {
    const t = statementCsv(assembleStatement({ label: 'x', start: START, end: END, username: null, rows: [row({ description: '=HYPERLINK("http://evil","x"), thanks' })] }));
    expect(t).toContain(`"'=HYPERLINK(""http://evil"",""x""), thanks"`);
  });
  it('filename carries the period', () => expect(statementFilename(s, 'csv')).toBe('pexa-statement-2026-09-14-to-2026-10-14.csv'));
});

describe('statementHtml', () => {
  const s = assembleStatement({ label: 'the last 30 days', start: START, end: END, username: 'chris', rows, now: END });
  const html = statementHtml(s);
  it('is a complete page with the totals and the items', () => {
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('Pexa statement');
    expect(html).toContain('@chris');
    expect(html).toContain('the last 30 days');
    expect(html).toContain('$1.97'); // money in
    expect(html).toContain('To @omoefe');
  });
  it('contains no script and escapes what people typed', () => {
    const evil = statementHtml(assembleStatement({ label: 'x', start: START, end: END, username: '<b>x</b>', rows: [row({ description: '<script>alert(1)</script>' })] }));
    expect(evil).not.toMatch(/<script/i);
    expect(evil).toContain('&lt;script&gt;');
    expect(evil).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
});
