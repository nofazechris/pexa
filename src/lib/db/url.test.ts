import { describe, expect, it } from 'vitest';
import { serverlessDatabaseUrl } from './url';

const SESSION = 'postgresql://postgres.abcd:p%40ss@aws-0-eu-central-1.pooler.supabase.com:5432/postgres';
const on = { onVercel: true };

describe('serverlessDatabaseUrl', () => {
  it('switches the Supabase session pooler to transaction mode on Vercel, keeping credentials intact', () => {
    const out = new URL(serverlessDatabaseUrl(SESSION, on));
    expect(out.port).toBe('6543');
    expect(out.hostname).toBe('aws-0-eu-central-1.pooler.supabase.com');
    expect(out.username).toBe('postgres.abcd');
    expect(decodeURIComponent(out.password)).toBe('p@ss');
    expect(out.pathname).toBe('/postgres');
  });

  it('treats a URL with no port as the session port', () => {
    expect(new URL(serverlessDatabaseUrl('postgresql://u:p@aws-0-eu-central-1.pooler.supabase.com/postgres', on)).port).toBe('6543');
  });

  it('leaves everything else alone', () => {
    expect(serverlessDatabaseUrl(SESSION, { onVercel: false })).toBe(SESSION); // local dev, scripts, migrations
    expect(serverlessDatabaseUrl(SESSION, { onVercel: true, forceSession: true })).toBe(SESSION);
    const already = SESSION.replace(':5432', ':6543');
    expect(serverlessDatabaseUrl(already, on)).toBe(already);
    const direct = 'postgresql://postgres:p@db.abcd.supabase.co:5432/postgres';
    expect(serverlessDatabaseUrl(direct, on)).toBe(direct);
    const local = 'postgresql://u:p@localhost:5432/pexa';
    expect(serverlessDatabaseUrl(local, on)).toBe(local);
    expect(serverlessDatabaseUrl('not a url', on)).toBe('not a url');
  });
});
