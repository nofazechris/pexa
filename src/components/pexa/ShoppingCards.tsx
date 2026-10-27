'use client';

import { color } from '@/lib/design/tokens';
import { linkText, payText, researchText, storesText } from '@/lib/shopping/intent';
import type { OptionSnap } from '@/lib/shopping/options';
import type { ShoppingItemView } from '@/lib/shopping/types';

/**
 * The shopping list card: each thing the person is trying to buy, the best options found (with how they rated and what they
 * published), what changed since last time, and the next steps. Nothing is bought or paid from here: "Pay" only starts the step
 * where Pexa shows a Confirm card and the person decides.
 */

const MONO = 'var(--font-geist-mono),monospace';
const SOURCE: Record<OptionSnap['source'], string> = { instagram: 'Instagram', tiktok: 'TikTok', x: 'X', web: 'Web page', store: 'Nearby store' };

const small = { border: `1px solid ${color.borderStrong}`, background: color.surface, color: color.ink, fontSize: '12.5px', fontWeight: 500, padding: '6px 11px', borderRadius: '9px', cursor: 'pointer', textDecoration: 'none', display: 'inline-block' } as const;

function when(iso: string | null): string {
  if (!iso) return 'not researched yet';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'researched' : `researched ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

function Option({ o, title, onTry }: { o: OptionSnap; title: string; onTry?: (text: string) => void }) {
  const stars = o.rating !== null ? `${(o.rating / 20).toFixed(1)}/5` : null;
  const seller = o.handle ?? o.name;
  return (
    <div style={{ borderTop: `1px solid ${color.borderFaint}`, padding: '10px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'baseline', flexWrap: 'wrap' }}>
        <div style={{ fontSize: '14px', fontWeight: 600, letterSpacing: '-.01em' }}>
          {seller} <span style={{ fontWeight: 400, color: color.mutedStrong, fontSize: '12px' }}>· {SOURCE[o.source]}</span>
        </div>
        <span style={{ fontSize: '12px', color: color.mutedStrong }}>
          {o.label}
          {stars ? ` · ${stars}` : ''}
        </span>
      </div>
      <div style={{ fontSize: '13px', color: color.ink, marginTop: '3px' }}>
        {o.price ? <strong>{o.price.text}</strong> : o.source === 'store' ? null : <span style={{ color: color.mutedStrong }}>no price published</span>}
        {o.distanceKm !== null ? <span style={{ color: color.mutedStrong }}>{o.price ? ' · ' : ''}{o.distanceKm < 1 ? 'under 1 km away' : o.distanceKm < 10 ? `${o.distanceKm.toFixed(1)} km away` : `about ${Math.round(o.distanceKm)} km away`}</span> : null}
      </div>
      {o.note ? <div style={{ fontSize: '12px', lineHeight: 1.45, color: color.mutedStrong, marginTop: '4px' }}>{o.note}</div> : null}
      <div style={{ display: 'flex', gap: '7px', flexWrap: 'wrap', marginTop: '8px' }}>
        {o.whatsapp ? (
          <a href={o.whatsapp} target="_blank" rel="noopener noreferrer" style={small}>
            WhatsApp
          </a>
        ) : null}
        {o.source === 'store' && o.phone ? (
          <a href={`tel:${o.phone.replace(/[^d+]/g, '')}`} style={small}>
            Call
          </a>
        ) : null}
        {o.source === 'store' && o.mapsUrl ? (
          <a href={o.mapsUrl} target="_blank" rel="noopener noreferrer" style={small}>
            Directions
          </a>
        ) : null}
        {o.url ? (
          <a href={o.url} target="_blank" rel="noopener noreferrer" style={small}>
            {o.source === 'web' ? 'Open the page' : o.source === 'store' ? 'Website' : 'Open profile'}
          </a>
        ) : null}
        {o.source !== 'web' && o.source !== 'store' && onTry ? (
          <button onClick={() => onTry(payText(seller, title))} style={small} title="Starts the payment step: Pexa shows a Confirm card and nothing moves until you tap it.">
            Pay (you confirm)
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Item({ it, onTry }: { it: ShoppingItemView; onTry?: (text: string) => void }) {
  return (
    <div style={{ border: `1px solid ${color.border}`, background: color.surface, borderRadius: '14px', padding: '13px 15px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'baseline', flexWrap: 'wrap' }}>
        <div style={{ fontSize: '15.5px', fontWeight: 600, letterSpacing: '-.015em' }}>{it.title}</div>
        {it.targetText ? <span style={{ fontSize: '12.5px', color: color.mutedStrong }}>up to {it.targetText}</span> : null}
      </div>
      <div style={{ fontFamily: MONO, fontSize: '11px', color: color.faint, marginTop: '4px' }}>
        {it.place ? `${it.place} · ` : ''}
        {when(it.researchedAt)}
      </div>

      {it.changes.length ? (
        <ul style={{ margin: '9px 0 0', paddingLeft: '17px', fontSize: '12.5px', lineHeight: 1.5, color: color.ink }}>
          {it.changes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      ) : null}

      {it.options.length ? (
        <div style={{ marginTop: '8px' }}>
          {it.options.map((o) => (
            <Option key={`${o.source}:${o.handle ?? o.url ?? o.name}`} o={o} title={it.title} onTry={onTry} />
          ))}
        </div>
      ) : (
        <div style={{ fontSize: '12.5px', color: color.mutedStrong, marginTop: '9px' }}>No options yet. Tap “Find stores near me” for real shops with their reviews, “Find sellers online” for social sellers, or paste a product link and I’ll read its price.</div>
      )}

      {onTry ? (
        <div style={{ display: 'flex', gap: '7px', flexWrap: 'wrap', marginTop: '10px', paddingTop: '10px', borderTop: `1px solid ${color.borderFaint}` }}>
          <button onClick={() => onTry(storesText(it.title))} style={{ ...small, background: color.primary, color: '#fff', border: 'none' }} title="Searches Google Maps through Buy: about 4 cents from your wallet, after you approve.">
            {it.options.some((o) => o.source === 'store') ? 'Refresh the stores' : 'Find stores near me'}
          </button>
          <button onClick={() => onTry(researchText(it.title))} style={small} title="Searches social sellers through Buy: a few cents from your wallet, after you approve.">
            {it.options.some((o) => o.source !== 'web' && o.source !== 'store') ? 'Refresh the sellers' : 'Find sellers online'}
          </button>
          <button onClick={() => onTry(linkText(it.title))} style={small}>
            Add a product link
          </button>
          <button onClick={() => onTry(`I bought the ${it.title}`)} style={small}>
            I bought it
          </button>
          <button onClick={() => onTry(`Remove ${it.title} from my shopping list`)} style={small}>
            Remove
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function ShoppingListCard({ items, onTry }: { items: ShoppingItemView[]; onTry?: (text: string) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '9px', maxWidth: '480px' }}>
      <div style={{ border: `1px solid ${color.border}`, background: color.surface, borderRadius: '16px', padding: '14px 16px' }}>
        <div style={{ fontFamily: MONO, fontSize: '10.5px', letterSpacing: '.12em', color: color.faint }}>YOUR SHOPPING LIST</div>
        <div style={{ fontSize: '14px', lineHeight: 1.5, marginTop: '8px', color: color.ink }}>
          {items.length ? `${items.length} thing${items.length === 1 ? '' : 's'} you’re trying to buy. The options are a dated snapshot of what Pexa found when you last asked it to look.` : 'Nothing on your list yet. Tell me what you want to buy, like “I want to buy a MacBook Air”.'}
        </div>
      </div>
      {items.map((it) => (
        <Item key={it.id} it={it} onTry={onTry} />
      ))}
      <div style={{ fontSize: '12px', color: color.mutedStrong, lineHeight: 1.55, padding: '0 4px' }}>
        Pexa never pays a seller by itself. When you’re ready it shows a Confirm card and you decide. Crypto payments can’t be reversed, so start small and check the seller first.
      </div>
    </div>
  );
}
