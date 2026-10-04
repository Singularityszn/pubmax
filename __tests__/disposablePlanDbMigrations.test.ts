import { readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

import { disposablePlanMigrations } from "../scripts/e2e/disposable-plan-db.mjs";

it("applies the complete forward migration chain through the newest migration", () => {
  const chain = disposablePlanMigrations();
  const newest = readdirSync(join(process.cwd(), "supabase/migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .at(-1);
  expect(chain.at(-1)).toBe(newest);
  expect(chain).toEqual([...chain].sort());
  expect(chain).toEqual(expect.arrayContaining([
    "20261001073000_0176_plan_listed_drink_evidence.sql",
    "20261001073100_0177_plan_manual_selected_evidence.sql",
    "20261001090000_0178_plan_route_alternatives.sql",
    "20261001091000_0179_plan_backup_context_evidence.sql",
    "20261002110000_0183_plan_saved_stop_counts.sql",
    "20261003031818_0185_plan_named_listed_drink_evidence.sql",
    "20261003070000_0172_public_grant_sweep.sql",
    "20261003085500_0186_plan_cider_selected_evidence.sql",
  ]));
  expect(chain.some((name) => name.includes("rollback"))).toBe(false);
  expect(chain.some((name) => name <= "20260806035204_0070_v1_release_security.sql")).toBe(false);
});
