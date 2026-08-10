import { accountIsAdult } from "@/lib/socialLaunch";

export type SocialAccessState =
  | "preview"
  | "sign_in_required"
  | "age_verification_required"
  | "verified"
  | "suspended";

export type SocialProductAccount = {
  id: string;
  clerkUserId: string;
  ownershipState: "active" | "suspended";
};

export type SocialAdultVerification = {
  productAccountId: string;
  provider: "yoti";
  decision: "verified_adult" | "not_verified";
  auditState: "current" | "revoked" | "superseded";
  verifiedAt: string;
  expiresAt: string;
};

export type SocialAccessInput = {
  betaEnabled: boolean;
  clerkUserId: string | null;
  account: SocialProductAccount | null;
  verification: SocialAdultVerification | null;
  now: string | Date;
};

export const SOCIAL_BETA_DISABLED = {
  ok: false,
  status: 403,
  code: "SOCIAL_BETA_DISABLED",
  error: "Social account migration is not available in preview.",
} as const;

export function isSocialInviteBetaEnabled(value: string | undefined): boolean {
  return value === "1";
}

export type FriendsLaunchSocialAccessInput = {
  friendsLaunchEnabled: boolean;
  supabaseUserId: string | null;
  claimedHandle: string | null;
  dateOfBirth: string | null;
  /** When the account tapped "I'm 18 or over" (migration 0103), or null. */
  adultSelfAssertedAt?: string | null;
  ownershipState: "active" | "suspended" | null;
  now: string | Date;
};

export function decideFriendsLaunchSocialAccess(
  input: FriendsLaunchSocialAccessInput,
): SocialAccessState {
  if (!input.friendsLaunchEnabled) return "preview";
  if (!input.supabaseUserId) return "sign_in_required";
  if (input.ownershipState === "suspended") return "suspended";
  const handle = input.claimedHandle?.trim() ?? "";
  if (!handle) return "age_verification_required";
  const now =
    input.now instanceof Date ? input.now.getTime() : Date.parse(input.now);
  if (!Number.isFinite(now)) return "age_verification_required";
  // ONE gate for the age question: a stored adult date of birth or a recorded
  // one-tap self-assertion. `lib/socialLaunch.ts` owns which of them decides.
  if (
    !accountIsAdult(
      {
        dateOfBirth: input.dateOfBirth,
        adultSelfAssertedAt: input.adultSelfAssertedAt ?? null,
      },
      now,
    )
  ) {
    return "age_verification_required";
  }
  return "verified";
}

function validTime(value: string): number | null {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

export function decideSocialAccess(input: SocialAccessInput): SocialAccessState {
  if (!input.betaEnabled) return "preview";
  if (!input.clerkUserId) return "sign_in_required";
  if (input.account?.ownershipState === "suspended") return "suspended";
  if (!input.account || input.account.clerkUserId !== input.clerkUserId) {
    return "age_verification_required";
  }

  const now =
    input.now instanceof Date ? input.now.getTime() : Date.parse(input.now);
  const verifiedAt = input.verification
    ? validTime(input.verification.verifiedAt)
    : null;
  const expiresAt = input.verification
    ? validTime(input.verification.expiresAt)
    : null;
  const verificationIsCurrent =
    input.verification?.productAccountId === input.account.id &&
    input.verification.provider === "yoti" &&
    input.verification.decision === "verified_adult" &&
    input.verification.auditState === "current" &&
    Number.isFinite(now) &&
    verifiedAt !== null &&
    expiresAt !== null &&
    verifiedAt <= now &&
    expiresAt > now;

  return verificationIsCurrent ? "verified" : "age_verification_required";
}
