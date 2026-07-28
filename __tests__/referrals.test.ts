import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  REFERRAL_GRANT_GATE,
  REFERRAL_MILESTONES,
  referralCaptureDecision,
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

  it("captures a referral fragment only after existing consent", () => {
    expect(
      referralCaptureDecision("#referral=opaque_code_123456789", false),
    ).toEqual({ clearHash: true, code: null });
    expect(
      referralCaptureDecision("#referral=opaque_code_123456789", true),
    ).toEqual({ clearHash: true, code: "opaque_code_123456789" });
    expect(referralCaptureDecision("#section", true)).toEqual({
      clearHash: false,
      code: null,
    });
  });

  it("serializes qualification before inserting and counting", () => {
    const migration = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20260728143000_0060_referrals.sql",
      ),
      "utf8",
    );
    const qualification = migration.slice(
      migration.indexOf(
        "create or replace function public.qualify_referral_from_contribution",
      ),
      migration.indexOf(
        "create or replace function public.read_private_referral_status",
      ),
    );
    expect(qualification.indexOf("pg_advisory_xact_lock")).toBeGreaterThan(-1);
    expect(qualification.indexOf("pg_advisory_xact_lock")).toBeLessThan(
      qualification.indexOf(
        "insert into public.referral_qualification_events",
      ),
    );
  });
});
