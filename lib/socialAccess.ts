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
