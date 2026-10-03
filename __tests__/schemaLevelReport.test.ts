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
  databaseUrlFrom,
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

  it("counts a label applied when any of its files matches by version", () => {
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

  it("prints missing labels, then out-of-order labels", () => {
    expect(
      formatSchemaLevelReport({ missing: ["0161", "0162"], outOfOrder: ["0169"] }),
    ).toBe("missing:\n0161\n0162\nout-of-order:\n0169\n");
  });

  it("fetches with one read-only select and does not repeat the connection string", () => {
    const url = "postgres://report:secret@db.example:5432/postgres";
    expect(databaseUrlFrom({})).toBeNull();
    expect(() => fetchAppliedList({})).toThrow(/SCHEMA_LEVEL_DATABASE_URL/);

    let seen: { args: readonly string[]; pgoptions: string | undefined } | undefined;
    const text = fetchAppliedList({ SCHEMA_LEVEL_DATABASE_URL: url }, (file, args, options) => {
      seen = { args, pgoptions: options.env.PGOPTIONS };
      expect(file).toBe("psql");
      return "20261003050416\t0170_profiles_table_door\n";
    });

    expect(text).toContain("0170_profiles_table_door");
    expect(seen?.args[0]).toBe(url);
    expect(seen?.args).toContain(APPLIED_LIST_SQL);
    expect(APPLIED_LIST_SQL.startsWith("select ")).toBe(true);
    expect(seen?.pgoptions).toContain("default_transaction_read_only=on");

    expect(() =>
      fetchAppliedList({ DATABASE_URL: url }, () => {
        throw new Error(`connection failed for ${url}`);
      }),
    ).toThrow("--fetch failed");
  });

  it("reports 0161-0168 missing when later labels were applied under other versions", () => {
    const lines: string[] = [];
    for (const name of listMigrations()) {
      const label = labelOf(name);
      const number = label ? Number(label) : null;
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
        "0169",
        "0170",
        "0171",
        "0172",
        "",
      ].join("\n"),
    );
  });
});
