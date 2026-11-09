// Migration 0226 on a real PostgreSQL replay: only current members of the
// night read a live position, a seat that ends takes its position with it,
// sharing ends at the Plan's end or 06:00 London time, and no browser role
// reaches the table or the function.

import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asBrowserRole, asServiceRole, postgresSkipReason, startMigratedPostgres, type PostgresSession } from "./helpers/postgres";

const skipReason = postgresSkipReason();
const PLAN = "11111111-1111-4111-8111-226000000001";
const HOST = "22222222-2222-4222-8222-226000000001";
const GUEST = "22222222-2222-4222-8222-226000000002";
const NAME_ONLY = "22222222-2222-4222-8222-226000000003";
const OTHER_PLAN = "11111111-1111-4111-8111-226000000002";
const OTHER_HOST = "22222222-2222-4222-8222-226000000004";
const HOST_HASH = "a".repeat(64);
const GUEST_HASH = "b".repeat(64);
const NAME_ONLY_HASH = "c".repeat(64);
const OTHER_HASH = "d".repeat(64);

const CREW_PLAN = "11111111-1111-4111-8111-226000000003";
const CREW = "33333333-3333-4333-8333-226000000001";
const OWNER_USER = "44444444-4444-4444-8444-226000000001";
const MATE_USER = "44444444-4444-4444-8444-226000000002";
const OWNER_ACCOUNT = "55555555-5555-4555-8555-226000000001";
const MATE_ACCOUNT = "55555555-5555-4555-8555-226000000002";
const OWNER_SEAT = "66666666-6666-4666-8666-226000000001";
const MATE_SEAT = "66666666-6666-4666-8666-226000000002";
const MATE_MEMBER = "77777777-7777-4777-8777-226000000002";

let session: PostgresSession | null = null;
function db(): PostgresSession { if (!session) throw new Error("The test database is not running."); return session; }

type View = { ok: true; view: { live: boolean; endsAt: string | null; sharing: boolean; people: { memberId: string; name: string; latitude: number }[] } };

function call(operation: string, hash: string | null, options: { plan?: string; account?: string | null; lat?: number } = {}) {
  const token = hash ? `'${hash}'` : "null";
  const account = options.account ? `'${options.account}'` : "null";
  const lat = options.lat ?? 51.5138;
  return JSON.parse(db().sql(asServiceRole(`select public.plan_live_location('${options.plan ?? PLAN}', ${token}, ${account}, '${operation}', ${lat}, -0.1318, 12)::text`)));
}

function seed(start = "now()") {
  db().sql(`delete from public.plan_live_locations;
    update public.plans set start_time=${start}, status='active' where id in ('${PLAN}','${OTHER_PLAN}','${CREW_PLAN}');
    update public.plan_crew_members set membership_revoked_at=null;
    update public.social_crew_members set state='active', ended_at=null;`);
}

beforeAll(async () => {
  if (skipReason) return;
  session = await startMigratedPostgres({ label: "live-location-0226", database: "live_location_0226" });
  db().sql(`insert into public.plans(id,title,start_time,status) values
      ('${PLAN}','Our night',now(),'active'), ('${OTHER_PLAN}','Their night',now(),'active');
    insert into public.plan_crew_members(id,plan_id,name,token_hash,can_collaborate,joined_at) values
      ('${HOST}','${PLAN}','Host','${HOST_HASH}',false,now()-interval '2 minutes'),
      ('${GUEST}','${PLAN}','Guest','${GUEST_HASH}',true,now()-interval '1 minute'),
      ('${NAME_ONLY}','${PLAN}','Name only','${NAME_ONLY_HASH}',false,now()),
      ('${OTHER_HOST}','${OTHER_PLAN}','Stranger','${OTHER_HASH}',true,now());
    insert into auth.users(id) values ('${OWNER_USER}'),('${MATE_USER}');
    insert into public.profiles(id,user_id,handle) values
      ('${OWNER_USER}','${OWNER_USER}','crewhost'),('${MATE_USER}','${MATE_USER}','crewmate');
    insert into public.private_social_accounts(id,clerk_user_id,supabase_user_id,profile_id,ownership_state) values
      ('${OWNER_ACCOUNT}','clerk-live-owner','${OWNER_USER}','${OWNER_USER}','active'),
      ('${MATE_ACCOUNT}','clerk-live-mate','${MATE_USER}','${MATE_USER}','active');
    insert into public.plans(id,title,start_time,owner_user_id,status,social_owner_account_id)
      values('${CREW_PLAN}','Open crawl',now(),'${OWNER_USER}','active','${OWNER_ACCOUNT}');
    insert into public.plan_crew_members(id,plan_id,name,token_hash,status,user_id,joined_at,updated_at,can_collaborate,social_account_id) values
      ('${OWNER_SEAT}','${CREW_PLAN}','Crew host','${"e".repeat(64)}','in','${OWNER_USER}',now()-interval '1 minute',now(),true,'${OWNER_ACCOUNT}'),
      ('${MATE_SEAT}','${CREW_PLAN}','Crew mate','${"f".repeat(64)}','in','${MATE_USER}',now(),now(),true,'${MATE_ACCOUNT}');
    insert into public.social_crews(id,plan_id,owner_account_id,visibility) values ('${CREW}','${CREW_PLAN}','${OWNER_ACCOUNT}','open');
    insert into public.social_crew_members(crew_id,social_account_id,plan_member_id,role,state) values
      ('${CREW}','${OWNER_ACCOUNT}','${OWNER_SEAT}','owner','active');
    insert into public.social_crew_members(id,crew_id,social_account_id,plan_member_id,role,state) values
      ('${MATE_MEMBER}','${CREW}','${MATE_ACCOUNT}','${MATE_SEAT}','member','active');`);
}, 600_000);
beforeEach(() => { if (session) seed(); });
afterAll(async () => { await session?.stop(); session = null; });

describe.skipIf(skipReason !== null)("0226 live location database boundary", () => {
  it("shows a sharing member to the crew and to nobody outside it", () => {
    expect(call("share", GUEST_HASH)).toMatchObject({ ok: true, view: { sharing: true, people: [] } });
    const hostView = call("read", HOST_HASH) as View;
    expect(hostView.view.people).toEqual([expect.objectContaining({ memberId: GUEST, name: "Guest", latitude: 51.5138 })]);
    expect(hostView.view.sharing).toBe(false);
    expect(call("read", NAME_ONLY_HASH)).toEqual({ ok: false, error: "not_found" });
    expect(call("read", OTHER_HASH)).toEqual({ ok: false, error: "not_found" });
    expect(call("read", OTHER_HASH, { plan: OTHER_PLAN })).toMatchObject({ ok: true, view: { people: [] } });
    expect(call("share", NAME_ONLY_HASH)).toEqual({ ok: false, error: "not_found" });
  });

  it("keeps only the latest fix for each person", () => {
    call("share", GUEST_HASH, { lat: 51.5 });
    call("share", GUEST_HASH, { lat: 51.6 });
    expect(db().sql(`select count(*)||':'||max(latitude) from public.plan_live_locations where member_id='${GUEST}'`)).toBe("1:51.6");
  });

  it("deletes the position of a removed member and refuses their next read", () => {
    call("share", GUEST_HASH);
    db().sql(`update public.plan_crew_members set membership_revoked_at=now() where id='${GUEST}'`);
    expect(db().sql(`select count(*) from public.plan_live_locations`)).toBe("0");
    expect(call("read", GUEST_HASH)).toEqual({ ok: false, error: "not_found" });
    expect((call("read", HOST_HASH) as View).view.people).toEqual([]);
  });

  it("stops sharing at once", () => {
    call("share", GUEST_HASH);
    expect(call("stop", GUEST_HASH)).toMatchObject({ ok: true, view: { sharing: false } });
    expect((call("read", HOST_HASH) as View).view.people).toEqual([]);
    expect(db().sql(`select count(*) from public.plan_live_locations`)).toBe("0");
  });

  it.each([
    ["an evening start ends with the Plan", "2026-11-07T20:00:00Z", "2026-11-08T04:00:00Z"],
    ["a late start ends at 06:00 in winter", "2026-11-08T01:00:00Z", "2026-11-08T06:00:00Z"],
    ["a late start ends at 06:00 in summer time", "2026-07-11T00:30:00Z", "2026-07-11T05:00:00Z"],
    ["a daytime start ends with the Plan", "2026-07-11T12:00:00Z", "2026-07-11T20:00:00Z"],
  ])("%s", (_name, start, end) => {
    expect(db().sql(asServiceRole(`select to_char(public.plan_live_location_ends_at('${start}') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`))).toBe(end);
  });

  it("refuses to share once the night is over", () => {
    seed(`now() - interval '8 hours'`);
    expect(call("share", GUEST_HASH)).toEqual({ ok: false, error: "ended" });
    expect(call("read", HOST_HASH)).toMatchObject({ ok: true, view: { live: false, endsAt: null, people: [] } });
  });

  it("withholds and deletes an expired position and ends with the Plan", () => {
    call("share", GUEST_HASH);
    db().sql(`update public.plan_live_locations set updated_at=now()-interval '2 minutes', expires_at=now()-interval '1 second'`);
    expect((call("read", HOST_HASH) as View).view.people).toEqual([]);
    expect(db().sql(`select count(*) from public.plan_live_locations`)).toBe("0");
    call("share", GUEST_HASH);
    db().sql(`update public.plans set status='completed' where id='${PLAN}'`);
    expect(db().sql(`select count(*) from public.plan_live_locations`)).toBe("0");
    expect(call("read", HOST_HASH)).toMatchObject({ ok: true, view: { live: false, people: [] } });
    expect(call("share", GUEST_HASH)).toEqual({ ok: false, error: "ended" });
  });

  it("does not open a night that starts tomorrow", () => {
    seed(`now() + interval '1 day'`);
    expect(call("share", GUEST_HASH)).toEqual({ ok: false, error: "ended" });
  });

  it("admits active Open Crew members by account and forgets a member who leaves", () => {
    expect(call("share", null, { plan: CREW_PLAN, account: MATE_ACCOUNT })).toMatchObject({ ok: true, view: { sharing: true } });
    expect((call("read", null, { plan: CREW_PLAN, account: OWNER_ACCOUNT }) as View).view.people)
      .toEqual([expect.objectContaining({ memberId: MATE_SEAT, name: "Crew mate" })]);
    expect(call("read", "e".repeat(64), { plan: CREW_PLAN })).toEqual({ ok: false, error: "not_found" });
    expect(call("read", null, { plan: PLAN, account: MATE_ACCOUNT })).toEqual({ ok: false, error: "not_found" });
    db().sql(`update public.social_crew_members set state='left', ended_at=now() where id='${MATE_MEMBER}'`);
    expect(db().sql(`select count(*) from public.plan_live_locations`)).toBe("0");
    expect(call("read", null, { plan: CREW_PLAN, account: MATE_ACCOUNT })).toEqual({ ok: false, error: "not_found" });
  });

  it("refuses an impossible fix and every browser role", () => {
    expect(call("share", GUEST_HASH, { lat: 91 })).toEqual({ ok: false, error: "invalid" });
    expect(call("teleport", GUEST_HASH)).toEqual({ ok: false, error: "invalid" });
    for (const role of ["anon", "authenticated"] as const) {
      expect(db().expectRefusal(asBrowserRole(role, null, "select * from public.plan_live_locations"))).toMatch(/permission denied/);
      expect(db().expectRefusal(asBrowserRole(role, null, `select public.plan_live_location('${PLAN}','${HOST_HASH}',null,'read')`))).toMatch(/permission denied/);
    }
  });

  it("rollback removes every position and the function", () => {
    call("share", GUEST_HASH);
    db().applyFile(join(process.cwd(), "supabase/migrations/rollback/20261108120000_0226_plan_live_location_rollback.sql"));
    expect(db().sql("select to_regclass('public.plan_live_locations') is null")).toBe("t");
    expect(db().sql("select to_regprocedure('public.plan_live_location(uuid,text,uuid,text,double precision,double precision,integer)') is null")).toBe("t");
    db().applyFile(join(process.cwd(), "supabase/migrations/20261108120000_0226_plan_live_location.sql"));
    expect(db().sql("select to_regclass('public.plan_live_locations') is not null")).toBe("t");
  });
});
