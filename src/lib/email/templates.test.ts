import { describe, expect, it } from 'vitest';
import { escapeHtml, waitlistWelcomeEmail } from './templates';

describe('waitlistWelcomeEmail', () => {
  const email = waitlistWelcomeEmail({ position: 12, total: 340, link: 'https://pexaapp.xyz/?ref=abc23xyz' });

  it('tells the person their place in line, in the subject and both bodies', () => {
    expect(email.subject).toBe("You're #12 in line for Pexa");
    expect(email.text).toContain('#12 of 340');
    expect(email.html).toContain('#12');
    expect(email.html).toContain('of 340 in line');
  });

  it('includes their share link as text and as a link', () => {
    expect(email.text).toContain('https://pexaapp.xyz/?ref=abc23xyz');
    expect(email.html).toContain('href="https://pexaapp.xyz/?ref=abc23xyz"');
  });

  it('says the app is launching soon (early access), not that it is live', () => {
    expect(email.text.toLowerCase()).toContain('launching soon');
  });

  it('HTML-escapes the link so a hostile value cannot break out of the attribute', () => {
    const evil = waitlistWelcomeEmail({ position: 1, total: 1, link: 'https://x.test/?a="><script>alert(1)</script>' });
    expect(evil.html).not.toContain('<script'); // no live script tag anywhere
    expect(evil.html).not.toContain('"><script'); // the attribute-breakout attempt is defused
    // ...and the payload survives only in its escaped form, both in the href and the visible text.
    expect(evil.html).toContain('href="https://x.test/?a=&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"');
    expect(evil.html).toContain('>https://x.test/?a=&quot;&gt;&lt;script&gt;');
  });
});

describe('escapeHtml', () => {
  it('escapes the five significant characters', () => {
    expect(escapeHtml(`<a href="x">Tom & 'Jerry'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;');
  });
});
