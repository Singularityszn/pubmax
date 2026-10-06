// schema-level-report.mjs compares repo migration labels with an applied list
// by label. A later label that is applied while an earlier one is missing is
// out of order. The version in the applied list may differ from the filename.

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  labelOf,
  listMigrations,
  versionOf,
} from "../scripts/qa/migration-apply-list.mjs";
import {
  APPLIED_LIST_SQL,
  compareSchemaLevel,
  fetchAppliedList,
  formatSchemaLevelReport,
} from "../scripts/qa/schema-level-report.mjs";

const ROOT = process.cwd();
const REPORT = join(ROOT, "scripts/qa/schema-level-report.mjs");
const temporaryRoots: string[] = [];

afterEach(() => {
  while (temporaryRoots.length > 0) {
    const dir = temporaryRoots.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("schema-level report", () => {
  it("reports a missing earlier label and the later labels applied ahead of it", () => {
    const migrations = [
      "20260927120000_0159_supabase_hygiene.sql",
      "20260929120000_0161_plan_selected_drink_evidence.sql",
      "20261002120000_0169_pub_pal_tool_turn_owner.sql",
      "20261002210000_0170_profiles_table_door.sql",
    ];
    const appliedText = [
      "20260927120000\t0159_supabase_hygiene",
      "20261003050416\t0170_profiles_table_door",
      "19990101010101\t0169_pub_pal_tool_turn_owner",
    ].join("\n");

    expect(compareSchemaLevel(migrations, appliedText)).toEqual({
      missing: ["0161"],
      outOfOrder: ["0169", "0170"],
    });
  });

  it("does not treat an unlabeled file as a label or as a gap", () => {
    const migrations = [
      "20260715091628_pub_pal_plan_completion_indexes.sql",
      "20260701000000_0001_visit_reports.sql",
    ];
    const appliedText = "0001_visit_reports\n";

    expect(compareSchemaLevel(migrations, appliedText)).toEqual({
      missing: [],
      outOfOrder: [],
    });
  });

  it("does not call a label missing when production recorded only its descriptive name", () => {
    const migrations = [
      "20260831140000_0127_plan_membership_account_claim.sql",
      "20260831142000_0131_social_crew_membership_reuse_capacity.sql",
      "20260929120000_0161_plan_selected_drink_evidence.sql",
      "20261002210000_0170_profiles_table_door.sql",
    ];
    const appliedText = [
      "20260827120448\tplan_membership_account_claim",
      "20261003050416\t0170_profiles_table_door",
    ].join("\n");

    expect(compareSchemaLevel(migrations, appliedText)).toEqual({
      missing: ["0131", "0161"],
      outOfOrder: ["0170"],
    });
  });

  it("counts a label applied when a re-timestamped file of the same name matches by version", () => {
    const migrations = [
      "20260707010745_0013_comment_replies.sql",
      "20260707053307_0013_comment_replies.sql",
      "20260707053408_0016_drinks.sql",
    ];
    const appliedText = "20260707053307\n";

    expect(compareSchemaLevel(migrations, appliedText)).toEqual({
      missing: ["0016"],
      outOfOrder: [],
    });
  });

  it("calls a shared label missing when one of its differently named migrations is unapplied", () => {
    const migrations = [
      "20260828120000_0123_harvest_venue_overlays.sql",
      "20260829120000_0123_social_admin_moderation.sql",
      "20260830120000_0125_later.sql",
    ];
    const appliedText = [
      "20260828120000\t0123_harvest_venue_overlays",
      "20260830120000\t0125_later",
    ].join("\n");

    expect(compareSchemaLevel(migrations, appliedText)).toEqual({
      missing: ["0123"],
      outOfOrder: ["0125"],
    });
  });

  it("opens a shared-label gap at the unapplied file, not at the label's first file", () => {
    const migrations = [
      "20260717065012_0038_plan_ending_selection.sql",
      "20260717120000_0039_push_tokens.sql",
      "20260717130000_0040_pint_drop_daily_dedupe.sql",
      "20260721000000_0038_night_contributor_withdrawn.sql",
      "20260721120000_0046_after.sql",
    ];
    const appliedText = [
      "20260717065012\t0038_plan_ending_selection",
      "20260717120000\t0039_push_tokens",
      "20260717130000\t0040_pint_drop_daily_dedupe",
      "20260721120000\t0046_after",
    ].join("\n");

    expect(compareSchemaLevel(migrations, appliedText)).toEqual({
      missing: ["0038"],
      outOfOrder: ["0046"],
    });
  });

  it("reports a Local-only row of a pasted supabase migration list as missing", () => {
    const migrations = [
      "20260927120000_0159_supabase_hygiene.sql",
      "20260929120000_0161_plan_selected_drink_evidence.sql",
      "20261002120000_0169_pub_pal_tool_turn_owner.sql",
    ];
    const appliedText = [
      "   Local          | Remote         | Time (UTC)",
      "  ----------------|----------------|---------------------",
      "   20260927120000 | 20260927120000 | 2026-09-27 12:00:00",
      "   20260929120000 |                | 2026-09-29 12:00:00",
      "   20261002120000 | 20261002120000 | 2026-10-02 12:00:00",
    ].join("\n");

    expect(compareSchemaLevel(migrations, appliedText)).toEqual({
      missing: ["0161"],
      outOfOrder: ["0169"],
    });
  });

  it("keeps an applied psql-aligned ledger row whose name is null", () => {
    const migrations = [
      "20260705214936_0007_function_search_path.sql",
      "20260707053408_0016_drinks.sql",
    ];
    const appliedText = [
      "     version     |           name",
      "-----------------+---------------------------",
      " 20260705214936 | ",
      " 20260707053408 | 0016_drinks",
      "(2 rows)",
    ].join("\n");

    expect(compareSchemaLevel(migrations, appliedText)).toEqual({
      missing: [],
      outOfOrder: [],
    });
  });

  it("prints the target first when known, then missing labels, then out-of-order labels", () => {
    expect(
      formatSchemaLevelReport({ missing: ["0161", "0162"], outOfOrder: ["0169"] }),
    ).toBe("missing:\n0161\n0162\nout-of-order:\n0169\n");
    expect(
      formatSchemaLevelReport({ target: "db.example:5432", missing: [], outOfOrder: [] }),
    ).toBe("target: db.example:5432\nmissing:\nout-of-order:\n");
  });

  it("fetches with one read-only select and does not repeat the connection string", () => {
    const url = "postgres://report:secret@db.example:5432/postgres";
    const neverRun = () => {
      throw new Error("psql must not run");
    };
    expect(() => fetchAppliedList({}, neverRun)).toThrow(/SCHEMA_LEVEL_DATABASE_URL/);
    expect(() =>
      fetchAppliedList({ SUPABASE_DB_URL: url, DATABASE_URL: url }, neverRun),
    ).toThrow(/SCHEMA_LEVEL_DATABASE_URL/);
    expect(() =>
      fetchAppliedList({ SCHEMA_LEVEL_DATABASE_URL: "host=db.example password=secret" }, neverRun),
    ).toThrow(/postgres:\/\/ URL/);

    let seen: { args: readonly string[]; pgoptions: string | undefined } | undefined;
    const fetched = fetchAppliedList(
      { SCHEMA_LEVEL_DATABASE_URL: url, PSQL: "/not/psql" },
      (file, args, options) => {
        seen = { args, pgoptions: options.env.PGOPTIONS };
        expect(file).toBe("psql");
        return "20261003050416\t0170_profiles_table_door\n";
      },
    );

    expect(fetched.text).toContain("0170_profiles_table_door");
    expect(fetched.target).toBe("db.example:5432");
    expect(fetched.target).not.toContain("secret");
    expect(seen?.args[0]).toBe(url);
    expect(seen?.args).toContain(APPLIED_LIST_SQL);
    expect(APPLIED_LIST_SQL.startsWith("select ")).toBe(true);
    expect(seen?.pgoptions).toContain("default_transaction_read_only=on");

    let failure: unknown;
    try {
      fetchAppliedList({ SCHEMA_LEVEL_DATABASE_URL: url }, () => {
        throw new Error(
          `Command failed: psql ${url} --no-psqlrc\npsql: error: password authentication failed for user "report"`,
        );
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    const message = (failure as Error).message;
    expect(message).toContain("psql <SCHEMA_LEVEL_DATABASE_URL> --no-psqlrc");
    expect(message).toContain("password authentication failed");
    expect(message).not.toContain("secret");
  });

  it("reports 0161-0168 missing when later labels were applied under other versions", () => {
    const lines: string[] = [];
    // Every label after the gap is applied, so each one is out of order. A new
    // migration joins that list rather than breaking the expected output.
    const later = new Set<string>();
    for (const name of listMigrations()) {
      const label = labelOf(name);
      const number = label ? Number(label) : null;
      if (label && number !== null && number >= 169) later.add(label);
      if (number !== null && number >= 161 && number <= 168) continue;
      if (number !== null && number >= 169 && number <= 172) {
        lines.push(`19990101010101_${label}_applied_under_another_version`);
        continue;
      }
      const version = versionOf(name);
      if (version) lines.push(version);
    }

    const dir = mkdtempSync(join(tmpdir(), "schema-level-report-"));
    temporaryRoots.push(dir);
    const appliedFile = join(dir, "applied.txt");
    writeFileSync(appliedFile, lines.join("\n"));

    const result = spawnSync(process.execPath, [REPORT, "--against", appliedFile], {
      cwd: ROOT,
      encoding: "utf8",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(
      [
        "missing:",
        "0161",
        "0162",
        "0163",
        "0164",
        "0165",
        "0166",
        "0167",
        "0168",
        "out-of-order:",
        ...[...later].sort(),
        "",
      ].join("\n"),
    );
  });
});
