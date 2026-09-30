import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { env } from '@/lib/config';
import { normalizeReferralCode } from '@/lib/referrals/code';
import { waitlistStatusByCode } from '@/lib/referrals/service';
import { RedirectToLanding } from './RedirectToLanding';

/**
 * A person's share link: /r/<code>. Its job is the social preview — when the link is posted on X,
 * WhatsApp, Telegram, etc., the crawler reads these tags and shows the person's personal picture
 * ("I'm #12 on the Pexa waitlist") — then real visitors are forwarded to the landing page with the
 * referrer remembered. Always dynamic: the rank in the title/picture is read fresh.
 */
export const dynamic = 'force-dynamic';

/** Absolute origin for the preview URLs (og:image must be absolute). Configured site URL first. */
async function previewOrigin(): Promise<string> {
  if (env.NEXT_PUBLIC_SITE_URL) return env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, '');
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const { code: raw } = await params;
  const code = normalizeReferralCode(raw);
  const origin = await previewOrigin();

  let position: number | null = null;
  if (code) {
    try {
      position = (await waitlistStatusByCode(code))?.position ?? null;
    } catch {
      /* database hiccup: use the generic title/picture */
    }
  }

  const title = position ? `I'm #${position} on the Pexa waitlist` : 'Join me on Pexa';
  const description = 'Pexa is a new way to move money on-chain by just talking to an AI agent. Use my referral link to climb up the ranking.';
  const image = `${origin}/api/og/waitlist${code ? `?code=${encodeURIComponent(code)}` : ''}`;
  const url = `${origin}/r/${code ?? ''}`;

  return {
    title,
    description,
    // Share pages are for people and link previews, not search results.
    robots: { index: false, follow: true },
    openGraph: { type: 'website', siteName: 'Pexa', title, description, url, images: [{ url: image, width: 1200, height: 630, alt: title }] },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
}

export default async function ReferralSharePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <RedirectToLanding code={normalizeReferralCode(code)} />;
}
