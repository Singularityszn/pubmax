import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const GRANDFATHERED_DUPLICATE_LABEL_FILES = {
  "0007": [
    "20260705214936_0007_function_search_path.sql",
    "20260706102502_0007_pub_presence.sql",
  ],
  "0013": [
    "20260707010745_0013_comment_replies.sql",
    "20260707053307_0013_comment_replies.sql",
  ],
  "0014": [
    "20260707010750_0014_realtime_publication.sql",
    "20260707053327_0014_realtime_publication.sql",
  ],
  "0015": [
    "20260707010941_0015_index_cleanup.sql",
    "20260707053355_0015_index_cleanup.sql",
  ],
  "0021": [
    "20260708230700_0021_pint_drop_last_train.sql",
    "20260709120000_0021_private_pint_drops_storage.sql",
  ],
  "0038": [
    "20260717065012_0038_plan_ending_selection.sql",
    "20260721000000_0038_night_contributor_withdrawn.sql",
  ],
  "0047": [
    "20260721130000_0047_cron_freshness_plane.sql",
    "20260721133000_0047_night_moment_alt_text.sql",
  ],
  "0059": [
    "20260728121000_0059_visit_report_review_lane.sql",
    "20260728140000_0059_contributor_leaderboard.sql",
  ],
  "0060": [
    "20260728130000_0060_community_venue_signals.sql",
    "20260728143000_0060_referrals.sql",
  ],
  "0070": [
    "20260806035204_0070_v1_release_security.sql",
    "20260806145644_0070_rate_limit_expiry.sql",
  ],
  "0123": [
    "20260828120000_0123_harvest_venue_overlays.sql",
    "20260829120000_0123_social_admin_moderation.sql",
  ],
  "0124": [
    "20260830120000_0124_social_admin_revision_guard.sql",
    "20260830170000_0124_plan_invite_canonical_membership.sql",
  ],
} as const;

function duplicateLabelFiles(
  migrations: readonly string[],
): Record<string, string[]> {
  const filesByLabel = new Map<string, string[]>();

  for (const name of [...migrations].sort()) {
    const label = name.match(/^\d{14}_(\d{4})_/)?.[1];
    if (!label) continue;
    filesByLabel.set(label, [...(filesByLabel.get(label) ?? []), name]);
  }

  return Object.fromEntries(
    [...filesByLabel.entries()]
      .filter(([, files]) => files.length > 1)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

describe("Supabase migration versions", () => {
  it("keeps every timestamp version unique", () => {
    const migrations = readdirSync(join(process.cwd(), "supabase/migrations"))
      .filter((name) => name.endsWith(".sql"));
    const versions = migrations.map((name) => name.split("_", 1)[0]);
    const duplicates = versions.filter((version, index) => versions.indexOf(version) !== index);

    expect([...new Set(duplicates)]).toEqual([]);
  });

  it("permits only the documented numbered-label collisions", () => {
    const migrations = readdirSync(join(process.cwd(), "supabase/migrations"))
      .filter((name) => name.endsWith(".sql"));

    expect(duplicateLabelFiles(migrations)).toEqual(
      GRANDFATHERED_DUPLICATE_LABEL_FILES,
    );
  });
});
