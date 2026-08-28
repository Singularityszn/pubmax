import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATION =
  "supabase/migrations/20260828120000_0123_harvest_venue_overlays.sql";
const ROLLBACK =
  "supabase/migrations/rollback/20260828120000_0123_harvest_venue_overlays_rollback.sql";

const sql = readFileSync(join(process.cwd(), MIGRATION), "utf8");
const rollback = readFileSync(join(process.cwd(), ROLLBACK), "utf8");

describe("0123 harvest_venue_overlays", () => {
  it("keys the overlay on OSM id, never a pub name", () => {
    expect(sql).toMatch(/osm_id text primary key/);
    expect(sql).toMatch(/osm_ref text not null unique/);
    const columns = sql
      .match(/create table if not exists public\.harvest_venue_overlays \(([\s\S]*?)\n\);/)?.[1]
      ?.split("\n")
      .map((line) => line.trim())
      .filter(Boolean) ?? [];
    expect(columns.some((line) => /\bname\b/.test(line))).toBe(false);
  });

  it("requires https website/menu and cited lore as a pair", () => {
    expect(sql).toMatch(/website is null or website like 'https:\/\/%'/);
    expect(sql).toMatch(/menu_url is null or menu_url like 'https:\/\/%'/);
    expect(sql).toMatch(/lore_text is not null and jsonb_typeof\(lore_citations\) = 'array'/);
    const columns = sql
      .match(/create table if not exists public\.harvest_venue_overlays \(([\s\S]*?)\n\);/)?.[1]
      ?? "";
    expect(columns).not.toMatch(/social/i);
  });

  it("keeps reads and writes on the service role", () => {
    expect(sql).toMatch(/alter table public\.harvest_venue_overlays enable row level security;/);
    expect(sql).toMatch(
      /revoke all on table public\.harvest_venue_overlays from public, anon, authenticated;/,
    );
    expect(sql).toMatch(
      /grant select, insert, update, delete on table public\.harvest_venue_overlays to service_role/,
    );
    expect(sql).toMatch(/harvest_venue_overlays_anon_deny[\s\S]*using \(false\) with check \(false\)/);
    expect(sql).toMatch(
      /harvest_venue_overlays_authenticated_deny[\s\S]*using \(false\) with check \(false\)/,
    );
  });

  it("applies and rolls back inside one transaction each", () => {
    for (const script of [sql, rollback]) {
      expect(script).toMatch(/\nbegin;/);
      expect(script.trimEnd().endsWith("commit;")).toBe(true);
    }
    expect(rollback).toMatch(/drop table if exists public\.harvest_venue_overlays;/);
  });
});
