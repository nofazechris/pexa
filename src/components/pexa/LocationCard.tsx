'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { color } from '@/lib/design/tokens';
import { locationHelp } from '@/lib/geo/approx';

/**
 * Shown when the assistant asks where the person is. It tries the easy ways first and only asks for work when it has to:
 *   1. If the browser still allows asking, it asks for the position straight away (the browser shows its own prompt).
 *   2. Without any permission, it suggests the city the connection points to — one tap to confirm.
 *   3. If location was blocked for this site (browsers never let a page re-ask), it shows the shortest way to switch it on
 *      and carries on by itself the moment it is allowed.
 * Only an AREA NAME (like "Yaba, Lagos") is ever used — never coordinates — and nothing is stored. Typing a city always works.
 */

const CITIES = ['Lagos', 'Abuja', 'Port Harcourt', 'Nairobi', 'Accra'];

type Perm = 'unknown' | 'prompt' | 'granted' | 'denied';
type Phase = 'idle' | 'locating' | 'done' | 'failed';

function Crosshair({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2.5v3.2M12 18.3v3.2M2.5 12h3.2M18.3 12h3.2" />
    </svg>
  );
}

function Chevron() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function Check() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

export function AskLocationCard({ onShare, getAccessToken }: { onShare: (label: string) => void; getAccessToken?: () => Promise<string | null> }) {
  const [perm, setPerm] = useState<Perm>('unknown');
  const [phase, setPhase] = useState<Phase>('idle');
  const [label, setLabel] = useState('');
  const [guess, setGuess] = useState<string | null>(null);
  const triedRef = useRef(false);

  const authed = useCallback(
    async (url: string, init?: RequestInit) => {
      const token = await getAccessToken?.();
      return fetch(url, { ...init, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) } });
    },
    [getAccessToken],
  );

  const choose = useCallback(
    (area: string) => {
      setLabel(area);
      setPhase('done');
      onShare(area);
    },
    [onShare],
  );

  /** The exact way: ask the browser for the position (it shows its own prompt), turn it into an area name on the server. */
  const locate = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setPhase('failed');
      return;
    }
    triedRef.current = true;
    setPhase('locating');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await authed('/api/geo/reverse', { method: 'POST', body: JSON.stringify({ lat: pos.coords.latitude, lon: pos.coords.longitude }) });
          const data = (await res.json().catch(() => ({}))) as { label?: string };
          if (res.ok && data.label) choose(data.label);
          else setPhase('failed');
        } catch {
          setPhase('failed');
        }
      },
      (err) => {
        if (err.code === 1) setPerm('denied');
        setPhase(err.code === 1 ? 'idle' : 'failed');
      },
      { enableHighAccuracy: false, timeout: 12_000, maximumAge: 300_000 },
    );
  }, [authed, choose]);

  // What does the browser say about location for this site? Keep listening: if it gets switched on, carry on by ourselves.
  useEffect(() => {
    let status: PermissionStatus | null = null;
    let alive = true;
    try {
      void navigator.permissions
        ?.query({ name: 'geolocation' })
        .then((s) => {
          if (!alive) return;
          status = s;
          setPerm(s.state as Perm);
          s.onchange = () => setPerm(s.state as Perm);
        })
        .catch(() => undefined);
    } catch {
      /* no Permissions API: the button still works */
    }
    return () => {
      alive = false;
      if (status) status.onchange = null;
    };
  }, []);

  // A rough city from the connection — no permission needed.
  useEffect(() => {
    let alive = true;
    void authed('/api/geo/approx')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { label?: string } | null) => {
        if (alive && d?.label) setGuess(d.label);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [authed]);

  // Allowed (or still askable): ask for the position ourselves instead of waiting for a tap. Blocked: forget, so it retries once allowed.
  useEffect(() => {
    if (perm === 'denied') {
      triedRef.current = false;
      return;
    }
    if ((perm === 'granted' || perm === 'prompt') && !triedRef.current && phase === 'idle') {
      const t = setTimeout(locate, 350);
      return () => clearTimeout(t);
    }
  }, [perm, phase, locate]);

  const blocked = perm === 'denied';
  const help = blocked ? locationHelp(typeof navigator === 'undefined' ? '' : navigator.userAgent) : null;
  const card = { border: `1px solid ${color.border}`, background: color.surface, borderRadius: '16px', padding: '16px', maxWidth: '400px' } as const;

  if (phase === 'done') {
    return (
      <div style={{ ...card, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: '9px', fontSize: '14px', color: color.ink }}>
        <span style={{ color: color.success, display: 'inline-flex' }}>
          <Check />
        </span>
        <span>
          Looking near <strong>{label}</strong>
        </span>
      </div>
    );
  }

  const row = { display: 'flex', alignItems: 'center', gap: '10px', width: '100%', textAlign: 'left', border: `1px solid ${color.borderStrong}`, background: color.surface, color: color.ink, borderRadius: '12px', padding: '11px 13px', cursor: 'pointer', fontSize: '14.5px', fontWeight: 500 } as const;

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '11px' }}>
        <span style={{ width: 38, height: 38, flexShrink: 0, borderRadius: '12px', background: color.primarySoft, color: color.primary, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <Crosshair size={19} />
        </span>
        <div>
          <div style={{ fontSize: '15.5px', fontWeight: 600, letterSpacing: '-.01em' }}>Where are you?</div>
          <div style={{ fontSize: '12.5px', color: color.mutedStrong, marginTop: '2px' }}>So I can find the closest ones.</div>
        </div>
      </div>

      {phase === 'locating' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '9px', marginTop: '14px', fontSize: '13.5px', color: color.mutedStrong }}>
          <span style={{ width: 13, height: 13, border: `2px solid ${color.primarySoftBorder}`, borderTopColor: color.primary, borderRadius: '50%', animation: 'pp-spin .8s linear infinite', display: 'inline-block', flexShrink: 0 }} />
          Waiting for your location… allow it in the browser prompt.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '14px' }}>
          {guess ? (
            <button onClick={() => choose(guess)} style={{ ...row, borderColor: color.primarySoftBorder, background: color.primaryTint }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block' }}>{guess}</span>
                <span style={{ display: 'block', fontSize: '11.5px', color: color.faint, fontWeight: 400, marginTop: '2px' }}>From your connection — tap if that’s right</span>
              </span>
              <span style={{ color: color.primary, display: 'inline-flex' }}>
                <Chevron />
              </span>
            </button>
          ) : null}
          {!blocked ? (
            <button onClick={locate} style={{ ...row, justifyContent: 'center', background: color.primary, borderColor: color.primary, color: '#fff' }}>
              <Crosshair />
              Use my exact area
            </button>
          ) : null}
        </div>
      )}

      {blocked && phase !== 'locating' && help ? (
        <div style={{ marginTop: '12px', border: `1px solid ${color.warningBorder}`, background: color.warningTint, borderRadius: '12px', padding: '12px 13px' }}>
          <div style={{ fontSize: '13.5px', fontWeight: 600, color: color.warning }}>{help.title}</div>
          <ol style={{ margin: '8px 0 0', paddingLeft: '18px', listStyle: 'decimal', fontSize: '12.5px', lineHeight: 1.55, color: color.mutedStrong }}>
            {help.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <button onClick={locate} style={{ marginTop: '10px', border: `1px solid ${color.borderStrong}`, background: color.surface, color: color.ink, fontSize: '13px', fontWeight: 500, padding: '7px 12px', borderRadius: '10px', cursor: 'pointer' }}>
            I’ve turned it on — try again
          </button>
        </div>
      ) : null}

      {phase === 'failed' ? <div style={{ fontSize: '12.5px', color: color.warning, marginTop: '10px', lineHeight: 1.5 }}>I couldn’t work out your area from that. Pick a city below or type it.</div> : null}

      {phase !== 'locating' ? (
        <div style={{ marginTop: '14px' }}>
          <div style={{ fontSize: '11.5px', color: color.faint, marginBottom: '7px' }}>Or pick a city</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px' }}>
            {CITIES.map((c) => (
              <button key={c} onClick={() => choose(c)} style={{ border: `1px solid ${color.border}`, background: color.neutral, color: color.ink, fontSize: '13px', padding: '6px 11px', borderRadius: '9px', cursor: 'pointer' }}>
                {c}
              </button>
            ))}
          </div>
          <div style={{ fontSize: '11.5px', color: color.faint, marginTop: '11px', lineHeight: 1.5 }}>Only an area name is used — never your exact position — and it isn’t stored. You can also just type it.</div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * A few options as buttons (which platform to search, for instance). Tapping one sends its text as the person's next message — the
 * same as typing it — so a card that was never tapped, or a chat reopened later, loses nothing. An option can carry a hint (what
 * Pexa has learned about it) and a "Best so far" tag when the evidence clearly favours it.
 */
export function ChoiceCard({ options, onPick }: { options: { label: string; text: string; hint?: string; recommended?: boolean }[]; onPick: (text: string) => void }) {
  const [picked, setPicked] = useState<string | null>(null);
  const hasHints = options.some((o) => o.hint || o.recommended);
  return (
    <div style={{ display: 'flex', flexDirection: hasHints ? 'column' : 'row', flexWrap: 'wrap', gap: '8px', maxWidth: '400px' }}>
      {options.map((o) => {
        const on = picked === o.label;
        return (
          <button
            key={o.label}
            disabled={picked !== null}
            onClick={() => {
              setPicked(o.label);
              onPick(o.text);
            }}
            style={{ textAlign: 'left', border: `1px solid ${on ? color.primary : o.recommended ? color.primarySoftBorder : color.borderStrong}`, background: on ? color.primarySoft : o.recommended ? color.primaryTint : color.surface, color: on ? color.primary : color.ink, fontSize: '14px', fontWeight: 500, padding: hasHints ? '10px 14px' : 'var(--pp-btn-y) 16px', borderRadius: '11px', cursor: picked ? 'default' : 'pointer', opacity: picked && !on ? 0.5 : 1 }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {o.label}
              {o.recommended ? <span style={{ fontSize: '10.5px', fontWeight: 600, letterSpacing: '.04em', color: color.primary, background: color.primarySoft, borderRadius: '6px', padding: '2px 6px' }}>BEST SO FAR</span> : null}
            </span>
            {o.hint ? <span style={{ display: 'block', fontSize: '11.5px', fontWeight: 400, color: color.faint, marginTop: '2px' }}>{o.hint}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
