// Shape pins for 0146. The effective proof (a real PostgreSQL applying this
// file) is nightSignalCheckpointMigrationEffective.test.ts; this one holds the
// promises a reader of the SQL should be able to see at a glance.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = "supabase/migrations/20260905160000_0146_night_signal_ingest_checkpoint.sql";
const ROLLBACK =
  "supabase/migrations/rollback/20260905160000_0146_night_signal_ingest_checkpoint_rollback.sql";

const sql = readFileSync(join(process.cwd(), MIGRATION), "utf8");
const rollback = readFileSync(join(process.cwd(), ROLLBACK), "utf8");

describe("0146 night_signal_ingest_checkpoint", () => {
  it("holds one checkpoint per sweep scope", () => {
    expect(sql).toMatch(/create table if not exists public\.night_signal_ingest_checkpoint \(/);
    expect(sql).toMatch(/scope\s+text primary key/);
    expect(sql).toMatch(/deferred\s+jsonb not null default '\[\]'::jsonb/);
    expect(sql).toMatch(/terminal\s+jsonb not null default '\[\]'::jsonb/);
    expect(sql).toMatch(/lease_owner\s+text/);
    expect(sql).toMatch(/lease_expires_at timestamptz/);
  });

  it("is operational state and never a signal lane", () => {
    // A claim, a source or a publisher here would be a second, unreviewed way
    // for a fact to reach a reader. The candidates live in night_signal_claims,
    // where a person has to approve them.
    const columns =
      sql.match(
        /create table if not exists public\.night_signal_ingest_checkpoint \(([\s\S]*?)\n\);/,
      )?.[1] ?? "";
    expect(columns).toBeTruthy();
    // Column definitions alone: a comment inside the block is prose, not a lane.
    const definitions = columns
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(definitions).not.toMatch(/claim|source_url|publisher|review_state|entity_id|confidence/i);
  });

  it("keeps a lease both halves or neither", () => {
    expect(sql).toMatch(/check \(\(lease_owner is null\) = \(lease_expires_at is null\)\)/);
  });

  it("gives the browser nothing at all", () => {
    expect(sql).toMatch(
      /alter table public\.night_signal_ingest_checkpoint enable row level security;/,
    );
    expect(sql).toMatch(
      /revoke all on table public\.night_signal_ingest_checkpoint from public, anon, authenticated;/,
    );
    expect(sql).toMatch(
      /grant select, insert, update, delete on table public\.night_signal_ingest_checkpoint to service_role;/,
    );
    expect(sql).not.toMatch(/grant[^;]*to anon/i);
    expect(sql).toMatch(
      /night_signal_ingest_checkpoint_client_deny[\s\S]*using \(false\) with check \(false\)/,
    );
  });

  it("indexes the lease the claim compares against", () => {
    expect(sql).toMatch(
      /create index if not exists night_signal_ingest_checkpoint_lease_idx[\s\S]*\(lease_expires_at\)/,
    );
  });

  it("applies and rolls back inside one transaction each", () => {
    for (const script of [sql, rollback]) {
      expect(script).toMatch(/\nbegin;/);
      expect(script.trimEnd().endsWith("commit;")).toBe(true);
    }
    expect(rollback).toMatch(/drop table if exists public\.night_signal_ingest_checkpoint;/);
    // Rolling back the checkpoint costs no candidate: those rows are 0034's,
    // so no statement here touches that table.
    const statements = rollback
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(statements).not.toMatch(/night_signal_claims/);
  });
});
