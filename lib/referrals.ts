export const REFERRAL_ATTRIBUTION_DAYS = 30;

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
