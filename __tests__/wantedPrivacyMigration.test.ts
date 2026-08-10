import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = "supabase/migrations/20260810210000_0104_wanted_privacy.sql";
const ROLLBACK = "supabase/migrations/rollback/20260810210000_0104_wanted_privacy_rollback.sql";

const sql = readFileSync(join(process.cwd(), MIGRATION), "utf8");
const rollback = readFileSync(join(process.cwd(), ROLLBACK), "utf8");

describe("0104 Wanted privacy", () => {
  it("adds optional drink interest and private-by-default visibility", () => {
    expect(sql).toMatch(/add column if not exists drink_interest\s+text/);
    expect(sql).toMatch(/add column if not exists visibility\s+text not null default 'private'/);
    expect(sql).toMatch(/wanteds_drink_interest_check[\s\S]*beer/);
    expect(sql).toMatch(/wanteds_visibility_check[\s\S]*mutuals[\s\S]*crew:/);
  });

  it("keeps client RLS owner-only while server actions verify shared access", () => {
    expect(sql).toMatch(/wanteds_owner_select[\s\S]*rls_owns_profile/);
    expect(sql).not.toMatch(/create policy[^;]+for select[^;]+using \(true\)/i);
  });

  it("is transactional and reversible", () => {
    expect(sql).toMatch(/\nbegin;/);
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
    expect(rollback).toMatch(/\nbegin;/);
    expect(rollback.trimEnd().endsWith("commit;")).toBe(true);
    expect(rollback).toMatch(/drop index if exists public\.wanteds_visibility_idx/);
  });
});
