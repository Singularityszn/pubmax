import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  REFERRAL_GRANT_GATE,
  REFERRAL_MILESTONES,
  referralFeatureForMilestone,
  referralFeaturesGrantedBy,
} from "@/lib/referrals";

describe("referral reward policy", () => {
  it("records approved 1, 3 and 5 referral milestones as permanent rewards", () => {
    expect(REFERRAL_MILESTONES).toEqual([1, 3, 5]);
    expect(REFERRAL_MILESTONES.map(referralFeatureForMilestone)).toEqual([
      "collaborative_night_credit",
      "continuing_memories",
      "post_trial_collaboration",
    ]);
  });

  it("keeps every grant closed until both identity blockers are removed", () => {
    expect(REFERRAL_GRANT_GATE).toEqual({
      enabled: false,
      blockers: [
        "authenticated_contribution_identity",
        "person_level_self_referral_check",
      ],
    });

    expect(
      referralFeaturesGrantedBy([
        {
          event: "milestone_earned",
          feature: "collaborative_night_credit",
          milestone: 1,
          permanent: true,
        },
      ]),
    ).toEqual([]);

    const migration = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20260728143000_0060_referrals.sql",
      ),
      "utf8",
    );
    expect(migration).toMatch(/referral_grant_insert_gate/);
    expect(migration).toMatch(/is distinct from 'on'/);
    expect(migration).toMatch(/referral feature grants are disabled/);
  });
});
