import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asBrowserRole, asServiceRole, postgresSkipReason, startMigratedPostgres, type PostgresSession } from "./helpers/postgres";

const skipReason = postgresSkipReason();
const PLAN = "11111111-1111-4111-8111-111111111111";
const HOST = "22222222-2222-4222-8222-222222222222";
const GUEST = "33333333-3333-4333-8333-333333333333";
const ARRIVAL = "44444444-4444-4444-8444-444444444444";
const HOST_HASH = "a".repeat(64);
const GUEST_HASH = "b".repeat(64);
let session: PostgresSession | null = null;
function db() { if (!session) throw new Error("The test database is not running."); return session; }

function call(operation: string, hash = HOST_HASH) {
  return JSON.parse(db().sql(asServiceRole(`select public.plan_table_beacon('${PLAN}', '${hash}', '${operation}', 'star', 'Upstairs', 1, '${ARRIVAL}')::text`)));
}

beforeAll(async () => {
  if (skipReason) return;
  session = await startMigratedPostgres({ label: "table-beacon", database: "table_beacon" });
  db().sql(`insert into public.plans(id,title,start_time,status) values ('${PLAN}', 'Our night', now(), 'active');
    insert into public.plan_stops(plan_id,venue_id,venue_name,position) values
      ('${PLAN}','venue-first','The First Pub',0), ('${PLAN}','venue-next','The Next Pub',1);
    insert into public.plan_crew_members(id,plan_id,name,token_hash,can_collaborate,joined_at) values
      ('${HOST}','${PLAN}','Host','${HOST_HASH}',true,now()-interval '1 minute'),
      ('${GUEST}','${PLAN}','Guest','${GUEST_HASH}',true,now());
    insert into public.plan_actions(id,plan_id,actor_member_id,type,stop_position,created_at)
    values ('${ARRIVAL}','${PLAN}','${HOST}','arrived',0,now()-interval '1 minute');`);
}, 600_000);
afterAll(async () => { await session?.stop(); session = null; });

describe.skipIf(skipReason !== null)("0213 private table sign database boundary", () => {
  it("records the arrival's canonical route version and gives the crew its sign", () => {
    expect(call("set")).toMatchObject({ ok: true, view: { canEdit: true, current: { venueId: "venue-first" }, beacon: { symbol: "star", note: "Upstairs" } } });
    expect(call("read", GUEST_HASH)).toMatchObject({ ok: true, view: { canEdit: false, beacon: { note: "Upstairs" } } });
  });

  it("refuses guest changes, revoked membership, and direct browser access", () => {
    expect(call("set", GUEST_HASH)).toEqual({ ok: false, error: "forbidden" });
    db().sql(`update public.plan_crew_members set membership_revoked_at=now() where id='${GUEST}'`);
    expect(call("read", GUEST_HASH)).toEqual({ ok: false, error: "not_found" });
    for (const role of ["anon", "authenticated"] as const) {
      expect(db().expectRefusal(asBrowserRole(role, null, "select * from public.plan_table_beacons"))).toMatch(/permission denied/);
      expect(db().expectRefusal(asBrowserRole(role, null, `select public.plan_table_beacon('${PLAN}','${HOST_HASH}','read')`))).toMatch(/permission denied/);
    }
  });

  it("uses the server night end and withholds an expired note", () => {
    const start = new Date(Date.now() - 7.5 * 60 * 60 * 1000);
    db().sql(`update public.plans set start_time='${start.toISOString()}' where id='${PLAN}'`);
    const result = call("set");
    expect(new Date(result.view.beacon.expiresAt).toISOString()).toBe(new Date(start.getTime() + 8 * 60 * 60 * 1000).toISOString());
    db().sql(`update public.plan_table_beacons set created_at=now()-interval '2 hours', expires_at=now()-interval '1 second' where plan_id='${PLAN}'`);
    expect(call("read")).toMatchObject({ ok: true, view: { beacon: null } });
  });

  it("removes a sign on advance and does not mistake an old arrival for a new route", () => {
    db().sql(`insert into public.plan_actions(id,plan_id,actor_member_id,type,stop_position)
      values ('55555555-5555-4555-8555-555555555555','${PLAN}','${HOST}','arrived',1)`);
    expect(call("read")).toMatchObject({ ok: true, view: { beacon: null, current: { venueId: "venue-next" } } });
    db().sql(`update public.plans set route_revision=2 where id='${PLAN}'`);
    expect(call("read")).toMatchObject({ ok: true, view: { beacon: null, current: null } });
    expect(call("set")).toEqual({ ok: false, error: "conflict" });
  });

  it("rollback removes the private sign without opening a browser read", () => {
    db().applyFile(join(process.cwd(), "supabase/migrations/rollback/20261031100000_0213_plan_table_beacon_rollback.sql"));
    expect(db().sql("select to_regclass('public.plan_table_beacons') is null")).toBe("t");
    expect(db().sql("select to_regprocedure('public.plan_table_beacon(uuid,text,text,text,text,integer,uuid)') is null")).toBe("t");
    expect(db().sql("select count(*) from public.plan_actions")).not.toBe("0");
  });
});
