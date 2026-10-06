/**
 * Which database URL the running app should connect with.
 *
 * Supabase serves two poolers on one host: SESSION mode (port 5432) keeps one real database connection per
 * client connection and is capped at the pool size (15 here) — a serverless app that fans out parallel
 * requests blows through that ("EMAXCONNSESSION: max clients reached") and every request fails with
 * "temporarily unavailable". TRANSACTION mode (port 6543) shares connections between transactions and is
 * built for exactly this. The app already runs with `prepare: false`, which transaction mode requires.
 *
 * On Vercel we therefore use transaction mode automatically; a URL that already names another port, a
 * non-pooler host, local development and migrations (drizzle-kit reads the URL itself) are left alone.
 */

export function serverlessDatabaseUrl(url: string, opts: { onVercel: boolean; forceSession?: boolean }): string {
  if (!opts.onVercel || opts.forceSession) return url;
  try {
    const u = new URL(url);
    const isSupabasePooler = u.hostname.endsWith('.pooler.supabase.com');
    const isSessionPort = u.port === '' || u.port === '5432';
    if (!isSupabasePooler || !isSessionPort) return url;
    u.port = '6543';
    return u.toString();
  } catch {
    return url;
  }
}
