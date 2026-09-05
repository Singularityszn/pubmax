import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";

// A migration's four-digit label is the number the captain applies by, so two
// files carrying one label is an ambiguous instruction rather than a naming
// nit: #1500 and #1501 merged within an hour and both called themselves 0142.
// The collisions below are GRANDFATHERED. The list may only ever SHRINK: a new
// pair belongs in a renamed file, not in this table.

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

// A MIGRATION LANDS WITH THE WAY BACK OUT, and from label 0092 that is a rule
// rather than a habit. The audit found 0120 and 0121 shipped without one, so a
// social-connection lifecycle and a Wanted promotion could be applied and not
// undone; both now carry a twin. 0092 is the floor because every label from it
// onwards has one, while 89 older migrations predate the practice and are not
// retrofitted here.
const ROLLBACK_REQUIRED_FROM_LABEL = 92;

// A migration at or after the floor that may ship without a rollback, each row
// carrying the reason. The list may only ever SHRINK: it is EMPTY today, and
// an exception belongs here with its reason rather than in a silent gap.
const MIGRATIONS_WITHOUT_ROLLBACK: Record<string, string> = {};

function migrationFiles(directory: string): string[] {
  return readdirSync(join(process.cwd(), directory)).filter((name) =>
    name.endsWith(".sql"),
  );
}

function labelOf(name: string): string | null {
  return name.match(/^\d{14}_(\d{4})_/)?.[1] ?? null;
}

function duplicateLabelFiles(
  migrations: readonly string[],
): Record<string, string[]> {
  const filesByLabel = new Map<string, string[]>();

  for (const name of [...migrations].sort()) {
    const label = labelOf(name);
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
    const migrations = migrationFiles("supabase/migrations");
    const versions = migrations.map((name) => name.split("_", 1)[0]);
    const duplicates = versions.filter((version, index) => versions.indexOf(version) !== index);

    expect([...new Set(duplicates)]).toEqual([]);
  });

  it("permits only the documented numbered-label collisions", () => {
    const migrations = migrationFiles("supabase/migrations");

    expect(duplicateLabelFiles(migrations)).toEqual(
      GRANDFATHERED_DUPLICATE_LABEL_FILES,
    );
  });

  it("gives every migration landing after the grandfathered ones its own label", () => {
    const grandfathered = new Set(Object.keys(GRANDFATHERED_DUPLICATE_LABEL_FILES));
    const duplicates = duplicateLabelFiles(migrationFiles("supabase/migrations"));

    // Stated apart from the table above so the failure names the offending
    // pair rather than printing the whole grandfathered list as a diff.
    for (const [label, files] of Object.entries(duplicates)) {
      expect(
        grandfathered.has(label),
        `migration ${label} is claimed by ${files.join(" and ")}; renumber the later one`,
      ).toBe(true);
    }
  });

  it("gives every rollback its own label too, and one per migration label", () => {
    const grandfathered = new Set(Object.keys(GRANDFATHERED_DUPLICATE_LABEL_FILES));
    const rollbacks = migrationFiles("supabase/migrations/rollback");

    // A rollback mirrors its migration's label, so the grandfathered pairs are
    // doubled here and nothing else may be.
    for (const [label, files] of Object.entries(duplicateLabelFiles(rollbacks))) {
      expect(
        grandfathered.has(label),
        `rollback ${label} is claimed by ${files.join(" and ")}; renumber the later one`,
      ).toBe(true);
    }

    // A rollback names the migration it undoes, so a label with a rollback
    // file must be a label some migration actually carries.
    const migrationLabels = new Set(
      migrationFiles("supabase/migrations").map(labelOf).filter(Boolean),
    );
    const orphans = rollbacks
      .map(labelOf)
      .filter((label): label is string => Boolean(label))
      .filter((label) => !migrationLabels.has(label));

    expect(orphans).toEqual([]);
  });

  it("gives every migration from 0092 onwards a rollback twin", () => {
    const rollbackLabels = new Set(
      migrationFiles("supabase/migrations/rollback").map(labelOf).filter(Boolean),
    );
    const missing: Record<string, string> = {};

    for (const name of migrationFiles("supabase/migrations")) {
      const label = labelOf(name);
      if (!label) continue;
      if (Number(label) < ROLLBACK_REQUIRED_FROM_LABEL) continue;
      // Keyed by LABEL, because that is what the captain applies by and what a
      // rollback names; a grandfathered duplicate label shares one twin.
      if (rollbackLabels.has(label)) continue;
      if (label in MIGRATIONS_WITHOUT_ROLLBACK) continue;
      missing[label] = name;
    }

    expect(missing).toEqual({});
  });

  it("keeps the no-rollback list shrink-only: no row that already has a twin", () => {
    const rollbackLabels = new Set(
      migrationFiles("supabase/migrations/rollback").map(labelOf).filter(Boolean),
    );
    const stale = Object.keys(MIGRATIONS_WITHOUT_ROLLBACK).filter((label) =>
      rollbackLabels.has(label),
    );

    expect(stale).toEqual([]);
  });
});
