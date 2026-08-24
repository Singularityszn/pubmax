import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = "supabase/migrations/20260824120000_0119_whats_on_listings.sql";
const ROLLBACK = "supabase/migrations/rollback/20260824120000_0119_whats_on_listings_rollback.sql";

const sql = readFileSync(join(process.cwd(), MIGRATION), "utf8");
const rollback = readFileSync(join(process.cwd(), ROLLBACK), "utf8");

describe("0119 whats_on_listings", () => {
  it("stores official-API What's-On rows as a service-role cache", () => {
    expect(sql).toMatch(/create table if not exists public\.whats_on_listings/);
    expect(sql).toMatch(/id text primary key/);
    expect(sql).toMatch(/kind text not null/);
    expect(sql).toMatch(/payload jsonb not null/);
    expect(sql).toMatch(/observed_at timestamptz not null/);
    expect(sql).toMatch(/generated_at timestamptz not null/);
    expect(sql).toMatch(/kind in \('sport', 'quiz', 'deal', 'music', 'event'\)/);
  });

  it("keeps the table service-role only", () => {
    expect(sql).toMatch(/alter table public\.whats_on_listings enable row level security;/);
    expect(sql).toMatch(/revoke all on table public\.whats_on_listings from public, anon, authenticated;/);
    expect(sql).toMatch(
      /grant select, insert, update, delete on table public\.whats_on_listings to service_role;/,
    );
    expect(sql).not.toMatch(/using \(true\)/);
    expect(sql).toMatch(/whats_on_listings_anon_deny[\s\S]*using \(false\) with check \(false\)/);
    expect(sql).toMatch(
      /whats_on_listings_authenticated_deny[\s\S]*using \(false\) with check \(false\)/,
    );
  });

  it("applies and rolls back inside one transaction each", () => {
    for (const script of [sql, rollback]) {
      expect(script).toMatch(/\nbegin;/);
      expect(script.trimEnd().endsWith("commit;")).toBe(true);
    }
    expect(rollback).toMatch(/drop table if exists public\.whats_on_listings;/);
  });
});
