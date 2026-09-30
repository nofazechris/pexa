import 'server-only';
import { env } from '@/lib/config';
import type { EmailContent } from './templates';

/**
 * Transactional email via Resend's HTTP API (no SDK, no server of our own). Deliberately inert until
 * configured: with no RESEND_API_KEY / EMAIL_FROM this returns `{ sent: false, reason: 'not_configured' }`
 * and the app carries on. It never throws — a mail hiccup must not break the flow that triggered it
 * (e.g. joining the waitlist) — and failures are logged so they're visible in the host's logs.
 */

export type SendResult = { sent: true; id: string | null } | { sent: false; reason: 'not_configured' | 'rejected' | 'network' };

export function emailConfigured(): boolean {
  return Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
}

export async function sendEmail(to: string, content: EmailContent): Promise<SendResult> {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return { sent: false, reason: 'not_configured' };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject: content.subject, html: content.html, text: content.text }),
    });
    if (!res.ok) {
      // Log the provider's reason (e.g. unverified domain) but never the key or the recipient's address.
      console.error('[email] send rejected:', res.status, (await res.text().catch(() => '')).slice(0, 300));
      return { sent: false, reason: 'rejected' };
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { sent: true, id: data.id ?? null };
  } catch (e) {
    console.error('[email] send failed:', e instanceof Error ? e.message : e);
    return { sent: false, reason: 'network' };
  }
}
