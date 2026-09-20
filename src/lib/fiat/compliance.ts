import 'server-only';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { getFiatProvider } from './index';
import type { KycState } from './provider';

/**
 * Compliance sync (§23). The AgentPolicyEngine gates on the DB `compliance_profiles.kyc_status`,
 * which is the local source of truth. This module keeps that row in step with the provider's KYC
 * state (fetched here, and — later — updated by provider webhooks). Nothing here can be driven by
 * the LLM; it only mirrors the provider.
 */

export interface ComplianceStatus {
  kycStatus: KycState;
  provider: string;
  providerCustomerId: string | null;
  blocked: boolean;
}

/** Fetch the current KYC state from the provider and upsert the user's compliance profile. */
export async function syncComplianceProfile(userId: string): Promise<ComplianceStatus> {
  const provider = getFiatProvider();
  const db = getDb();

  const existing = await db
    .select()
    .from(schema.complianceProfiles)
    .where(eq(schema.complianceProfiles.userId, userId))
    .limit(1);
  const providerCustomerId = existing[0]?.providerCustomerId ?? null;

  const kycStatus = await provider.getKycStatus(providerCustomerId);

  if (existing[0]) {
    await db
      .update(schema.complianceProfiles)
      .set({ kycStatus, provider: provider.id, updatedAt: new Date() })
      .where(eq(schema.complianceProfiles.userId, userId));
  } else {
    await db
      .insert(schema.complianceProfiles)
      .values({ userId, provider: provider.id, providerCustomerId, kycStatus });
  }

  return { kycStatus, provider: provider.id, providerCustomerId, blocked: Boolean(existing[0]?.riskFlags) };
}

/** Read the stored compliance status without contacting the provider. */
export async function getComplianceStatus(userId: string): Promise<ComplianceStatus | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.complianceProfiles)
    .where(eq(schema.complianceProfiles.userId, userId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    kycStatus: row.kycStatus as KycState,
    provider: row.provider,
    providerCustomerId: row.providerCustomerId,
    blocked: Boolean(row.riskFlags),
  };
}
