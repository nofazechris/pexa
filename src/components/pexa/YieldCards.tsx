'use client';

import { useState } from 'react';
import { color } from '@/lib/design/tokens';
import type { YieldView } from '@/lib/yield/view';
import type { YieldPool } from '@/lib/yield/rank';
import type { WatchView } from '@/lib/yield/watchlist';

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

const small = { border: `1px solid ${color.borderStrong}`, background: color.surface, color: color.ink, fontSize: '13px', fontWeight: 500, padding: '7px 13px', borderRadius: '10px', cursor: 'pointer' } as const;

async function callWatch(getAccessToken: (() => Promise<string | null>) | undefined, body: Record<string, unknown>): Promise<{ ok: boolean; message?: string }> {
  try {
    const token = getAccessToken ? await getAccessToken() : null;
    const res = await fetch('/api/watch', { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as { message?: string };
    return { ok: res.ok, message: data.message };
  } catch {
    return { ok: false, message: 'Couldn’t reach Pexa just now.' };
  }
}

/** "Watch" on a pool: saves it and tells the person in their notifications when it changes. Moves no money. */
function WatchButton({ poolId, getAccessToken }: { poolId: string; getAccessToken?: () => Promise<string | null> }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [note, setNote] = useState('');
  if (!getAccessToken) return null;
  return (
    <>
      <button
        disabled={state === 'busy' || state === 'done'}
        onClick={async () => {
          setState('busy');
          const r = await callWatch(getAccessToken, { action: 'add', poolId });
          setState(r.ok ? 'done' : 'error');
          setNote(r.ok ? '' : (r.message ?? 'Couldn’t save that.'));
        }}
        style={{ ...small, opacity: state === 'busy' ? 0.6 : 1, cursor: state === 'done' ? 'default' : 'pointer' }}
      >
        {state === 'done' ? 'Watching ✓' : state === 'busy' ? 'Saving…' : 'Watch'}
      </button>
      {state === 'error' ? <span style={{ fontSize: '12px', color: color.warning }}> {note}</span> : null}
    </>
  );
}

function Row({ p, onTry, getAccessToken }: { p: YieldPool; onTry?: (text: string) => void; getAccessToken?: () => Promise<string | null> }) {
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
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginTop: '10px' }}>
        {p.depositToken && onTry ? (
          <button onClick={() => onTry(`Deposit ${p.depositToken} into Aave on Celo`)} style={small}>
            Deposit {p.depositToken} into Aave
          </button>
        ) : null}
        <WatchButton poolId={p.id} getAccessToken={getAccessToken} />
      </div>
    </div>
  );
}

export function YieldCard({ data, onTry, getAccessToken }: { data: YieldView; onTry?: (text: string) => void; getAccessToken?: () => Promise<string | null> }) {
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
        <Row key={p.id} p={p} onTry={onTry} getAccessToken={getAccessToken} />
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

const pctText = (n: number) => `${n.toFixed(n >= 10 ? 1 : 2)}%`;

function WatchRow({ w, onTry, getAccessToken, onRemoved }: { w: WatchView; onTry?: (text: string) => void; getAccessToken?: () => Promise<string | null>; onRemoved: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  const risk = w.risk ? RISK[w.risk] : null;
  return (
    <div style={{ border: `1px solid ${color.border}`, background: color.surface, borderRadius: '14px', padding: '13px 15px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'baseline', flexWrap: 'wrap' }}>
        <div style={{ fontSize: '15px', fontWeight: 600, letterSpacing: '-.01em' }}>
          {w.symbol} <span style={{ fontWeight: 400, color: color.mutedStrong }}>· {w.project} · {w.chain}</span>
        </div>
        {risk ? <span style={{ fontSize: '11.5px', fontWeight: 600, color: risk.fg }}>{risk.label}</span> : null}
      </div>
      {w.now ? (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '14px', marginTop: '8px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '22px', fontWeight: 600, letterSpacing: '-.03em', fontVariantNumeric: 'tabular-nums' }}>{pctText(w.now.apyBase)}</div>
            <div style={{ fontSize: '11.5px', color: color.mutedStrong }}>pays steadily now</div>
          </div>
          {w.now.apyReward > 0 ? (
            <div>
              <div style={{ fontSize: '17px', fontWeight: 500, color: color.mutedStrong, fontVariantNumeric: 'tabular-nums' }}>+ {pctText(w.now.apyReward)}</div>
              <div style={{ fontSize: '11.5px', color: color.mutedStrong }}>temporary rewards</div>
            </div>
          ) : null}
          <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
            <div style={{ fontSize: '13.5px', fontVariantNumeric: 'tabular-nums' }}>{usd(w.now.tvlUsd)}</div>
            <div style={{ fontSize: '11.5px', color: color.mutedStrong }}>deposited</div>
          </div>
        </div>
      ) : null}
      <div style={{ fontSize: '12.5px', lineHeight: 1.5, color: color.mutedStrong, marginTop: '8px' }}>
        Since you added it: {w.since}.{w.targetApy ? ` I’ll tell you when it pays ${pctText(w.targetApy)} steadily.` : ''}
      </div>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginTop: '10px' }}>
        {w.depositToken && onTry ? (
          <button onClick={() => onTry(`Deposit ${w.depositToken} into Aave on Celo`)} style={small}>
            Deposit {w.depositToken} into Aave
          </button>
        ) : null}
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const r = await callWatch(getAccessToken, { action: 'remove', id: w.id });
            if (r.ok) onRemoved(w.id);
            else setBusy(false);
          }}
          style={{ ...small, opacity: busy ? 0.6 : 1 }}
        >
          Stop watching
        </button>
        <a href={w.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '12px', color: color.primary, textDecoration: 'none' }}>
          See the data ↗
        </a>
      </div>
    </div>
  );
}

/** The pools the person is watching, with how each has changed since they added it. Nothing here moves money. */
export function WatchlistCard({ items, onTry, getAccessToken }: { items: WatchView[]; onTry?: (text: string) => void; getAccessToken?: () => Promise<string | null> }) {
  const [gone, setGone] = useState<string[]>([]);
  const shown = items.filter((w) => !gone.includes(w.id));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '9px', maxWidth: '460px' }}>
      <div style={{ border: `1px solid ${color.border}`, background: color.surface, borderRadius: '16px', padding: '14px 16px' }}>
        <div style={{ fontFamily: MONO, fontSize: '10.5px', letterSpacing: '.12em', color: color.faint }}>YOUR WATCHLIST</div>
        <div style={{ fontSize: '14px', lineHeight: 1.5, marginTop: '8px', color: color.ink }}>
          {shown.length ? `Watching ${shown.length} pool${shown.length === 1 ? '' : 's'}. I’ll tell you in your notifications when one changes a lot, its rewards end, money leaves it, or it reaches a rate you asked for.` : 'You’re not watching any pools. Ask me to research yields and tap Watch on one.'}
        </div>
      </div>
      {shown.map((w) => (
        <WatchRow key={w.id} w={w} onTry={onTry} getAccessToken={getAccessToken} onRemoved={(id) => setGone((g) => [...g, id])} />
      ))}
      <div style={{ fontSize: '12px', color: color.mutedStrong, lineHeight: 1.55, padding: '0 4px' }}>I check when you open the app and once a day. {YIELD_NOTE}</div>
    </div>
  );
}

const YIELD_NOTE = 'Not financial advice. Rates change daily and you can lose money.';
