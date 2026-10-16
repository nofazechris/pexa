import type { ResearchKind, ResearchRequest, ResearchSource } from './types';

const clean = (s: string, max: number) => s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** Tidy what the model proposed into a request, or say what's missing. Pure. */
export function normalizeRequest(input: { kind?: unknown; source?: unknown; what?: unknown; place?: unknown }): { ok: true; request: ResearchRequest } | { ok: false; message: string } {
  const kind: ResearchKind = input.kind === 'hire' ? 'hire' : 'vendors';
  const what = typeof input.what === 'string' ? clean(input.what, 80) : '';
  // "lagos" → "Lagos", "abuja nigeria" → "Abuja Nigeria".
  const place = typeof input.place === 'string' ? clean(input.place, 60).replace(/(^|\s)([a-z])/g, (_m, sp: string, c: string) => sp + c.toUpperCase()) : '';
  if (what.length < 2) return { ok: false, message: 'What are you looking for? For example “sneakers” or “a graphic designer”.' };
  if (!place) return { ok: false, message: 'Which city or area? Results are far better with a place, e.g. Lagos.' };
  // Sellers are found on Instagram. People to hire: LinkedIn for professionals, Instagram for trades and creators.
  const source: ResearchSource = kind === 'vendors' ? 'instagram' : input.source === 'instagram' ? 'instagram' : 'linkedin';
  return { ok: true, request: { kind, source, what, place } };
}
