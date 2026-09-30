/**
 * Email templates. Pure functions returning { subject, html, text } so they're trivially testable and
 * carry no delivery concerns. All interpolated values are HTML-escaped.
 */

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

/** Escape text for safe inclusion in HTML (element content and double-quoted attributes). */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function waitlistWelcomeEmail(input: { position: number; total: number; link: string }): EmailContent {
  const { position, total } = input;
  const link = escapeHtml(input.link);
  const subject = `You're #${position} in line for Pexa`;
  const text = [
    `You're on the Pexa waitlist — #${position} of ${total}.`,
    '',
    'Pexa is a new way to move money on-chain by just talking to an AI agent. The app is launching soon, and we will email your early-access invite the moment it opens.',
    '',
    'Want to move up? Every friend who joins with your link jumps you ahead:',
    input.link,
    '',
    '— The Pexa team',
  ].join('\n');
  const html = `<!doctype html>
<html><body style="margin:0;background:#F6F7F9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0E1420;">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px;">
    <div style="font-size:20px;font-weight:700;letter-spacing:-.02em;color:#1B45D7;">Pexa</div>
    <div style="background:#fff;border:1px solid #E4E7EC;border-radius:16px;padding:28px;margin-top:16px;">
      <div style="font-size:13px;color:#5B6472;">You're on the waitlist</div>
      <div style="font-size:38px;font-weight:700;letter-spacing:-.04em;margin-top:6px;">#${position} <span style="font-size:15px;font-weight:500;color:#5B6472;letter-spacing:0;">of ${total} in line</span></div>
      <p style="font-size:15px;line-height:1.6;color:#5B6472;margin:16px 0 0;">Pexa is a new way to move money on-chain by just talking to an AI agent. The app is launching soon &mdash; we'll email your early-access invite the moment it opens.</p>
      <p style="font-size:15px;line-height:1.6;margin:20px 0 8px;"><strong>Want to move up?</strong> Every friend who joins with your link jumps you ahead:</p>
      <a href="${link}" style="display:block;word-break:break-all;background:#EDF1FE;border:1px solid #DDE3F6;border-radius:11px;padding:13px 14px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;color:#153AB4;text-decoration:none;">${link}</a>
    </div>
    <p style="font-size:12px;color:#8A93A5;margin:18px 4px 0;">You're receiving this because you joined the Pexa waitlist.</p>
  </div>
</body></html>`;
  return { subject, html, text };
}
