'use client';

import { color } from '@/lib/design/tokens';
import type { YieldView } from '@/lib/yield/view';
import type { YieldPool } from '@/lib/yield/rank';

/**
 * The yield research card: a ranked list of pools where every number is the data source's, split into what a pool pays
 * steadily and what is temporary rewards, with the risk written in plain words. Nothing here moves money.
 */

const MONO = 'var(--font-geist-mono),monospace';
const RISK = {
  lower: { label: 'Lower risk', fg: 'var(--pp-success-text, #1a7f4b)' },
  medium: { label: 'Medium risk', fg: 'var(--pp-warn-text, #9a6700)' },
  high: { label: 'High risk', fg: 'var(--pp-danger-text, #b42318)' },
} as const;

const pct = (n: number) => `${n.toFixed(n >= 10 ? 1 : 2)}%`;
const usd = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}K`);

function Row({ p }: { p: YieldPool }) {
  const risk = RISK[p.risk];
  return (
    <div style={{ border: `1px solid ${color.border}`, background: color.surface, borderRadius: '14px', padding: '13px 15px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'baseline', flexWrap: 'wrap' }}>
        <div style={{ fontSize: '15px', fontWeight: 600, letterSpacing: '-.01em' }}>
          {p.symbol} <span style={{ fontWeight: 400, color: color.mutedStrong }}>· {p.project} · {p.chain}</span>
        </div>
        <span style={{ fontSize: '11.5px', fontWeight: 600, color: risk.fg }}>{risk.label}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '14px', marginTop: '8px', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '22px', fontWeight: 600, letterSpacing: '-.03em', fontVariantNumeric: 'tabular-nums' }}>{pct(p.apyBase)}</div>
          <div style={{ fontSize: '11.5px', color: color.mutedStrong }}>pays steadily</div>
        </div>
        {p.apyReward > 0 ? (
          <div>
            <div style={{ fontSize: '17px', fontWeight: 500, color: color.mutedStrong, fontVariantNumeric: 'tabular-nums' }}>+ {pct(p.apyReward)}</div>
            <div style={{ fontSize: '11.5px', color: color.mutedStrong }}>temporary rewards</div>
          </div>
        ) : null}
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div style={{ fontSize: '13.5px', fontVariantNumeric: 'tabular-nums' }}>{usd(p.tvlUsd)}</div>
          <div style={{ fontSize: '11.5px', color: color.mutedStrong }}>deposited</div>
        </div>
      </div>
      {p.flags.length ? (
        <ul style={{ margin: '9px 0 0', paddingLeft: '17px', fontSize: '12.5px', lineHeight: 1.5, color: color.mutedStrong }}>
          {p.flags.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      ) : null}
      <div style={{ marginTop: '9px', fontSize: '12px' }}>
        <a href={p.url} target="_blank" rel="noopener noreferrer" style={{ color: color.primary, textDecoration: 'none' }}>
          See the data ↗
        </a>
        <span style={{ color: color.faint }}> · {p.kind}</span>
      </div>
    </div>
  );
}

export function YieldCard({ data }: { data: YieldView }) {
  const where = data.chains.length ? data.chains.join(', ') : 'all chains';
  const when = new Date(data.asOf);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '9px', maxWidth: '460px' }}>
      <div style={{ border: `1px solid ${color.border}`, background: color.surface, borderRadius: '16px', padding: '14px 16px' }}>
        <div style={{ fontFamily: MONO, fontSize: '10.5px', letterSpacing: '.12em', color: color.faint }}>YIELD RESEARCH · {where.toUpperCase()}</div>
        <div style={{ fontSize: '14px', lineHeight: 1.5, marginTop: '8px', color: color.ink }}>
          {data.items.length ? `${data.items.length} ${data.assets === 'stablecoins' ? 'stablecoin ' : ''}pool${data.items.length === 1 ? '' : 's'}${data.symbol ? ` for ${data.symbol}` : ''}, ranked by what they pay steadily — not the headline rate.` : 'No pool matched.'}
        </div>
        <div style={{ fontFamily: MONO, fontSize: '11px', color: color.faint, marginTop: '8px' }}>Data from DefiLlama · read {Number.isNaN(when.getTime()) ? 'just now' : when.toUTCString().slice(5, 22) + ' UTC'}</div>
      </div>
      {data.items.map((p) => (
        <Row key={p.id} p={p} />
      ))}
      <div style={{ fontSize: '12px', color: color.mutedStrong, lineHeight: 1.55, padding: '0 4px' }}>
        {data.notes.map((n) => (
          <div key={n} style={{ marginTop: '4px' }}>
            {n}
          </div>
        ))}
      </div>
    </div>
  );
}
