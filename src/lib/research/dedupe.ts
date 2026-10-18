/**
 * The same shop often appears on several platforms. When two results share a phone number, WhatsApp number, email or their own
 * website, they are very likely one business: show it once, keep the better-rated page, and say where else it was found.
 * A shared NAME is never enough — plenty of unrelated shops are called "Lagos Kicks".
 *
 * Pure.
 */
import type { ResearchItem } from './types';

/** Link-in-bio and chat services say nothing about who owns a page, so a shared one proves nothing. */
const SHARED_HOSTS = /(^|\.)(linktr\.ee|bit\.ly|wa\.me|api\.whatsapp\.com|whatsapp\.com|instagram\.com|tiktok\.com|x\.com|twitter\.com|facebook\.com|fb\.me|youtube\.com|youtu\.be|t\.me|beacons\.ai|linkin\.bio|carrd\.co|lnk\.bio|wixsite\.com|business\.site|google\.com|goo\.gl)$/i;

const NAME: Record<string, string> = { instagram: 'Instagram', tiktok: 'TikTok', x: 'X', linkedin: 'LinkedIn' };

/** The things that identify an owner: long-enough phone digits, an email, a website host of their own. */
export function ownerKeys(item: Pick<ResearchItem, 'contact'>): string[] {
  const keys = new Set<string>();
  const c = item.contact;
  for (const raw of [c.tel, c.phone, c.whatsapp?.replace(/^.*wa\.me\//, '')]) {
    const digits = (raw ?? '').replace(/\D/g, '');
    // Compare the last 9 digits so "0801 111 2222" and "+234 801 111 2222" meet.
    if (digits.length >= 9) keys.add('tel:' + digits.slice(-9));
  }
  if (c.email) keys.add('mail:' + c.email.trim().toLowerCase());
  if (c.website) {
    try {
      const host = new URL(c.website).hostname.replace(/^www\./, '').toLowerCase();
      if (host && !SHARED_HOSTS.test(host)) keys.add('site:' + host);
    } catch {
      /* not a URL — ignore */
    }
  }
  return [...keys];
}

/**
 * Merge results that share an owner key. The kept result is the one with the higher rating (an unrated one never beats a rated
 * one); it gains a note naming the other pages. Order is otherwise preserved.
 */
export function mergeSameBusiness(items: readonly ResearchItem[]): ResearchItem[] {
  const out: (ResearchItem | null)[] = [...items];
  const rate = (i: ResearchItem) => i.rating?.overall ?? -1;
  for (let a = 0; a < out.length; a++) {
    for (let b = a + 1; b < out.length; b++) {
      const x = out[a];
      const y = out[b];
      if (!x || !y || x.platform === y.platform) continue;
      const ky = new Set(ownerKeys(y));
      if (!ownerKeys(x).some((k) => ky.has(k))) continue;
      const [keep, drop] = rate(y) > rate(x) ? [y, x] : [x, y];
      const where = `${NAME[drop.platform] ?? drop.platform}${drop.handle ? ` (${drop.handle})` : ''}`;
      out[a] = { ...keep, signals: [...keep.signals, { tone: 'info', text: `Same phone, email or website also found on ${where}` }] };
      out[b] = null;
    }
  }
  return out.filter((i): i is ResearchItem => i !== null);
}
