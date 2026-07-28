const REFERRAL_CAPTURE_KEY = "referral";
const REFERRAL_CODE = /^[A-Za-z0-9_-]{20,80}$/;
export const REFERRAL_SIGNUP_PROOF_TTL_MS = 60 * 60 * 1_000;

export const REFERRAL_MILESTONES = [1, 3, 5] as const;
export type ReferralMilestone = (typeof REFERRAL_MILESTONES)[number];

export const REFERRAL_FEATURES = {
  1: "collaborative_night_credit",
  3: "continuing_memories",
  5: "post_trial_collaboration",
} as const satisfies Record<ReferralMilestone, string>;

export type ReferralFeature =
  (typeof REFERRAL_FEATURES)[ReferralMilestone];

export const REFERRAL_GRANT_GATE = {
  enabled: false,
  blockers: [
    "authenticated_contribution_identity",
    "person_level_self_referral_check",
  ],
} as const;

export type ReferralRewardEvent = {
  event: "milestone_earned" | "feature_granted";
  feature: ReferralFeature;
  milestone: ReferralMilestone;
  permanent: true;
};

export type ReferralSignupClaim = {
  code: string | null;
  cleanUrl: string;
};

export function isReferralCode(value: unknown): value is string {
  return typeof value === "string" && REFERRAL_CODE.test(value);
}

export function referralSignupClaimFromUrl(
  currentUrl: string,
): ReferralSignupClaim | null {
  try {
    const url = new URL(currentUrl);
    const params = new URLSearchParams(url.hash.replace(/^#/, ""));
    if (!params.has(REFERRAL_CAPTURE_KEY)) return null;
    const rawCode = params.get(REFERRAL_CAPTURE_KEY)?.trim() ?? "";
    params.delete(REFERRAL_CAPTURE_KEY);
    const remainingHash = params.toString();
    url.hash = remainingHash ? `#${remainingHash}` : "";
    return {
      code: isReferralCode(rawCode) ? rawCode : null,
      cleanUrl: `${url.pathname}${url.search}${url.hash}` || "/",
    };
  } catch {
    return null;
  }
}

export function referralFeatureForMilestone(
  milestone: ReferralMilestone,
): ReferralFeature {
  return REFERRAL_FEATURES[milestone];
}

/**
 * Only explicit feature_granted events can confer access. Current referral
 * machinery writes milestone_earned events only, and the closed grant gate
 * means this returns no referral features today.
 */
export function referralFeaturesGrantedBy(
  events: readonly ReferralRewardEvent[],
): ReferralFeature[] {
  if (!REFERRAL_GRANT_GATE.enabled) return [];
  return [...new Set(
    events
      .filter((event) => event.event === "feature_granted")
      .map((event) => event.feature),
  )];
}
