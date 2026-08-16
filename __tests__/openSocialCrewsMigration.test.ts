import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION =
  "supabase/migrations/20260816220000_0110_open_social_crews.sql";
const ROLLBACK =
  "supabase/migrations/rollback/20260816220000_0110_open_social_crews_rollback.sql";

const sql = readFileSync(join(process.cwd(), MIGRATION), "utf8");
const rollback = readFileSync(join(process.cwd(), ROLLBACK), "utf8");

describe("0110 open social crews", () => {
  it("widens the visibility check to include open", () => {
    expect(sql).toMatch(
      /visibility in \('private','friends','open'\)/,
    );
    expect(sql).toMatch(/drop constraint if exists social_crews_visibility_check/);
  });

  it("lets an open join request skip mutual when neither side is blocked", () => {
    expect(sql).toMatch(/request_social_crew_join_atomic/);
    expect(sql).toMatch(/visibility\s*=\s*'open'/);
    expect(sql).toMatch(/is distinct from 'blocked'/);
    expect(sql).toMatch(/is distinct from 'mutual'/);
  });

  it("refuses a blocked requester on an open crew", () => {
    expect(sql).toMatch(/_social_crew_relationship_between_accounts/);
    expect(sql).toMatch(/'blocked'/);
  });

  it("previews an open crew to a verified actor without the member list", () => {
    expect(sql).toMatch(/read_social_crew_snapshot/);
    expect(sql).toMatch(/hostHandle/);
    expect(sql).toMatch(/stopVenueId/);
    expect(sql).toMatch(/stopVenueName/);
    expect(sql).toMatch(/memberCount/);
    expect(sql).toMatch(/visibility from authority\)='open'/);
    expect(sql).not.toMatch(
      /when \(select visibility from authority\)='open'[\s\S]*'members',active_members\.rows/,
    );
  });

  it("lists open crews for the service role only", () => {
    expect(sql).toMatch(
      /create or replace function public\.list_open_social_crews\(p_city text, p_from timestamptz, p_limit integer\)/,
    );
    expect(sql).toMatch(
      /revoke all on function[\s\S]*list_open_social_crews[\s\S]*from public, anon, authenticated/,
    );
    expect(sql).toMatch(
      /grant execute on function[\s\S]*list_open_social_crews[\s\S]*to service_role/,
    );
  });

  it("lets the host close an open crew back to private", () => {
    expect(sql).toMatch(/update_social_crew_visibility_atomic/);
    expect(sql).toMatch(
      /p_visibility not in \('private','friends','open'\)/,
    );
  });

  it("applies and rolls back inside one transaction each", () => {
    for (const script of [sql, rollback]) {
      expect(script).toMatch(/\nbegin;/);
      expect(script.trimEnd().endsWith("commit;")).toBe(true);
    }
    expect(rollback).toMatch(
      /visibility in \('private','friends'\)/,
    );
    expect(rollback).toMatch(
      /drop function if exists public\.list_open_social_crews/,
    );
    expect(rollback).toMatch(
      /p_visibility not in \('private','friends'\)/,
    );
    expect(rollback).not.toMatch(/visibility in \('private','friends','open'\)/);
  });
});
