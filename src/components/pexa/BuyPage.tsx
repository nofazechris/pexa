'use client';

import { useCallback, useEffect, useState } from 'react';
import { color } from '@/lib/design/tokens';
import type { BuyPurchaseView } from '@/components/auth/useBuy';
import { PurchaseRow, ReceiptSheet } from '@/components/pexa/BuyReceipts';
import { PAY_TOKENS, PAY_TOKEN_SYMBOLS, type PayTokenSymbol } from '@/lib/buy/tokens';

/**
 * The Buy screen: where a person stays in control of what their agent can spend. Three parts —
 * the guardrails (autonomous buying is OFF by default; a per-purchase limit and a daily budget when on),
 * a few one-tap requests that hand off to the chat agent, and the receipts for everything bought.
 */

const MONO = 'var(--font-geist-mono),monospace';

interface Spending {
  available: boolean;
  payToken: PayTokenSymbol;
  /** Formatted balance per token, or null when it couldn’t be read. */
  balances: Record<PayTokenSymbol, string | null>;
  autonomous: boolean;
  autoLimit: string;
  autoLimitAtomic: string;
  dailyBudget: string;
  dailyBudgetAtomic: string;
  spentToday: string;
  hardCap: string;
  walletBalance: string | null;
  canSignAutonomously: boolean;
}

const LIMIT_CHOICES: Array<{ label: string; atomic: string }> = [
  { label: '$0.05', atomic: '50000' },
  { label: '$0.10', atomic: '100000' },
  { label: '$0.25', atomic: '250000' },
  { label: '$0.50', atomic: '500000' },
  { label: '$1', atomic: '1000000' },
];
const BUDGET_CHOICES: Array<{ label: string; atomic: string }> = [
  { label: '$0.50', atomic: '500000' },
  { label: '$1', atomic: '1000000' },
  { label: '$2', atomic: '2000000' },
  { label: '$5', atomic: '5000000' },
];

const TRY_PROMPTS: Array<{ title: string; sub: string; text: string }> = [
  { title: 'Check before you pay', sub: 'Is this vendor legit? About 2¢', text: 'I’m about to pay someone I found online. Can you check whether they’re legit before I send money?' },
  { title: 'Research Reddit', sub: 'Live posts, paid per search', text: 'What is Reddit saying about Celo today?' },
  { title: 'Pulse on X', sub: 'What people are posting right now', text: 'What are people saying about stablecoins on X right now?' },
  { title: 'Run code in the cloud', sub: 'A fresh VM for about a cent', text: 'Run a script on a cloud VM that prints the current date and the machine’s CPU info.' },
  { title: 'See what you can buy', sub: 'Browse the marketplace', text: 'What can I buy on Buy? Show me the categories and some example prices.' },
];

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        border: `1px solid ${active ? color.primary : color.borderStrong}`,
        background: active ? color.primarySoft : color.surface,
        color: active ? color.primaryHover : color.ink,
        fontSize: '13px',
        fontWeight: 500,
        padding: '7px 12px',
        borderRadius: '999px',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

export function BuyPage({
  getAccessToken,
  onAsk,
}: {
  getAccessToken?: () => Promise<string | null>;
  /** Hand a request to the chat agent (switches to Chat). */
  onAsk: (text: string) => void;
}) {
  const [spending, setSpending] = useState<Spending | null>(null);
  const [purchases, setPurchases] = useState<BuyPurchaseView[]>([]);
  const [open, setOpen] = useState<BuyPurchaseView | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authed = useCallback(
    async (url: string, init?: RequestInit) => {
      const token = getAccessToken ? await getAccessToken() : null;
      return fetch(url, { ...init, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) }, cache: 'no-store' });
    },
    [getAccessToken],
  );

  const load = useCallback(async () => {
    try {
      const [sRes, pRes] = await Promise.all([authed('/api/buy/settings'), authed('/api/buy/purchases')]);
      if (sRes.ok) setSpending((await sRes.json()) as Spending);
      if (pRes.ok) setPurchases(((await pRes.json()) as { purchases: BuyPurchaseView[] }).purchases ?? []);
    } catch {
      /* keep what we have */
    }
  }, [authed]);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const id = setInterval(() => void load(), 10_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [load]);

  const save = async (patch: { autonomous?: boolean; autoLimitAtomic?: string; dailyBudgetAtomic?: string; payToken?: PayTokenSymbol }) => {
    setSaving(true);
    setError(null);
    try {
      const res = await authed('/api/buy/settings', { method: 'PUT', body: JSON.stringify(patch) });
      if (res.ok) setSpending((await res.json()) as Spending);
      else setError('Couldn’t save that. Please try again.');
    } catch {
      setError('Couldn’t save that. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const card = { background: color.surface, border: `1px solid ${color.border}`, borderRadius: '16px', padding: '18px' } as const;

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 'clamp(16px,2.6vw,28px) clamp(14px,2.6vw,26px) 48px' }}>
      <div style={{ maxWidth: '760px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '18px', animation: 'pp-fade .22s ease both' }}>
        <div>
          <div style={{ fontSize: '16px', fontWeight: 600, letterSpacing: '-.02em' }}>Buy</div>
          <div style={{ fontSize: '13.5px', color: color.muted, marginTop: '4px', lineHeight: 1.55, maxWidth: '560px' }}>
            Let your agent buy live data, a browser or cloud compute from Celo’s Buy marketplace — paid in USDC, within limits you set.
          </div>
        </div>

        {spending && !spending.available ? (
          <div style={{ ...card, background: '#FEFBF0', borderColor: color.warningDot, color: color.warning, fontSize: '13.5px', lineHeight: 1.55 }}>
            Buy runs on Celo mainnet only, and this account is on a test network — so buying is switched off here.
          </div>
        ) : null}

        {/* Which stablecoin pays */}
        <section style={card}>
          <div style={{ fontFamily: MONO, fontSize: '10.5px', letterSpacing: '.12em', color: color.faint }}>PAY WITH</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: '10px', marginTop: '12px' }}>
            {PAY_TOKEN_SYMBOLS.map((sym) => {
              const t = PAY_TOKENS[sym];
              const active = spending?.payToken === sym;
              const bal = spending?.balances?.[sym];
              return (
                <button
                  key={sym}
                  onClick={() => void save({ payToken: sym })}
                  disabled={saving || !spending?.available}
                  aria-pressed={active}
                  style={{ textAlign: 'left', border: `1px solid ${active ? color.primary : color.borderStrong}`, background: active ? color.primarySoft : color.surface, borderRadius: '13px', padding: '12px 13px', cursor: 'pointer' }}
                >
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                    <span style={{ fontSize: '15px', fontWeight: 600, letterSpacing: '-.01em', color: active ? color.primaryHover : color.ink }}>{sym}</span>
                    <span style={{ marginLeft: 'auto', fontFamily: MONO, fontSize: '12px', color: color.mutedStrong, fontVariantNumeric: 'tabular-nums' }}>{bal ?? '—'}</span>
                  </div>
                  <div style={{ fontSize: '12px', color: color.mutedStrong, marginTop: '4px', lineHeight: 1.45 }}>{t.blurb}</div>
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: '12px', color: color.faint, marginTop: '12px', lineHeight: 1.55 }}>
            Pexa pays in the one you pick. If it’s empty or a service doesn’t take it, Pexa uses another you hold — and always shows you which. To pay in USAT or USDT, send it on Celo to your Pexa wallet address (Wallet → Receive).
          </div>
        </section>

        {/* Guardrails */}
        <section style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ fontFamily: MONO, fontSize: '10.5px', letterSpacing: '.12em', color: color.faint }}>SPENDING LIMITS</div>
            {spending ? (
              <span style={{ marginLeft: 'auto', fontSize: '12.5px', color: color.mutedStrong }}>
                {spending.spentToday} spent today · {spending.walletBalance ?? '—'} in wallet
              </span>
            ) : null}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginTop: '14px' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '14.5px', fontWeight: 600 }}>Autonomous buying</div>
              <div style={{ fontSize: '13px', color: color.mutedStrong, lineHeight: 1.5, marginTop: '3px' }}>
                {spending?.autonomous ? 'Pexa can buy small things without asking, up to the limits below.' : 'Off — Pexa asks you to approve every purchase.'}
              </div>
            </div>
            <button
              role="switch"
              aria-checked={Boolean(spending?.autonomous)}
              aria-label="Autonomous buying"
              disabled={!spending || saving || !spending.available}
              onClick={() => spending && void save({ autonomous: !spending.autonomous })}
              style={{ marginLeft: 'auto', flex: 'none', width: 46, height: 27, borderRadius: 999, border: 'none', cursor: 'pointer', background: spending?.autonomous ? color.primary : '#CBD1DB', position: 'relative', transition: 'background .15s' }}
            >
              <span style={{ position: 'absolute', top: 3, left: spending?.autonomous ? 22 : 3, width: 21, height: 21, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
            </button>
          </div>

          {spending?.autonomous && !spending.canSignAutonomously ? (
            <div style={{ marginTop: '12px', border: `1px solid ${color.warningDot}`, background: '#FEFBF0', borderRadius: '11px', padding: '11px 13px', fontSize: '13px', color: color.warning, lineHeight: 1.5 }}>
              To buy on its own, Pexa needs permission to sign for your wallet — turn on <strong>Agent payments</strong> in Settings. Until then it will keep asking before it pays.
            </div>
          ) : null}

          <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: `1px solid ${color.borderFaint}` }}>
            <div style={{ fontSize: '13px', fontWeight: 500 }}>Largest purchase it can make on its own</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '9px' }}>
              {LIMIT_CHOICES.map((c) => (
                <Chip key={c.atomic} active={spending?.autoLimitAtomic === c.atomic} onClick={() => void save({ autoLimitAtomic: c.atomic })}>
                  {c.label}
                </Chip>
              ))}
            </div>
            <div style={{ fontSize: '13px', fontWeight: 500, marginTop: '16px' }}>Daily budget for automatic buys</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '9px' }}>
              {BUDGET_CHOICES.map((c) => (
                <Chip key={c.atomic} active={spending?.dailyBudgetAtomic === c.atomic} onClick={() => void save({ dailyBudgetAtomic: c.atomic })}>
                  {c.label}
                </Chip>
              ))}
            </div>
            <div style={{ fontSize: '12px', color: color.faint, marginTop: '14px', lineHeight: 1.55 }}>
              Anything above these limits always asks you first. Pexa will never spend more than {spending?.hardCap ?? '$5'} on a single purchase, even with your approval.
            </div>
          </div>
          {error ? <div style={{ marginTop: '10px', fontSize: '13px', color: color.danger }}>{error}</div> : null}
        </section>

        {/* Try it */}
        <section>
          <div style={{ fontSize: '14.5px', fontWeight: 600, letterSpacing: '-.01em', marginBottom: '10px' }}>Ask your agent</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: '10px' }}>
            {TRY_PROMPTS.map((p) => (
              <button
                key={p.title}
                onClick={() => onAsk(p.text)}
                style={{ textAlign: 'left', border: `1px solid ${color.border}`, background: color.surface, borderRadius: '14px', padding: '14px', cursor: 'pointer' }}
              >
                <div style={{ fontSize: '14.5px', fontWeight: 600, letterSpacing: '-.01em', color: color.ink }}>{p.title}</div>
                <div style={{ fontSize: '12.5px', color: color.mutedStrong, marginTop: '4px' }}>{p.sub}</div>
              </button>
            ))}
          </div>
        </section>

        {/* Receipts */}
        <section>
          <div style={{ fontSize: '14.5px', fontWeight: 600, letterSpacing: '-.01em', marginBottom: '10px' }}>Receipts</div>
          <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
            {purchases.length === 0 ? (
              <div style={{ padding: '20px 18px', fontSize: '13.5px', color: color.mutedStrong }}>Nothing bought yet. Ask your agent for something above.</div>
            ) : (
              purchases.map((p, i) => <PurchaseRow key={p.id} p={p} last={i === purchases.length - 1} onOpen={() => setOpen(p)} />)
            )}
          </div>
        </section>
      </div>
      <ReceiptSheet purchase={open} onClose={() => setOpen(null)} getAccessToken={getAccessToken} onAsk={onAsk} />
    </div>
  );
}
