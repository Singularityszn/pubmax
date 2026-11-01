import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const skipReason = postgresSkipReason();
const directory = join(process.cwd(), "supabase/migrations");
const name = "20261031143000_0214_plan_presentation.sql";
const id = "10000000-0000-4000-8000-000000000001";
const hostHash = "a".repeat(64);
const guestHash = "b".repeat(64);
const host = "20000000-0000-4000-8000-000000000001";
const guest = "20000000-0000-4000-8000-000000000002";
let session: PostgresSession | null = null;
function db() { if (!session) throw new Error("No test cluster"); return session; }
function read(token: string, enabled = "null", revision = "null") {
  return JSON.parse(db().sql(`select public.plan_presentation('${id}','${token}',${enabled},${revision})::text`));
}

beforeAll(async () => {
  if (skipReason) return;
  session = await startPostgres({ label: "plan-presentation-0214", database: "pubmax_plan_presentation" });
  try {
    db().applyFile(join(process.cwd(), "scripts/rls/session-fixture.sql"));
    for (const file of readdirSync(directory).filter((entry) => entry.endsWith(".sql") && entry <= name).sort()) db().applyFile(join(directory, file));
    const stops = JSON.stringify([{ venueId: "one", venueName: "First pub" }]);
    expect(db().sql(`select public.create_plan_with_context_idempotent_atomic(
      '${id}','Mystery night','2026-11-02T19:00:00Z','${stops}'::jsonb,'${host}','Host','${hostHash}',
      '2026-11-02T12:00:00Z','${"a".repeat(64)}','${"b".repeat(64)}',null,null,null,null)`)).toBe("created");
    db().sql(`insert into public.plan_crew_members(id,plan_id,name,token_hash,status,joined_at,updated_at,can_collaborate)
      values('${guest}','${id}','Guest','${guestHash}','in','2026-11-02T12:01:00Z','2026-11-02T12:01:00Z',true)`);
  } catch (error) { await session.stop(); session = null; throw error; }
}, 180_000);
afterAll(async () => { await session?.stop(); });

describe.skipIf(skipReason !== null)("private mystery presentation", () => {
  it("defaults to the ordinary route and lets only the host change presentation", () => {
    expect(read(guestHash)).toMatchObject({ mysteryEnabled: false, canEdit: false });
    expect(read(guestHash, "true", "1")).toEqual({ error: "forbidden" });
    expect(read(hostHash, "true", "1")).toMatchObject({ mysteryEnabled: true, canEdit: true });
    expect(read(guestHash)).toMatchObject({ mysteryEnabled: true });
    expect(db().sql(`select route_revision from public.plans where id='${id}'`)).toBe("1");
    expect(db().sql(`select count(*) from public.plan_actions where plan_id='${id}'`)).toBe("0");
  });
  it("refuses stale updates, revoked members, and direct browser access", () => {
    expect(read(hostHash, "false", "2")).toEqual({ error: "conflict" });
    db().sql(`update public.plan_crew_members set membership_revoked_at=now() where id='${guest}'`);
    expect(read(guestHash)).toEqual({ error: "forbidden" });
    expect(read("unknown")).toEqual({ error: "forbidden" });
    expect(db().sql("select has_table_privilege('authenticated','public.plan_presentation_settings','SELECT')")).toBe("f");
    expect(db().sql("select has_function_privilege('anon','public.plan_presentation(uuid,text,boolean,integer)','EXECUTE')")).toBe("f");
    expect(db().sql("select has_function_privilege('authenticated','public.plan_presentation(uuid,text,boolean,integer)','EXECUTE')")).toBe("f");
  });
  it("rollback removes only presentation preferences", () => {
    db().applyFile(join(directory, "rollback/20261031143000_0214_plan_presentation_rollback.sql"));
    expect(db().sql("select to_regclass('public.plan_presentation_settings') is null")).toBe("t");
    expect(db().sql(`select count(*) from public.plan_stops where plan_id='${id}'`)).toBe("1");
  });
});
