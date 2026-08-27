import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

describe("Wanted promotion migration", () => {
  it("adds paired durable list and time columns without a new table", () => {
    const sql = readFileSync(
      join(ROOT, "supabase/migrations/20260827110000_0121_wanted_public_list_promotion.sql"),
      "utf8",
    );

    expect(sql).toContain("alter table public.wanteds");
    expect(sql).toContain("promoted_list_type");
    expect(sql).toContain("promoted_at");
    expect(sql).toMatch(/check[\s\S]*promoted_list_type[\s\S]*promoted_at/i);
    expect(sql).not.toMatch(/create\s+table/i);
    expect(sql).toContain("promote_wanted_to_saved_list");
    expect(sql).toMatch(/for\s+update/i);
    expect(sql).toMatch(/insert\s+into\s+public\.saved_pubs/i);
    expect(sql).toMatch(/v_wanted\.status\s*<>\s*'open'/i);
    expect(sql).toMatch(/on\s+conflict\s*\(profile_id, venue_id, list_type\)\s*do\s+nothing/i);
  });

  it("points schema recovery at the promotion migration", () => {
    const store = readFileSync(join(ROOT, "lib/wantedStore.ts"), "utf8");

    expect(store).toContain('migrationHint: "apply migration 0121"');
    expect(store).not.toContain('migrationHint: "apply migration 0119"');
  });
});
