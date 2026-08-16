import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION =
  "supabase/migrations/20260816190000_0109_venue_occupancy_moderation.sql";
const ROLLBACK =
  "supabase/migrations/rollback/20260816190000_0109_venue_occupancy_moderation_rollback.sql";

const sql = readFileSync(join(process.cwd(), MIGRATION), "utf8");
const rollback = readFileSync(join(process.cwd(), ROLLBACK), "utf8");

describe("0109 venue occupancy moderation", () => {
  it("stamps a hide and never deletes the observation", () => {
    expect(sql).toMatch(/add column if not exists hidden_at\s+timestamptz/);
    expect(sql).toMatch(/add column if not exists report_count\s+integer not null default 0/);
    expect(sql).not.toMatch(/delete from public\.venue_occupancy_reports/i);
  });

  it("records one flag per actor without auto-hiding", () => {
    expect(sql).toMatch(/create table if not exists public\.venue_occupancy_flags/);
    expect(sql).toMatch(/unique \(occupancy_report_id, actor_hash\)/);
    expect(sql).toMatch(/create or replace function public\.report_occupancy_report/);
    expect(sql).not.toMatch(/hidden_at\s*=/);
  });

  it("keeps flags and hide stamps service-role only", () => {
    expect(sql).toMatch(
      /alter table public\.venue_occupancy_flags enable row level security;/,
    );
    expect(sql).toMatch(
      /revoke all on table public\.venue_occupancy_flags from public, anon, authenticated;/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.report_occupancy_report\(uuid, text, text\) to service_role;/,
    );
    expect(sql).not.toMatch(/grant [^;]* to authenticated/i);
  });

  it("applies and rolls back inside one transaction each", () => {
    for (const script of [sql, rollback]) {
      expect(script).toMatch(/\nbegin;/);
      expect(script.trimEnd().endsWith("commit;")).toBe(true);
    }
    expect(rollback).toMatch(/drop table if exists public\.venue_occupancy_flags;/);
    expect(rollback).toMatch(/drop column if exists hidden_at/);
  });
});
