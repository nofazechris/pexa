import { ImageResponse } from 'next/og';
import { clientIp, rateLimit } from '@/lib/security/ratelimit';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { waitlistStatusByCode } from '@/lib/referrals/service';
import { normalizeReferralCode } from '@/lib/referrals/code';

/**
 * The personal share picture (1200x630, the size X/Twitter shows as a large preview card).
 * `/api/og/waitlist?code=<referral code>` renders "I'm #12 on the Pexa waitlist" for that person; an
 * unknown code, an app-user code, or any database hiccup renders the generic invite card instead, so a
 * shared link never shows a broken image. The `/r/<code>` page points its og:image / twitter:image here.
 */
export const dynamic = 'force-dynamic';

const INK = '#0E1420';
const MUTED = '#5B6472';
const PRIMARY = '#1B45D7';

let fontPromise: Promise<Buffer | null> | null = null;
function loadFont(): Promise<Buffer | null> {
  // Read once per server instance; if the file is missing the image still renders in the default font.
  fontPromise ??= readFile(join(process.cwd(), 'assets/fonts/Geist-SemiBold.ttf')).catch(() => null);
  return fontPromise;
}

/** The Pexa "P" mark (same strokes as public/favicon.svg). */
function Mark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="3.5 1.5 29 29" fill="none">
      <g stroke={PRIMARY} strokeWidth="3.8" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M12.4 5C12.2 12 11.4 19.6 9.6 27.6" />
        <path d="M16.8 5.5C22.2 4.7 26.8 6.9 26.5 10.2" />
        <path d="M25.9 14.6C25.3 17.6 21.2 19 16 18.3" />
      </g>
    </svg>
  );
}

export async function GET(req: Request) {
  const tooMany = rateLimit('og-waitlist', clientIp(req), { max: 60, windowMs: 60_000 });
  if (tooMany) return tooMany;
  const code = normalizeReferralCode(new URL(req.url).searchParams.get('code'));
  let position: number | null = null;
  let total: number | null = null;
  if (code) {
    try {
      const status = await waitlistStatusByCode(code);
      if (status) {
        position = status.position;
        total = status.total;
      }
    } catch {
      /* database unavailable: fall back to the generic card below */
    }
  }

  const font = await loadFont();
  const personal = position != null;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '52px 72px',
          background: 'linear-gradient(135deg, #FFFFFF 0%, #F4F6FE 55%, #DDE3F6 100%)',
          color: INK,
          fontFamily: font ? 'Geist' : 'sans-serif',
          fontWeight: 600,
        }}
      >
        {/* top bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <Mark size={56} />
            <div style={{ display: 'flex', marginLeft: 16, fontSize: 40, letterSpacing: -1 }}>Pexa</div>
          </div>
          <div style={{ display: 'flex', fontSize: 24, letterSpacing: 3, color: PRIMARY, border: `2px solid ${PRIMARY}`, borderRadius: 999, padding: '10px 22px' }}>
            {personal ? 'WAITLIST' : 'INVITE'}
          </div>
        </div>

        {/* headline */}
        {personal ? (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', fontSize: 38, color: MUTED }}>I&apos;m</div>
            <div style={{ display: 'flex', alignItems: 'baseline' }}>
              <div style={{ display: 'flex', fontSize: 168, lineHeight: 1, letterSpacing: -6, color: PRIMARY }}>#{position}</div>
              {total ? <div style={{ display: 'flex', marginLeft: 24, fontSize: 34, color: MUTED }}>of {total} in line</div> : null}
            </div>
            <div style={{ display: 'flex', fontSize: 50, letterSpacing: -1.2, marginTop: 4 }}>on the Pexa waitlist</div>
            <div style={{ display: 'flex', fontSize: 29, color: MUTED, marginTop: 14 }}>Use my referral link to climb up the ranking.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', fontSize: 120, lineHeight: 1.05, letterSpacing: -4 }}>You&apos;re invited.</div>
            <div style={{ display: 'flex', fontSize: 40, color: MUTED, marginTop: 24 }}>Pexa — the AI agent for your money on-chain.</div>
          </div>
        )}

        {/* footer */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 25, color: MUTED }}>
          <div style={{ display: 'flex' }}>pexaapp.xyz</div>
          <div style={{ display: 'flex' }}>Talk to your money. Settles on Celo.</div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      ...(font ? { fonts: [{ name: 'Geist', data: font, weight: 600 as const, style: 'normal' as const }] } : {}),
      headers: {
        // Short cache: rank changes as friends join, but X caches the card itself anyway.
        'cache-control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=3600',
      },
    },
  );
}
