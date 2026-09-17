import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = "supabase/migrations/20260905100000_0142_city_enrichment_progress.sql";
const ROLLBACK =
  "supabase/migrations/rollback/20260905100000_0142_city_enrichment_progress_rollback.sql";

const sql = readFileSync(join(process.cwd(), MIGRATION), "utf8");
const rollback = readFileSync(join(process.cwd(), ROLLBACK), "utf8");

describe("0142 city_enrichment_progress", () => {
  it("holds one checkpoint per city", () => {
    expect(sql).toMatch(/create table if not exists public\.city_enrichment_progress \(/);
    expect(sql).toMatch(/city\s+text primary key/);
    expect(sql).toMatch(/next_index\s+integer not null default 0/);
    expect(sql).toMatch(/lease_owner\s+text/);
    expect(sql).toMatch(/lease_expires_at\s+timestamptz/);
  });

  it("is operational state and never a price lane", () => {
    // A price column here would be a second, unreviewed way for a figure to
    // reach the product. The cron publishes nothing; this table is why that
    // stays true even as it gains state.
    const columns =
      sql.match(
        /create table if not exists public\.city_enrichment_progress \(([\s\S]*?)\n\);/,
      )?.[1] ?? "";
    expect(columns).not.toMatch(/price|gbp|drink|venue_key|observed_at/i);
  });

  it("gives the browser nothing at all", () => {
    expect(sql).toMatch(/alter table public\.city_enrichment_progress enable row level security;/);
    expect(sql).toMatch(
      /revoke all on table public\.city_enrichment_progress from public, anon, authenticated;/,
    );
    expect(sql).toMatch(
      /grant select, insert, update, delete on table public\.city_enrichment_progress to service_role;/,
    );
    // The row carries provider error text and the shape of our own spend.
    expect(sql).not.toMatch(/grant[^;]*to authenticated/i);
    expect(sql).toMatch(
      /city_enrichment_progress_client_deny[\s\S]*using \(false\) with check \(false\)/,
    );
  });

  it("indexes the lease the claim compares against", () => {
    expect(sql).toMatch(
      /create index if not exists city_enrichment_progress_lease_idx[\s\S]*\(lease_expires_at\)/,
    );
  });

  it("applies and rolls back inside one transaction each", () => {
    for (const script of [sql, rollback]) {
      expect(script).toMatch(/\nbegin;/);
      expect(script.trimEnd().endsWith("commit;")).toBe(true);
    }
    expect(rollback).toMatch(/drop table if exists public\.city_enrichment_progress;/);
  });
});
