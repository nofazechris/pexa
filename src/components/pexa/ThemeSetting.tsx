'use client';

import { useThemePref } from '@/components/theme/ThemeController';
import { color } from '@/lib/design/tokens';
import type { ThemePref } from '@/lib/theme';

const OPTIONS: Array<{ value: ThemePref; label: string }> = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Auto' },
];

/** Settings row: Light, Dark, or follow the phone. */
export function ThemeSetting() {
  const [pref, setPref] = useThemePref();
  return (
    <div style={{ background: color.surface, border: `1px solid ${color.border}`, borderRadius: '16px', padding: '16px 18px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: '15px', fontWeight: 600, letterSpacing: '-.015em' }}>Appearance</div>
        <div style={{ fontSize: '12.5px', color: color.mutedStrong, marginTop: '2px' }}>Auto follows your phone’s setting.</div>
      </div>
      <div role="radiogroup" aria-label="Appearance" style={{ display: 'flex', gap: '3px', background: color.neutral, borderRadius: '11px', padding: '3px' }}>
        {OPTIONS.map((o) => {
          const on = pref === o.value;
          return (
            <button
              key={o.value}
              role="radio"
              aria-checked={on}
              onClick={() => setPref(o.value)}
              style={{ border: 'none', background: on ? color.surface : 'transparent', color: on ? color.ink : color.mutedStrong, fontSize: '13px', fontWeight: on ? 600 : 450, padding: '7px 13px', borderRadius: '8px', cursor: 'pointer', boxShadow: on ? '0 1px 2px rgba(0,0,0,.12)' : 'none' }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
