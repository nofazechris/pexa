'use client';

import { useCallback, useState } from 'react';
import { color } from '@/lib/design/tokens';
import { shareUrls } from '@/lib/referrals/code';

/**
 * A copyable referral link with one-tap sharing (X, WhatsApp, Telegram, and the device's native share
 * sheet where available). Used on the landing page after joining the waitlist and in the app's
 * "Invite friends" card, so both surfaces behave identically.
 */
export function ShareLink({ link, text }: { link: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const urls = shareUrls(link, text);
  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const copy = useCallback(() => {
    const done = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(link).then(done, () => {});
  }, [link]);

  const nativeShare = useCallback(() => {
    navigator.share({ title: 'Pexa', text, url: link }).catch(() => {});
  }, [link, text]);

  const chip = {
    border: `1px solid ${color.borderStrong}`,
    background: color.surface,
    color: color.ink,
    fontSize: '13px',
    fontWeight: 500,
    padding: '8px 13px',
    borderRadius: '999px',
    cursor: 'pointer',
    textDecoration: 'none',
    display: 'inline-block',
  } as const;

  return (
    <div>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'stretch' }}>
        <div style={{ flex: 1, minWidth: 0, border: `1px solid ${color.primarySoftBorder}`, background: color.primarySoft, borderRadius: '11px', padding: '11px 13px', fontFamily: 'var(--font-geist-mono),monospace', fontSize: '12.5px', color: color.primaryHover, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {link}
        </div>
        <button onClick={copy} style={{ border: 'none', background: color.primary, color: '#fff', fontSize: '13.5px', fontWeight: 500, padding: '0 16px', borderRadius: '11px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '10px' }}>
        {canNativeShare ? (
          <button onClick={nativeShare} style={chip}>Share…</button>
        ) : null}
        <a href={urls.x} target="_blank" rel="noopener noreferrer" style={chip}>Post on X</a>
        <a href={urls.whatsapp} target="_blank" rel="noopener noreferrer" style={chip}>WhatsApp</a>
        <a href={urls.telegram} target="_blank" rel="noopener noreferrer" style={chip}>Telegram</a>
      </div>
    </div>
  );
}
