import {
  contributionCalendarDate,
  type ContributionAgeAssessment,
} from "@/lib/contributionEligibility";
import { identityHandleStore } from "@/lib/identityHandleStore";
import {
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
  fullName?: string;
  sex?: PrivateIdentitySex;
  adultVerified?: true;
  contributionEligibleOn?: string;
  createdAt: string;
  updatedAt: string;
};

export type ContributionGate =
  | { status: "onboarding_required" }
  | { status: "age_required" }
  | { status: "underage"; eligibleOn: string }
  | { status: "eligible" };

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
  updateDetails(
    userId: string,
    details: { fullName?: unknown; sex?: unknown },
  ): Promise<PrivateIdentityRecord | null>;
  completeOnboarding(
    input: CompleteOnboardingInput,
  ): Promise<CompleteOnboardingResult>;
  recordAgeAssessment(
    userId: string,
    assessment: ContributionAgeAssessment,
    now?: number,
  ): Promise<PrivateIdentityRecord | null>;
  contributionGate(userId: string, now?: number): Promise<ContributionGate>;
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

function eligibilityDateHasArrived(
  record: PrivateIdentityRecord,
  now: number,
): boolean {
  return Boolean(
    !record.adultVerified &&
      record.contributionEligibleOn &&
      record.contributionEligibleOn <= contributionCalendarDate(now),
  );
}

function fromRow(row: Record<string, unknown>): PrivateIdentityRecord {
  return {
    ...(typeof row.full_name === "string" && row.full_name
      ? { fullName: row.full_name }
      : {}),
    ...(typeof row.sex === "string" && sexValues.has(row.sex)
      ? { sex: row.sex as PrivateIdentitySex }
      : {}),
    ...(row.adult_verified === true
      ? { adultVerified: true as const }
      : {}),
    ...(typeof row.contribution_eligible_on === "string" &&
    row.contribution_eligible_on
      ? { contributionEligibleOn: row.contribution_eligible_on }
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
  async read(userId, now = Date.now()) {
    const key = cleanUserId(userId);
    const record = memoryPrivateIdentities.get(key) ?? null;
    if (!record || !eligibilityDateHasArrived(record, now)) return record;
    return memoryPrivateIdentityStore.recordAgeAssessment(
      key,
      { ok: true, status: "adult" },
      now,
    );
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

  async recordAgeAssessment(userId, assessment, now = Date.now()) {
    const key = cleanUserId(userId);
    const profile = key ? await profileStore().getByUserId(key) : null;
    if (!profile || !assessment.ok) return null;
    const timestamp = new Date(now).toISOString();
    const previous = memoryPrivateIdentities.get(key);
    const record: PrivateIdentityRecord = {
      ...(previous ?? {}),
      ...(assessment.status === "adult"
        ? { adultVerified: true, contributionEligibleOn: undefined }
        : {
            adultVerified: undefined,
            contributionEligibleOn: assessment.eligibleOn,
          }),
      createdAt: previous?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    memoryPrivateIdentities.set(key, record);
    return record;
  },

  async contributionGate(userId, now = Date.now()) {
    const key = cleanUserId(userId);
    const profile = key ? await profileStore().getByUserId(key) : null;
    if (!profile) return { status: "onboarding_required" };
    const record = await memoryPrivateIdentityStore.read(key, now);
    if (record?.adultVerified) return { status: "eligible" };
    if (!record?.contributionEligibleOn) return { status: "age_required" };
    if (record.contributionEligibleOn > contributionCalendarDate(now)) {
      return {
        status: "underage",
        eligibleOn: record.contributionEligibleOn,
      };
    }
    await this.recordAgeAssessment(key, { ok: true, status: "adult" }, now);
    return { status: "eligible" };
  },
};

export const supabasePrivateIdentityStore: PrivateIdentityStore = {
  async read(userId, now = Date.now()) {
    const key = cleanUserId(userId);
    if (!key) return null;
    const { data, error } = await requireSupabaseAdmin()
      .from(TABLE)
      .select("*")
      .eq("user_id", key)
      .limit(1);
    if (error) throw new Error(error.message);
    const row = (data ?? [])[0];
    const record = row ? fromRow(row as Record<string, unknown>) : null;
    if (!record || !eligibilityDateHasArrived(record, now)) return record;
    return supabasePrivateIdentityStore.recordAgeAssessment(
      key,
      { ok: true, status: "adult" },
      now,
    );
  },

  async updateDetails(userId, details) {
    const key = cleanUserId(userId);
    if (!key) return null;
    const profile = await profileStore().getByUserId(key);
    if (!profile) return null;
    const row: Record<string, unknown> = {
      user_id: key,
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

  async recordAgeAssessment(userId, assessment, now = Date.now()) {
    const key = cleanUserId(userId);
    if (!key || !assessment.ok) return null;
    const profile = await profileStore().getByUserId(key);
    if (!profile) return null;
    const timestamp = new Date(now).toISOString();
    const row: Record<string, unknown> =
      assessment.status === "adult"
        ? {
            user_id: key,
            adult_verified: true,
            contribution_eligible_on: null,
            updated_at: timestamp,
          }
        : {
            user_id: key,
            adult_verified: false,
            contribution_eligible_on: assessment.eligibleOn,
            updated_at: timestamp,
          };
    const { data, error } = await requireSupabaseAdmin()
      .from(TABLE)
      .upsert(row, { onConflict: "user_id" })
      .select("*")
      .limit(1);
    if (error) throw new Error(error.message);
    const updated = (data ?? [])[0];
    return updated ? fromRow(updated as Record<string, unknown>) : null;
  },

  async contributionGate(userId, now = Date.now()) {
    const key = cleanUserId(userId);
    const profile = key ? await profileStore().getByUserId(key) : null;
    if (!profile) return { status: "onboarding_required" };
    const record = await supabasePrivateIdentityStore.read(key, now);
    if (record?.adultVerified) return { status: "eligible" };
    if (!record?.contributionEligibleOn) return { status: "age_required" };
    if (record.contributionEligibleOn > contributionCalendarDate(now)) {
      return {
        status: "underage",
        eligibleOn: record.contributionEligibleOn,
      };
    }
    await this.recordAgeAssessment(key, { ok: true, status: "adult" }, now);
    return { status: "eligible" };
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
