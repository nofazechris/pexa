'use client';

import { useState } from 'react';
import { color } from '@/lib/design/tokens';
import type { ResearchResult, StockItem } from '@/lib/research/types';

/**
 * The stock research card: for each ticker people are talking about, who is talking and how much, what the price has really done,
 * and the plain-words flags. It never says buy or sell, and it says out loud that Pexa can't trade stocks.
 */

const MONO = 'var(--font-geist-mono),monospace';
const DOT = { good: 'var(--pp-success, #1a7f4b)', warn: 'var(--pp-warning-dot, #b7791f)', info: 'var(--pp-faint, #9aa3b2)' } as const;

const pct = (n: number | null) => (n === null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(1)}%`);
const tone = (n: number | null) => (n === null ? color.mutedStrong : n >= 0 ? 'var(--pp-success, #1a7f4b)' : 'var(--pp-danger-text, #b42318)');

function Stat({ label, value, c }: { label: string; value: string; c?: string }) {
  return (
    <div>
      <div style={{ fontSize: '14px', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: c ?? color.ink }}>{value}</div>
      <div style={{ fontSize: '11px', color: color.mutedStrong }}>{label}</div>
    </div>
  );
}

/** "Watch" on a stock: saves it with how much talk there is now, and tells the person when its price moves a lot. Moves no money. */
function WatchStock({ s, getAccessToken }: { s: StockItem; getAccessToken?: () => Promise<string | null> }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [note, setNote] = useState('');
  if (!getAccessToken) return null;
  return (
    <>
      <button
        disabled={state === 'busy' || state === 'done'}
        onClick={async () => {
          setState('busy');
          try {
            const token = await getAccessToken();
            const res = await fetch('/api/watch', { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ action: 'add_ticker', symbol: s.symbol, authors: s.heat.authors, posts: s.heat.posts }) });
            const data = (await res.json().catch(() => ({}))) as { message?: string };
            setState(res.ok ? 'done' : 'error');
            setNote(res.ok ? '' : (data.message ?? 'Couldn’t save that.'));
          } catch {
            setState('error');
            setNote('Couldn’t reach Pexa just now.');
          }
        }}
        style={{ border: `1px solid ${color.borderStrong}`, background: color.surface, color: color.ink, fontSize: '13px', fontWeight: 500, padding: '7px 13px', borderRadius: '10px', cursor: state === 'done' ? 'default' : 'pointer', opacity: state === 'busy' ? 0.6 : 1 }}
      >
        {state === 'done' ? 'Watching ✓' : state === 'busy' ? 'Saving…' : 'Watch'}
      </button>
      {state === 'error' ? <span style={{ fontSize: '12px', color: color.warning }}> {note}</span> : null}
    </>
  );
}

function Item({ s, getAccessToken }: { s: StockItem; getAccessToken?: () => Promise<string | null> }) {
  return (
    <div style={{ border: `1px solid ${color.border}`, background: color.surface, borderRadius: '14px', padding: '13px 15px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'baseline', flexWrap: 'wrap' }}>
        <div style={{ fontSize: '15px', fontWeight: 600, letterSpacing: '-.01em' }}>
          ${s.symbol} {s.name ? <span style={{ fontWeight: 400, color: color.mutedStrong }}>· {s.name}</span> : null}
        </div>
        <span style={{ fontSize: '11.5px', fontWeight: 500, color: color.mutedStrong, textTransform: 'capitalize' }}>{s.pattern}</span>
      </div>

      {s.price ? (
        <div style={{ display: 'flex', gap: '16px', marginTop: '10px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Stat label={s.price.currency} value={s.price.last.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} />
          <Stat label="1 week" value={pct(s.price.ret1w)} c={tone(s.price.ret1w)} />
          <Stat label="1 month" value={pct(s.price.ret1m)} c={tone(s.price.ret1m)} />
          <Stat label="3 months" value={pct(s.price.ret3m)} c={tone(s.price.ret3m)} />
          {s.price.vol !== null ? <Stat label="yearly swing" value={`${s.price.vol.toFixed(0)}%`} /> : null}
        </div>
      ) : (
        <div style={{ fontSize: '12.5px', color: color.mutedStrong, marginTop: '8px' }}>No price data came back for this one.</div>
      )}

      <ul style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: '5px' }}>
        {s.flags.map((f) => (
          <li key={f.text} style={{ display: 'flex', gap: '8px', fontSize: '12.5px', lineHeight: 1.45, color: color.mutedStrong }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: DOT[f.tone], flex: 'none', marginTop: '6px' }} />
            <span>{f.text}</span>
          </li>
        ))}
      </ul>

      {s.fit ? <div style={{ marginTop: '9px', fontSize: '12.5px', lineHeight: 1.45, color: color.ink, background: color.primaryTint, borderRadius: '9px', padding: '7px 10px' }}>{s.fit}</div> : null}

      {s.examples.length ? (
        <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {s.examples.map((e) => (
            <div key={e.author + e.text.slice(0, 12)} style={{ fontSize: '12px', lineHeight: 1.45, color: color.mutedStrong, borderLeft: `2px solid ${color.borderFaint}`, paddingLeft: '9px' }}>
              “{e.text}” <span style={{ color: color.faint }}>— {e.platform === 'x' ? '@' : 'u/'}{e.author} on {e.platform === 'x' ? 'X' : 'Reddit'}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div style={{ marginTop: '10px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', fontSize: '12px' }}>
        <WatchStock s={s} getAccessToken={getAccessToken} />
        <a href={`https://finance.yahoo.com/quote/${encodeURIComponent(s.symbol)}`} target="_blank" rel="noopener noreferrer" style={{ color: color.primary, textDecoration: 'none' }}>
          See the chart ↗
        </a>
      </div>
    </div>
  );
}

export function StockResultCard({ r, getAccessToken }: { r: ResearchResult; getAccessToken?: () => Promise<string | null> }) {
  const s = r.stocks;
  if (!s) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '9px', maxWidth: '460px' }}>
      <div style={{ border: `1px solid ${color.border}`, background: color.surface, borderRadius: '16px', padding: '14px 16px' }}>
        <div style={{ fontFamily: MONO, fontSize: '10.5px', letterSpacing: '.12em', color: color.faint }}>{s.focus ? `THE TALK ABOUT $${s.focus}` : `STOCK RESEARCH · ${s.theme.toUpperCase()}`}</div>
        <div style={{ fontSize: '14.5px', lineHeight: 1.5, marginTop: '8px', color: color.ink }}>{r.summary}</div>
        {s.profileNote ? <div style={{ fontSize: '12.5px', color: color.mutedStrong, marginTop: '8px' }}>{s.profileNote}</div> : null}
        <div style={{ fontFamily: MONO, fontSize: '11.5px', color: color.faint, marginTop: '8px' }}>
          Read {s.read.x} posts on X and {s.read.reddit} on Reddit · prices from Yahoo Finance · cost {r.spent}
        </div>
      </div>
      {s.items.map((it) => (
        <Item key={it.symbol} s={it} getAccessToken={getAccessToken} />
      ))}
      {r.notes.length ? (
        <div style={{ fontSize: '12px', color: color.mutedStrong, lineHeight: 1.55, padding: '0 4px' }}>
          {r.notes.map((n) => (
            <div key={n} style={{ marginTop: '4px' }}>
              {n}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
