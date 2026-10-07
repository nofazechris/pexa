import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/security/ratelimit';
import { withUser, errorResponse } from '@/lib/http';
import { validateUsername, usernameErrorMessage, normalizeUsername } from '@/lib/users/username';
import { isUsernameTaken, suggestUsernames } from '@/lib/users/service';

/**
 * Username availability check for onboarding. Requires a session (only signed-in users pick a
 * username, and it avoids anonymous enumeration). Returns validity + availability with a
 * message the UI can show inline.
 */
export async function GET(req: Request) {
  const auth = await withUser(req);
  if ('response' in auth) return auth.response;
  const tooMany = rateLimit('username-check', auth.user.userId, { max: 60, windowMs: 60000 });
  if (tooMany) return tooMany;

  const u = new URL(req.url).searchParams.get('u') ?? '';
  const formatError = validateUsername(u);
  if (formatError) {
    if (formatError === 'reserved') {
      const suggestions = await suggestUsernames(u).catch(() => []);
      return NextResponse.json({ available: false, reason: formatError, message: usernameErrorMessage(formatError), suggestions });
    }
    return NextResponse.json({ available: false, reason: formatError, message: usernameErrorMessage(formatError) });
  }
  try {
    const taken = await isUsernameTaken(u);
    if (!taken) {
      return NextResponse.json({ available: true, reason: null, message: 'Available' });
    }
    const suggestions = await suggestUsernames(u).catch(() => []);
    return NextResponse.json({ available: false, reason: 'taken', message: `@${normalizeUsername(u)} is already taken.`, suggestions });
  } catch (e) {
    return errorResponse(e);
  }
}
