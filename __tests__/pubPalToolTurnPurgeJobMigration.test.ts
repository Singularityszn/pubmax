// Migration 0197 runs the Pub Pal tool-turn purge in the database with pg_cron.
// The effective proof (job created once, expired row gone in about a minute,
// live row kept, rollback leaves no job) needs pg_cron loaded at server start,
// which the shared proof fixture does not do, so it is recorded in
// docs/proof/2026-10-30-pub-pal-purge-pg-cron. This pins the text that proof ran.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const MIGRATION = read("supabase/migrations/20261030120000_0197_pub_pal_tool_turn_purge_job.sql");
const ROLLBACK = read(
  "supabase/migrations/rollback/20261030120000_0197_pub_pal_tool_turn_purge_job_rollback.sql",
);
const STORE = read("lib/pubPalToolTurnStore.ts");
const JOB = "pubmax-purge-pub-pal-tool-turns";

describe("0197 Pub Pal tool-turn purge job", () => {
  it("deletes exactly what the store's own purge deletes, every minute", () => {
    expect(MIGRATION).toContain(`'${JOB}'`);
    expect(MIGRATION).toContain("'* * * * *'");
    expect(MIGRATION).toContain("delete from public.pub_pal_tool_turns where expires_at < now()");
    // The store's purge: the same table and the same strict comparison.
    expect(STORE).toMatch(/\.from\("pub_pal_tool_turns"\)\s*\.delete\(\)\s*\.lt\("expires_at",/);
  });

  it("is a notice, never a failure, where pg_cron is not available", () => {
    expect(MIGRATION).toMatch(/if not exists \(select 1 from pg_available_extensions where name = 'pg_cron'\)/);
    expect(MIGRATION).toMatch(/raise notice/);
  });

  it("rolls back by unscheduling the same job and leaves the extension alone", () => {
    expect(ROLLBACK).toContain(`jobname = '${JOB}'`);
    expect(ROLLBACK).toContain("cron.unschedule");
    expect(ROLLBACK).not.toMatch(/drop extension/i);
  });

  it("keeps the Vercel route as the backstop until the job is confirmed", () => {
    const vercel = JSON.parse(read("vercel.json")) as { crons: Array<{ path: string }> };
    expect(vercel.crons.some((cron) => cron.path === "/api/cron/purge-pub-pal-turns")).toBe(true);
  });
});
