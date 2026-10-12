'use client';

import { useState } from 'react';
import { color } from '@/lib/design/tokens';
import { kindLabel, money, statementCsv, statementFilename, statementHtml, type StatementData } from '@/lib/statements/format';

/**
 * A statement in the chat: totals for the period, the items, and two buttons — a spreadsheet (CSV) and a printable page
 * (the browser's Print → "Save as PDF"). Everything is built on the person's own screen from the data the server sent.
 */

const PREVIEW_ROWS = 8;
const EXPANDED_ROWS = 100;

function save(filename: string, mime: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function StatementCard({ data }: { data: StatementData }) {
  const [all, setAll] = useState(false);
  const shown = data.rows.slice(0, all ? EXPANDED_ROWS : PREVIEW_ROWS);
  const t = data.totals;

  const printIt = () => {
    const html = statementHtml(data);
    const w = window.open('', '_blank');
    if (!w) {
      // Pop-ups blocked: hand over the page as a file instead.
      save(statementFilename(data, 'pdf').replace(/\.pdf$/, '.html'), 'text/html', html);
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 250);
  };

  return (
    <div style={{ background: color.surface, border: `1px solid ${color.border}`, borderRadius: '16px', padding: '16px', maxWidth: '460px' }}>
      <div style={{ fontFamily: 'var(--font-geist-mono),monospace', fontSize: '10.5px', letterSpacing: '.12em', color: color.faint }}>STATEMENT · {data.label.toUpperCase()}</div>

      <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap', marginTop: '12px' }}>
        <div>
          <div style={{ fontSize: '19px', fontWeight: 600, letterSpacing: '-.03em', color: color.success, fontVariantNumeric: 'tabular-nums' }}>{money(t.moneyIn)}</div>
          <div style={{ fontSize: '12px', color: color.mutedStrong }}>Money in</div>
        </div>
        <div>
          <div style={{ fontSize: '19px', fontWeight: 600, letterSpacing: '-.03em', fontVariantNumeric: 'tabular-nums' }}>{money(t.moneyOut)}</div>
          <div style={{ fontSize: '12px', color: color.mutedStrong }}>Money out</div>
        </div>
        <div>
          <div style={{ fontSize: '19px', fontWeight: 600, letterSpacing: '-.03em', fontVariantNumeric: 'tabular-nums' }}>{money(t.net)}</div>
          <div style={{ fontSize: '12px', color: color.mutedStrong }}>Net</div>
        </div>
      </div>

      <div style={{ marginTop: '12px', borderTop: `1px solid ${color.borderFaint}` }}>
        {shown.map((r, i) => (
          <div key={`${r.at}-${i}`} style={{ display: 'flex', alignItems: 'baseline', gap: '10px', padding: '8px 0', borderBottom: `1px solid ${color.borderFaint}`, fontSize: '13px' }}>
            <span style={{ flex: 'none', width: '52px', color: color.faint, fontSize: '12px' }}>{new Date(r.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}</span>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: color.ink }}>
              <span style={{ color: color.faint }}>{kindLabel(r.kind)} · </span>
              {r.description}
              {r.status !== 'Completed' ? <span style={{ color: color.warning }}> ({r.status.toLowerCase()})</span> : null}
            </span>
            <span style={{ flex: 'none', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: r.amount > 0 ? color.success : color.ink }}>{r.amount === 0 ? '—' : money(r.amount)}</span>
          </div>
        ))}
        {data.rows.length > PREVIEW_ROWS ? (
          <button onClick={() => setAll((v) => !v)} style={{ border: 'none', background: 'transparent', color: color.primary, fontSize: '13px', fontWeight: 500, padding: '9px 0 0', cursor: 'pointer' }}>
            {all ? 'Show fewer' : `Show more (${Math.min(data.rows.length, EXPANDED_ROWS) - PREVIEW_ROWS} more)`}
          </button>
        ) : null}
      </div>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '14px' }}>
        <button onClick={() => save(statementFilename(data, 'csv'), 'text/csv;charset=utf-8', '﻿' + statementCsv(data))} style={{ border: 'none', background: color.primary, color: '#fff', fontSize: '13.5px', fontWeight: 500, padding: 'var(--pp-btn-y) 15px', borderRadius: '11px', cursor: 'pointer' }}>
          Download spreadsheet (CSV)
        </button>
        <button onClick={printIt} style={{ border: `1px solid ${color.borderStrong}`, background: color.surface, color: color.ink, fontSize: '13.5px', fontWeight: 500, padding: 'var(--pp-btn-y) 15px', borderRadius: '11px', cursor: 'pointer' }}>
          Print / Save as PDF
        </button>
      </div>
      <div style={{ fontSize: '11.5px', color: color.faint, marginTop: '10px', lineHeight: 1.5 }}>
        Only completed items are added up. {data.truncated ? `Showing the newest ${data.rows.length} of ${data.count}. ` : ''}Amounts are in dollar stablecoins on Celo.
      </div>
    </div>
  );
}
