import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATION_FILENAME_RE = /^(\d{14})_(\d{4})_.+\.sql$/;

function migrationFilenames(): string[] {
  return readdirSync(join(process.cwd(), "supabase/migrations"))
    .filter((name) => name.endsWith(".sql"));
}

describe("Supabase migration versions", () => {
  it("keeps every timestamp version unique", () => {
    const migrations = migrationFilenames();
    const versions = migrations.map((name) => name.split("_", 1)[0]);
    const duplicates = versions.filter((version, index) => versions.indexOf(version) !== index);

    expect([...new Set(duplicates)]).toEqual([]);
  });

  it("keeps newest migration's embedded ordinal unique", () => {
    // Older migrations contain deliberate ordinal reuse from separate landed
    // branches. Keep the current edge unique so two branches cannot claim
    // the same migration number in one merged ledger.
    const numbered = migrationFilenames()
      .map((name) => ({ name, match: name.match(MIGRATION_FILENAME_RE) }))
      .filter((entry): entry is { name: string; match: RegExpMatchArray } => entry.match !== null)
      .map(({ name, match }) => ({ name, timestamp: match[1], ordinal: match[2] }));
    const newest = numbered.reduce(
      (latest, migration) => migration.timestamp > latest.timestamp ? migration : latest,
      numbered[0] ?? { name: "", timestamp: "", ordinal: "" },
    );

    expect(
      numbered.filter((migration) => migration.ordinal === newest.ordinal),
      `embedded ordinal ${newest.ordinal} is claimed more than once`,
    ).toHaveLength(1);
  });
});
