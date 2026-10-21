/**
 * Live evals talk to a real account. Investing questions now start with "get to know you" for someone who has no profile, so the
 * evals give the account a settled one for the run — and put the account back exactly as it was afterwards (a real profile is never
 * touched, and one we added is removed).
 */
export async function withSettledProfile<T>(userId: string, run: () => Promise<T>): Promise<T> {
  const { getInvestorProfile, saveInvestorProfile, resetInvestorProfile } = await import('@/lib/profile/service');
  const original = await getInvestorProfile(userId);
  const added = original === null;
  if (added) await saveInvestorProfile(userId, { risk: 'balanced', horizon: 'long', amountUsd: 500, skipped: false });
  try {
    return await run();
  } finally {
    if (added) await resetInvestorProfile(userId).catch(() => undefined);
  }
}
