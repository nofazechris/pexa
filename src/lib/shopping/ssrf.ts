/**
 * Before the server opens a web address a person gave it, make sure that address points at the public internet. Without this, a
 * link like http://169.254.169.254/ or http://localhost:3000/ would make Pexa's own server fetch things only it can reach. The
 * address is checked up front (scheme, port, no embedded password, no private or reserved IP written out), and every IP the name
 * resolves to — including after each redirect — is checked again where it is fetched. Pure.
 */

const BLOCKED_HOSTS = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain)$/i;

/** Private, loopback, link-local, carrier-grade NAT, multicast and reserved IPv4 ranges. */
export function isPublicIPv4(ip: string): boolean {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if ([a, Number(m[2]), Number(m[3]), Number(m[4])].some((n) => n > 255)) return false;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 168 || (b === 0 && Number(m[3]) === 0) || (b === 0 && Number(m[3]) === 2))) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51) return false;
  if (a === 203 && b === 0) return false;
  if (a >= 224) return false;
  return true;
}

export function isPublicIPv6(ip: string): boolean {
  const s = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (!s.includes(':')) return false;
  if (s === '::' || s === '::1') return false;
  const mapped = s.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return isPublicIPv4(mapped[1]);
  if (/^(fc|fd)/.test(s)) return false; // unique local
  if (/^fe[89ab]/.test(s)) return false; // link-local
  if (/^ff/.test(s)) return false; // multicast
  if (/^2001:db8/.test(s)) return false; // documentation
  return true;
}

export const isPublicIp = (ip: string) => (ip.includes(':') ? isPublicIPv6(ip) : isPublicIPv4(ip));

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

/** The up-front checks on a web address a person typed. */
export function checkUrl(raw: string): UrlCheck {
  const text = raw.trim();
  if (text.length > 600) return { ok: false, reason: 'That link is too long.' };
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return { ok: false, reason: 'That doesn’t look like a web link.' };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, reason: 'I can only open web links (http or https).' };
  if (u.username || u.password) return { ok: false, reason: 'I won’t open a link that has a password in it.' };
  if (u.port && u.port !== '80' && u.port !== '443') return { ok: false, reason: 'I only open ordinary web pages.' };
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!host.includes('.') && !host.includes(':')) return { ok: false, reason: 'That doesn’t look like a public web address.' };
  if (BLOCKED_HOSTS.test(host)) return { ok: false, reason: 'That address isn’t on the public internet, so I won’t open it.' };
  const literal = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
  if (literal && !isPublicIp(host)) return { ok: false, reason: 'That address isn’t on the public internet, so I won’t open it.' };
  // Numeric tricks for an IP (decimal, hex, octal) are not ordinary shop addresses.
  if (/^(0x[0-9a-f]+|\d+)$/i.test(host)) return { ok: false, reason: 'That doesn’t look like a shop address.' };
  return { ok: true, url: u };
}
