'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { color } from '@/lib/design/tokens';

/**
 * Sends a visitor who opened a share link (/r/<code>) on to the landing page, which remembers the
 * referrer's code. Crawlers (X, WhatsApp, iMessage…) don't run this — they read the preview tags the
 * server rendered on this same page — so the personal picture still shows when the link is shared.
 */
export function RedirectToLanding({ code }: { code: string | null }) {
  const router = useRouter();
  const target = code ? `/?ref=${encodeURIComponent(code)}` : '/';

  useEffect(() => {
    router.replace(target);
  }, [router, target]);

  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', background: color.background, color: color.ink, padding: 24, textAlign: 'center' }}>
      <div>
        <div style={{ fontSize: 15, color: color.muted }}>Taking you to Pexa…</div>
        <a href={target} style={{ display: 'inline-block', marginTop: 12, fontSize: 14, color: color.primary, textDecoration: 'underline' }}>
          Continue
        </a>
      </div>
    </main>
  );
}
