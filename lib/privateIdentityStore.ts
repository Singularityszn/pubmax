import { identityHandleStore } from "@/lib/identityHandleStore";
import {
  assessContributionAge,
  PRIVATE_IDENTITY_SEX_VALUES,
  type PrivateIdentitySex,
} from "@/lib/privateIdentity";
import { assessPubmaxxHandle } from "@/lib/pubmaxxIdentity";
import { profileStore } from "@/lib/profileStore";
import { requireSupabaseAdmin } from "@/lib/supabase";
import { selectStore } from "@/lib/storeBackend";
import { cleanText } from "@/lib/textClean";

export {
  PRIVATE_IDENTITY_SEX_VALUES,
  type PrivateIdentitySex,
} from "@/lib/privateIdentity";

export type PrivateIdentityRecord = {
  adultConfirmed?: true;
  contributionEligibleFrom?: string;
  fullName?: string;
  sex?: PrivateIdentitySex;
  createdAt: string;
  updatedAt: string;
};

export type CompleteOnboardingInput = {
  userId: string;
  handle: string;
  fullName?: unknown;
  sex?: unknown;
};

export type CompleteOnboardingResult =
  | {
      ok: true;
      profileId: string;
      handle: string;
      privateIdentity: PrivateIdentityRecord;
    }
  | {
      ok: false;
      code:
        | "invalid"
        | "reserved"
        | "taken"
        | "already_has_handle"
        | "storage";
      error: string;
    };

export type PrivateIdentityStore = {
  read(userId: string, now?: number): Promise<PrivateIdentityRecord | null>;
  erase(userId: string): Promise<void>;
  updateDetails(
    userId: string,
    details: { fullName?: unknown; sex?: unknown },
  ): Promise<PrivateIdentityRecord | null>;
  assessContributionAge(
    userId: string,
    dateOfBirth: unknown,
    now?: number,
  ): Promise<
    | { status: "adult" }
    | { status: "underage"; eligibleFrom: string }
    | { status: "invalid" }
    | { status: "missing" }
  >;
  completeOnboarding(
    input: CompleteOnboardingInput,
  ): Promise<CompleteOnboardingResult>;
};

const TABLE = "private_account_identities";
const MAX_FULL_NAME = 100;
const sexValues = new Set<string>(PRIVATE_IDENTITY_SEX_VALUES);

function cleanUserId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanFullName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return cleanText(value, MAX_FULL_NAME) || undefined;
}

function cleanSex(value: unknown): PrivateIdentitySex | undefined {
  return typeof value === "string" && sexValues.has(value)
    ? (value as PrivateIdentitySex)
    : undefined;
}

function fromRow(row: Record<string, unknown>): PrivateIdentityRecord {
  return {
    ...(row.adult_confirmed === true ? { adultConfirmed: true as const } : {}),
    ...(typeof row.contribution_eligible_from === "string"
      ? { contributionEligibleFrom: row.contribution_eligible_from }
      : {}),
    ...(typeof row.full_name === "string" && row.full_name
      ? { fullName: row.full_name }
      : {}),
    ...(typeof row.sex === "string" && sexValues.has(row.sex)
      ? { sex: row.sex as PrivateIdentitySex }
      : {}),
    createdAt:
      typeof row.created_at === "string" ? row.created_at : new Date(0).toISOString(),
    updatedAt:
      typeof row.updated_at === "string" ? row.updated_at : new Date(0).toISOString(),
  };
}

function claimError(
  code: unknown,
  error: unknown,
): Extract<CompleteOnboardingResult, { ok: false }> {
  const known =
    code === "invalid" ||
    code === "reserved" ||
    code === "taken" ||
    code === "already_has_handle"
      ? code
      : "storage";
  return {
    ok: false,
    code: known,
    error:
      typeof error === "string" && error
        ? error
        : "Profile storage is unavailable.",
  };
}

const memoryPrivateIdentities = new Map<string, PrivateIdentityRecord>();

export const memoryPrivateIdentityStore: PrivateIdentityStore = {
  async read(userId) {
    const key = cleanUserId(userId);
    return memoryPrivateIdentities.get(key) ?? null;
  },

  async erase(userId) {
    const key = cleanUserId(userId);
    if (key) memoryPrivateIdentities.delete(key);
  },

  async updateDetails(userId, details) {
    const key = cleanUserId(userId);
    const profile = key ? await profileStore().getByUserId(key) : null;
    const previous = key ? memoryPrivateIdentities.get(key) : null;
    if (!profile || !previous) return null;
    const record: PrivateIdentityRecord = {
      ...previous,
      updatedAt: new Date().toISOString(),
    };
    if ("fullName" in details) {
      const fullName = cleanFullName(details.fullName);
      if (fullName) record.fullName = fullName;
      else delete record.fullName;
    }
    if ("sex" in details) {
      const sex = cleanSex(details.sex);
      if (sex) record.sex = sex;
      else delete record.sex;
    }
    memoryPrivateIdentities.set(key, record);
    return record;
  },

  async assessContributionAge(userId, dateOfBirth, now = Date.now()) {
    const key = cleanUserId(userId);
    const previous = key ? memoryPrivateIdentities.get(key) : null;
    if (!previous) return { status: "missing" };
    if (previous.adultConfirmed) return { status: "adult" };
    if (previous.contributionEligibleFrom) {
      return {
        status: "underage",
        eligibleFrom: previous.contributionEligibleFrom,
      };
    }
    const assessment = assessContributionAge(dateOfBirth, now);
    if (assessment.status === "invalid") return assessment;
    const updated: PrivateIdentityRecord = {
      ...previous,
      ...(assessment.status === "adult"
        ? { adultConfirmed: true as const }
        : { contributionEligibleFrom: assessment.eligibleFrom }),
      updatedAt: new Date(now).toISOString(),
    };
    if (assessment.status === "adult") {
      delete updated.contributionEligibleFrom;
    } else {
      delete updated.adultConfirmed;
    }
    memoryPrivateIdentities.set(key, updated);
    return assessment;
  },

  async completeOnboarding(input) {
    const userId = cleanUserId(input.userId);
    const assessment = assessPubmaxxHandle(input.handle);
    if (!userId) return claimError("storage", null);
    if (!assessment.ok) return claimError(assessment.reason, assessment.error);
    const claimed = await identityHandleStore().claim(userId, assessment.handle);
    if (!claimed.ok) return claimError(claimed.code, claimed.error);

    const now = new Date().toISOString();
    const previous = memoryPrivateIdentities.get(userId);
    const privateIdentity: PrivateIdentityRecord = {
      ...(previous ?? {}),
      ...(cleanFullName(input.fullName)
        ? { fullName: cleanFullName(input.fullName) }
        : {}),
      ...(cleanSex(input.sex) ? { sex: cleanSex(input.sex) } : {}),
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    memoryPrivateIdentities.set(userId, privateIdentity);
    return {
      ok: true,
      profileId: claimed.profileId,
      handle: claimed.handle,
      privateIdentity,
    };
  },

};

export const supabasePrivateIdentityStore: PrivateIdentityStore = {
  async read(userId) {
    const key = cleanUserId(userId);
    if (!key) return null;
    const { data, error } = await requireSupabaseAdmin()
      .from(TABLE)
      .select("*")
      .eq("user_id", key)
      .limit(1);
    if (error) throw new Error(error.message);
    const row = (data ?? [])[0];
    return row ? fromRow(row as Record<string, unknown>) : null;
  },

  async erase(userId) {
    const key = cleanUserId(userId);
    if (!key) return;
    const { error } = await requireSupabaseAdmin()
      .from(TABLE)
      .delete()
      .eq("user_id", key);
    if (error) throw new Error(error.message);
  },

  async updateDetails(userId, details) {
    const key = cleanUserId(userId);
    if (!key) return null;
    const profile = await profileStore().getByUserId(key);
    if (!profile) return null;
    const current = await this.read(key);
    if (!current) return null;
    const row: Record<string, unknown> = {
      user_id: key,
      adult_confirmed: current.adultConfirmed ?? null,
      contribution_eligible_from: current.contributionEligibleFrom ?? null,
      updated_at: new Date().toISOString(),
    };
    if ("fullName" in details) {
      row.full_name = cleanFullName(details.fullName) ?? null;
    }
    if ("sex" in details) {
      row.sex = cleanSex(details.sex) ?? null;
    }
    const { data, error } = await requireSupabaseAdmin()
      .from(TABLE)
      .upsert(row, { onConflict: "user_id" })
      .select("*")
      .limit(1);
    if (error) throw new Error(error.message);
    const updated = (data ?? [])[0];
    return updated ? fromRow(updated as Record<string, unknown>) : null;
  },

  async assessContributionAge(userId, dateOfBirth, now = Date.now()) {
    const key = cleanUserId(userId);
    const current = key ? await this.read(key) : null;
    if (!current) return { status: "missing" };
    if (current.adultConfirmed) return { status: "adult" };
    if (current.contributionEligibleFrom) {
      return {
        status: "underage",
        eligibleFrom: current.contributionEligibleFrom,
      };
    }
    const assessment = assessContributionAge(dateOfBirth, now);
    if (assessment.status === "invalid") return assessment;
    const row = {
      user_id: key,
      adult_confirmed: assessment.status === "adult" ? true : null,
      contribution_eligible_from:
        assessment.status === "underage" ? assessment.eligibleFrom : null,
      updated_at: new Date(now).toISOString(),
    };
    const { error } = await requireSupabaseAdmin()
      .from(TABLE)
      .upsert(row, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    return assessment;
  },

  async completeOnboarding(input) {
    const userId = cleanUserId(input.userId);
    const assessment = assessPubmaxxHandle(input.handle);
    if (!userId) return claimError("storage", null);
    if (!assessment.ok) return claimError(assessment.reason, assessment.error);
    const { data, error } = await requireSupabaseAdmin().rpc(
      "complete_contributor_onboarding",
      {
        p_user_id: userId,
        p_handle: assessment.handle,
        p_full_name: cleanFullName(input.fullName) ?? null,
        p_sex: cleanSex(input.sex) ?? null,
      },
    );
    if (error) return claimError("storage", null);
    const result =
      data && typeof data === "object" && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : {};
    if (result.ok !== true) return claimError(result.code, result.error);
    const privateIdentity = await this.read(userId);
    if (!privateIdentity) return claimError("storage", null);
    return {
      ok: true,
      profileId: String(result.profile_id),
      handle: String(result.handle),
      privateIdentity,
    };
  },

};

export function privateIdentityStore(): PrivateIdentityStore {
  return selectStore(
    memoryPrivateIdentityStore,
    supabasePrivateIdentityStore,
  );
}

export function __resetMemoryPrivateIdentities(): void {
  memoryPrivateIdentities.clear();
}
