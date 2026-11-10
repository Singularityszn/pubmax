// Migration 0226 on a real PostgreSQL replay: only current members of the
// night read a live position, a seat that ends takes its position with it,
// sharing ends at the Plan's end or 06:00 London time, and no browser role
// reaches the table or the function.

import { join } from "node:path";
import { spawn } from "node:child_process";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET, PUT } from "@/app/api/plans/[id]/live-location/route";
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

function call(operation: string, hash: string | null, options: { plan?: string; account?: string | null; lat?: number; startAt?: string } = {}) {
  const token = hash ? `'${hash}'` : "null";
  const account = options.account ? `'${options.account}'` : "null";
  const lat = options.lat ?? 51.5138;
  const startAt = options.startAt ? `'${options.startAt}'::timestamptz` : "null";
  return JSON.parse(db().sql(asServiceRole(`select public.plan_live_location('${options.plan ?? PLAN}', ${token}, ${account}, '${operation}', ${lat}, -0.1318, 12, ${startAt})::text`)));
}

const tapTime = () => db().sql("select clock_timestamp()::text");

function blockedQuery(statement: string) {
  const reader = spawn(db().psql, [...db().databaseArgs, "-q", "-t", "-A", "-c", `
    set client_min_messages=log;
    set log_lock_waits=on;
    ${statement}`], { env: { ...process.env, LC_ALL: "C" }, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  reader.stdout.on("data", (chunk) => { stdout += String(chunk); });
  const result = new Promise<string>((resolve, reject) => {
    reader.once("error", reject);
    reader.once("close", (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr)));
  });
  const blocked = new Promise<void>((resolve, reject) => {
    reader.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      if (/still waiting for .* after [\d.]+ ms/.test(stderr)) resolve();
    });
    void result.then(() => reject(new Error("Reader completed before waiting for the writer.")), reject);
  });
  return { blocked, result };
}

function seed(start = "now() + interval '3 hours'") {
  db().sql(`delete from public.plan_live_locations;
    delete from public.plan_live_location_stops;
    update public.social_crews set owner_account_id='${OWNER_ACCOUNT}' where id='${CREW}';
    update public.plans set social_owner_account_id='${OWNER_ACCOUNT}' where id='${CREW_PLAN}';
    update public.plans set start_time=${start}, status='active' where id in ('${PLAN}','${OTHER_PLAN}','${CREW_PLAN}');
    update public.plan_crew_members set membership_revoked_at=null;
    update public.social_crew_members set state='active', ended_at=null;
    update public.private_social_accounts set ownership_state='active' where id='${OWNER_ACCOUNT}';
    select public.set_social_block('${OWNER_USER}', '${MATE_USER}', false);
    select public.set_social_block('${MATE_USER}', '${OWNER_USER}', false);`);
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
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
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

  it("lets a classic seat stop itself without permission to read the crew", () => {
    call("share", HOST_HASH);
    expect(call("read", NAME_ONLY_HASH)).toEqual({ ok: false, error: "not_found" });
    expect(call("stop", NAME_ONLY_HASH)).toMatchObject({ ok: true, view: { sharing: false, people: [] } });
    expect(db().sql(`select count(*) from public.plan_live_location_stops where member_id='${NAME_ONLY}'`)).toBe("1");
    expect(db().sql(`select count(*) from public.plan_live_locations where member_id='${HOST}'`)).toBe("1");
    expect(call("read", NAME_ONLY_HASH)).toEqual({ ok: false, error: "not_found" });
    expect(call("share", NAME_ONLY_HASH)).toEqual({ ok: false, error: "not_found" });
  });

  it.each([
    ["Plan", PLAN, GUEST_HASH, null],
    ["crew", CREW_PLAN, null, MATE_ACCOUNT],
  ])("revokes every client of the same %s seat until a new explicit start", (_name, plan, hash, account) => {
    const options = { plan: plan!, account };
    expect(call("share", hash, { ...options, startAt: tapTime() })).toMatchObject({ ok: true });
    expect(call("share", hash, { ...options, startAt: tapTime() })).toMatchObject({ ok: true });
    expect(call("stop", hash, options)).toMatchObject({ ok: true, view: { sharing: false } });
    expect(call("share", hash, options)).toEqual({ ok: false, error: "stopped" });
    expect(db().sql(`select count(*) from public.plan_live_locations where plan_id='${plan}'`)).toBe("0");
    expect(call("read", hash, options)).toMatchObject({ ok: true, view: { sharing: false } });
    expect(call("share", hash, { ...options, startAt: tapTime() })).toMatchObject({ ok: true, view: { sharing: true } });
    expect(call("share", hash, options)).toMatchObject({ ok: true, view: { sharing: true } });
    expect(db().sql(`select count(*) from public.plan_live_location_stops where plan_id='${plan}'`)).toBe("0");
  });

  it.each([
    ["Plan", PLAN, GUEST_HASH, null],
    ["crew", CREW_PLAN, null, MATE_ACCOUNT],
  ])("refuses the %s client's delayed first fix when its tap preceded Stop", (_name, plan, hash, account) => {
    const options = { plan: plan!, account };
    const startAt = tapTime();
    call("stop", hash, options);
    expect(call("share", hash, { ...options, startAt })).toEqual({ ok: false, error: "stopped" });
    expect(db().sql(`select count(*) from public.plan_live_locations where plan_id='${plan}'`)).toBe("0");
    expect(call("read", hash, options)).toMatchObject({ ok: true, view: { sharing: false, people: [] } });
    expect(call("share", hash, { ...options, startAt: tapTime() })).toMatchObject({ ok: true, view: { sharing: true } });
  });

  it.each(["left", "removed"])("keeps Stop when a Crew member is %s and rejoins the same night", (state) => {
    const options = { plan: CREW_PLAN, account: MATE_ACCOUNT };
    const startAt = tapTime();
    call("stop", null, options);
    db().sql(`update public.social_crew_members set state='${state}', ended_at=now() where id='${MATE_MEMBER}'`);
    expect(call("read", null, { plan: CREW_PLAN, account: OWNER_ACCOUNT })).toMatchObject({ ok: true, view: { people: [] } });
    expect(db().sql(`select public._activate_social_crew_member('${CREW}','${MATE_ACCOUNT}')`)).toBe(MATE_MEMBER);
    expect(call("share", null, options)).toEqual({ ok: false, error: "stopped" });
    expect(call("share", null, { ...options, startAt })).toEqual({ ok: false, error: "stopped" });
    expect(call("share", null, { ...options, startAt: tapTime() })).toMatchObject({ ok: true, view: { sharing: true } });
  });

  it("keeps Stop through Plan seat revocation and restoration", () => {
    call("stop", GUEST_HASH);
    db().sql(`update public.plan_crew_members set membership_revoked_at=now() where id='${GUEST}'`);
    call("read", HOST_HASH);
    db().sql(`update public.plan_crew_members set membership_revoked_at=null where id='${GUEST}'`);
    expect(call("share", GUEST_HASH)).toEqual({ ok: false, error: "stopped" });
    expect(call("share", GUEST_HASH, { startAt: tapTime() })).toMatchObject({ ok: true, view: { sharing: true } });
  });

  it("expires stopped markers with the night and removes them when it ends", () => {
    call("stop", GUEST_HASH);
    expect(db().sql(`select expires_at=public.plan_live_location_ends_at(start_time)
      from public.plan_live_location_stops join public.plans on plans.id=plan_id`)).toBe("t");
    db().sql(`update public.plan_live_location_stops set expires_at=now()-interval '1 second'`);
    call("read", HOST_HASH);
    expect(db().sql(`select count(*) from public.plan_live_location_stops`)).toBe("0");
    call("stop", GUEST_HASH);
    db().sql(`update public.plans set status='completed' where id='${PLAN}'`);
    expect(db().sql(`select count(*) from public.plan_live_location_stops`)).toBe("0");
  });

  it.each([
    ["an evening start ends with the Plan", "2026-11-07T20:00:00Z", "2026-11-08T04:00:00Z"],
    ["a late start ends at 06:00 in winter", "2026-11-08T01:00:00Z", "2026-11-08T06:00:00Z"],
    ["an 08:00 winter start ends at the intervening 06:00", "2026-11-08T08:00:00Z", "2026-11-08T06:00:00Z"],
    ["a window opening at 06:00 ends with the Plan", "2026-11-08T09:00:00Z", "2026-11-08T17:00:00Z"],
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

  it.each(["read", "share"])("refuses %s when the Crew owner is suspended", (operation) => {
    expect(call("share", null, { plan: CREW_PLAN, account: MATE_ACCOUNT }))
      .toMatchObject({ ok: true, view: { sharing: true } });
    db().sql(`update public.private_social_accounts set ownership_state='suspended' where id='${OWNER_ACCOUNT}'`);

    expect(call(operation, null, { plan: CREW_PLAN, account: MATE_ACCOUNT, lat: 52 }))
      .toEqual({ ok: false, error: "not_found" });
    expect(db().sql(`select latitude from public.plan_live_locations where member_id='${MATE_SEAT}'`)).toBe("51.5138");
    expect(db().sql("select count(*) from public.plan_live_location_stops")).toBe("0");
  });

  it.each([
    ["owner", OWNER_USER, MATE_USER],
    ["member", MATE_USER, OWNER_USER],
  ])("withholds live locations when the %s blocks the other person", (_name, blocker, blocked) => {
    expect(call("share", null, { plan: CREW_PLAN, account: OWNER_ACCOUNT }))
      .toMatchObject({ ok: true, view: { sharing: true } });
    expect(call("share", null, { plan: CREW_PLAN, account: MATE_ACCOUNT }))
      .toMatchObject({ ok: true, view: { sharing: true, people: [expect.objectContaining({ memberId: OWNER_SEAT, latitude: 51.5138 })] } });
    db().sql(asServiceRole(`select public.set_social_block('${blocker}', '${blocked}', true)`));

    for (const operation of ["read", "share"]) {
      expect(call(operation, null, { plan: CREW_PLAN, account: MATE_ACCOUNT }))
        .toEqual({ ok: false, error: "not_found" });
      expect(call(operation, null, { plan: CREW_PLAN, account: OWNER_ACCOUNT }))
        .toMatchObject({ ok: true, view: { people: [] } });
    }
    expect(db().sql(`select state from public.social_crew_members where id='${MATE_MEMBER}'`)).toBe("active");
    expect(db().sql(`select count(*) from public.plan_live_locations where member_id='${MATE_SEAT}'`)).toBe("1");
  });

  it.each(["owner block", "member block", "owner suspension"])("honours Stop during %s without disclosing other people", (restriction) => {
    const options = { plan: CREW_PLAN, account: MATE_ACCOUNT };
    const ownerOptions = { plan: CREW_PLAN, account: OWNER_ACCOUNT };
    expect(call("share", null, ownerOptions)).toMatchObject({ ok: true, view: { sharing: true } });
    const startAt = tapTime();
    expect(call("share", null, { ...options, startAt })).toMatchObject({ ok: true, view: { sharing: true } });
    const blocker = restriction === "member block" ? MATE_USER : OWNER_USER;
    const blocked = restriction === "member block" ? OWNER_USER : MATE_USER;
    if (restriction === "owner suspension") {
      db().sql(`update public.private_social_accounts set ownership_state='suspended' where id='${OWNER_ACCOUNT}'`);
    } else {
      db().sql(asServiceRole(`select public.set_social_block('${blocker}', '${blocked}', true)`));
    }
    expect(call("read", null, options)).toEqual({ ok: false, error: "not_found" });
    expect(call("stop", null, options)).toMatchObject({ ok: true, view: { sharing: false, people: [] } });
    expect(db().sql(`select count(*) from public.plan_live_location_stops where member_id='${MATE_SEAT}'`)).toBe("1");
    expect(db().sql(`select count(*) from public.plan_live_locations where member_id='${MATE_SEAT}'`)).toBe("0");
    expect(db().sql(`select count(*) from public.plan_live_locations where member_id='${OWNER_SEAT}'`)).toBe("1");
    expect(call("read", null, options)).toEqual({ ok: false, error: "not_found" });
    if (restriction === "owner suspension") {
      db().sql(`update public.private_social_accounts set ownership_state='active' where id='${OWNER_ACCOUNT}'`);
    } else {
      db().sql(asServiceRole(`select public.set_social_block('${blocker}', '${blocked}', false)`));
    }
    expect(call("read", null, ownerOptions)).toMatchObject({ ok: true, view: { people: [] } });
    expect(call("share", null, options)).toEqual({ ok: false, error: "stopped" });
    expect(call("share", null, { ...options, startAt })).toEqual({ ok: false, error: "stopped" });
    expect(call("share", null, { ...options, startAt: tapTime() })).toMatchObject({ ok: true, view: { sharing: true } });
    expect(call("read", null, ownerOptions)).toMatchObject({ ok: true, view: { people: [expect.objectContaining({ memberId: MATE_SEAT })] } });
  });

  it("lets a suspended owner revoke sharing through DELETE without reopening reads or uploads", async () => {
    vi.stubEnv("SUPABASE_URL", "https://live-location.test");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "fixture-key");
    vi.stubEnv("PUBMAX_SOCIAL_FRIENDS_LAUNCH", "1");
    const literal = (value: unknown) => value == null ? "null" : `'${String(value).replaceAll("'", "''")}'`;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const received = new Request(input, init);
      const url = new URL(received.url);
      if (url.hostname !== "live-location.test") throw new Error("Unexpected fixture host.");
      const json = (body: unknown, status = 200) => Response.json(body, { status });
      const sqlJson = (sql: string) => json(JSON.parse(db().sql(asServiceRole(sql))));
      if (url.pathname === "/auth/v1/user") {
        return received.headers.get("authorization") === "Bearer owner-token"
          ? json({ id: OWNER_USER, aud: "authenticated", role: "authenticated" })
          : json({ code: "bad_jwt", msg: "Invalid token" }, 401);
      }
      if (url.pathname === "/rest/v1/rpc/check_rate_limit") return json(false);
      if (url.pathname === "/rest/v1/rpc/provision_social_product_account") {
        const body = await received.json();
        return sqlJson(`select public.provision_social_product_account(${literal(body.p_supabase_user_id)})::text`);
      }
      if (url.pathname === "/rest/v1/private_social_accounts") {
        const filters = ["id", "supabase_user_id"].flatMap((column) => {
          const filter = url.searchParams.get(column);
          return filter?.startsWith("eq.") ? [`${column}=${literal(filter.slice(3))}`] : [];
        });
        if (filters.length === 0) throw new Error("An account owner filter is required.");
        return sqlJson(`select coalesce(jsonb_agg(r), '[]'::jsonb)::text from (
          select id,clerk_user_id,supabase_user_id,profile_id,ownership_state
          from public.private_social_accounts where ${filters.join(" and ")}
        ) r`);
      }
      if (url.pathname === "/rest/v1/profiles") {
        return sqlJson(`select jsonb_agg(r)::text from (
          select id,user_id,handle from public.profiles where id='${OWNER_USER}'
        ) r`);
      }
      if (url.pathname === "/rest/v1/private_account_identities") return json([{ date_of_birth: "1990-01-01" }]);
      if (url.pathname === "/rest/v1/adult_self_assertions") return json([]);
      if (url.pathname === "/rest/v1/rpc/plan_live_location") {
        const body = await received.json();
        const args = [body.p_plan_id, body.p_token_hash, body.p_social_account_id, body.p_operation,
          body.p_latitude, body.p_longitude, body.p_accuracy_m, body.p_start_at].map(literal).join(",");
        return sqlJson(`select public.plan_live_location(${args})::text`);
      }
      throw new Error(`Unexpected fixture path: ${url.pathname}`);
    });
    const send = (method: "GET" | "PUT" | "DELETE", body?: unknown, token = "owner-token") => {
      const request = new Request(`https://app.test/api/plans/${CREW_PLAN}/live-location?via=crew`, {
        method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return ({ GET, PUT, DELETE })[method](request, { params: Promise.resolve({ id: CREW_PLAN }) });
    };
    const fix = { latitude: 51.5138, longitude: -0.1318, accuracyM: 12 };
    const oldTap = Date.now();
    expect((await send("PUT", { ...fix, startAt: oldTap })).status).toBe(200);
    expect(call("share", null, { plan: CREW_PLAN, account: MATE_ACCOUNT })).toMatchObject({ ok: true });
    db().sql(`update public.private_social_accounts set ownership_state='suspended' where id='${OWNER_ACCOUNT}'`);
    for (const method of ["GET", "PUT"] as const) {
      const refused = await send(method, method === "PUT" ? fix : undefined);
      expect(refused.status).toBe(403);
      expect(await refused.json()).toMatchObject({ code: "SOCIAL_ACCOUNT_SUSPENDED" });
    }
    const unauthorised = await send("DELETE", undefined, "invalid-token");
    expect(unauthorised.status).toBe(401);
    expect(await unauthorised.json()).toMatchObject({ code: "SOCIAL_SIGN_IN_REQUIRED" });
    expect(db().sql(`select count(*) from public.plan_live_location_stops where member_id='${OWNER_SEAT}'`)).toBe("0");
    expect(db().sql(`select count(*) from public.plan_live_locations where member_id='${OWNER_SEAT}'`)).toBe("1");
    const stopped = await send("DELETE");
    expect(stopped.status).toBe(200);
    expect(stopped.headers.get("cache-control")).toBe("private, no-store");
    expect(await stopped.json()).toMatchObject({ sharing: false, people: [] });
    expect(db().sql(`select count(*) from public.plan_live_location_stops where member_id='${OWNER_SEAT}'`)).toBe("1");
    expect(db().sql(`select count(*) from public.plan_live_locations where member_id='${OWNER_SEAT}'`)).toBe("0");
    expect(db().sql(`select count(*) from public.plan_live_locations where member_id='${MATE_SEAT}'`)).toBe("1");
    db().sql(`update public.private_social_accounts set ownership_state='active' where id='${OWNER_ACCOUNT}'`);
    expect(call("read", null, { plan: CREW_PLAN, account: MATE_ACCOUNT })).toMatchObject({ ok: true, view: { people: [] } });
    for (const body of [fix, { ...fix, startAt: oldTap }]) {
      const refused = await send("PUT", body);
      expect(refused.status).toBe(409);
      expect(await refused.json()).toMatchObject({ code: "PLAN_LIVE_LOCATION_STOPPED" });
    }
    expect((await send("PUT", { ...fix, startAt: Date.now() })).status).toBe(200);
    expect(call("read", null, { plan: CREW_PLAN, account: MATE_ACCOUNT })).toMatchObject({
      ok: true, view: { people: [expect.objectContaining({ memberId: OWNER_SEAT, latitude: fix.latitude })] },
    });
  });

  it.each([
    ["read", OWNER_USER, MATE_USER], ["share", OWNER_USER, MATE_USER],
    ["read", MATE_USER, OWNER_USER], ["share", MATE_USER, OWNER_USER],
  ])("refuses %s after a concurrent block by %s and preserves Stop", async (operation, blocker, blocked) => {
    call("stop", null, { plan: CREW_PLAN, account: MATE_ACCOUNT });
    const startAt = tapTime();
    const writer = spawn(db().psql, [...db().databaseArgs, "-q", "-t", "-A"], { stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    writer.stderr.on("data", (chunk) => { stderr += String(chunk); });
    const finished = new Promise<void>((resolve, reject) => {
      writer.once("error", reject);
      writer.once("exit", (code) => code === 0 ? resolve() : reject(new Error(stderr)));
    });
    const ready = new Promise<void>((resolve, reject) => {
      let output = "";
      writer.stdout.on("data", (chunk) => {
        output += String(chunk);
        if (output.includes("PLAN_LOCKED")) resolve();
      });
      writer.once("error", reject);
      writer.once("exit", () => reject(new Error(`Writer exited before release: ${stderr}`)));
    });
    writer.stdin.write(`begin;
      select 1 from public.plans where id='${CREW_PLAN}' for update;
      \\echo PLAN_LOCKED
    `);
    let response: Promise<string> | undefined;
    try {
      await ready;
      const reader = blockedQuery(asServiceRole(`
        select public.plan_live_location('${CREW_PLAN}', null, '${MATE_ACCOUNT}', '${operation}', 51.5, -0.13, 12, '${startAt}')::text`));
      response = reader.result;
      await reader.blocked;
      writer.stdin.end(`select public.set_social_block('${blocker}', '${blocked}', true);
        select public.plan_live_location('${CREW_PLAN}', null, '${OWNER_ACCOUNT}', 'share', 52, -0.13, 12);
        commit;\n`);
      await finished;
      expect(JSON.parse(await response)).toEqual({ ok: false, error: "not_found" });
      expect(db().sql(`select latitude from public.plan_live_locations where member_id='${OWNER_SEAT}'`)).toBe("52");
      expect(db().sql(`select count(*) from public.plan_live_locations where member_id='${MATE_SEAT}'`)).toBe("0");
      expect(db().sql(`select count(*) from public.plan_live_location_stops where member_id='${MATE_SEAT}'`)).toBe("1");
    } finally {
      if (!writer.stdin.writableEnded) writer.stdin.end("rollback;\n");
      await finished;
      await response;
    }
  });

  it.each(["read", "share", "stop"])("checks the committed owner after a concurrent transfer during %s", async (operation) => {
    call("share", null, { plan: CREW_PLAN, account: OWNER_ACCOUNT });
    db().sql(asServiceRole(`select public.set_social_block('${MATE_USER}', '${OWNER_USER}', true)`));
    const writer = spawn(db().psql, [...db().databaseArgs, "-q", "-t", "-A"], { stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    writer.stderr.on("data", (chunk) => { stderr += String(chunk); });
    const finished = new Promise<void>((resolve, reject) => {
      writer.once("error", reject);
      writer.once("exit", (code) => code === 0 ? resolve() : reject(new Error(stderr)));
    });
    const ready = new Promise<void>((resolve, reject) => {
      let output = "";
      writer.stdout.on("data", (chunk) => {
        output += String(chunk);
        if (output.includes("OWNER_CHANGED")) resolve();
      });
      writer.once("error", reject);
      writer.once("exit", () => reject(new Error(`Transfer exited before release: ${stderr}`)));
    });
    writer.stdin.write(`begin;
      select 1 from public.social_crews where id='${CREW}' for update;
      update public.social_crews set owner_account_id='${MATE_ACCOUNT}' where id='${CREW}';
      update public.plans set social_owner_account_id='${MATE_ACCOUNT}' where id='${CREW_PLAN}';
      \\echo OWNER_CHANGED
    `);
    let response: Promise<string> | undefined;
    try {
      await ready;
      const reader = blockedQuery(asServiceRole(`
        select public.plan_live_location('${CREW_PLAN}', null, '${OWNER_ACCOUNT}', '${operation}', 51.5, -0.13, 12)::text`));
      response = reader.result;
      await reader.blocked;
      writer.stdin.end("commit;\n");
      await finished;
      expect(JSON.parse(await response)).toEqual(operation === "stop"
        ? { ok: true, view: { visibility: "member", live: true, endsAt: expect.any(String), sharing: false, people: [] } }
        : { ok: false, error: "not_found" });
    } finally {
      if (!writer.stdin.writableEnded) writer.stdin.end("rollback;\n");
      await finished;
      await response;
    }
  });

  it("refuses an impossible fix and every browser role", () => {
    expect(call("share", GUEST_HASH, { lat: 91 })).toEqual({ ok: false, error: "invalid" });
    expect(call("teleport", GUEST_HASH)).toEqual({ ok: false, error: "invalid" });
    for (const role of ["anon", "authenticated"] as const) {
      expect(db().expectRefusal(asBrowserRole(role, null, "select * from public.plan_live_locations"))).toMatch(/permission denied/);
      expect(db().expectRefusal(asBrowserRole(role, null, "select * from public.plan_live_location_stops"))).toMatch(/permission denied/);
      expect(db().expectRefusal(asBrowserRole(role, null, `select public.plan_live_location('${PLAN}','${HOST_HASH}',null,'read')`))).toMatch(/permission denied/);
    }
  });

  it("rollback removes every position and the function", () => {
    call("share", GUEST_HASH);
    db().applyFile(join(process.cwd(), "supabase/migrations/rollback/20261108120000_0226_plan_live_location_rollback.sql"));
    expect(db().sql("select to_regclass('public.plan_live_locations') is null")).toBe("t");
    expect(db().sql("select to_regclass('public.plan_live_location_stops') is null")).toBe("t");
    expect(db().sql("select to_regprocedure('public.plan_live_location(uuid,text,uuid,text,double precision,double precision,integer,timestamptz)') is null")).toBe("t");
    db().applyFile(join(process.cwd(), "supabase/migrations/20261108120000_0226_plan_live_location.sql"));
    expect(db().sql("select to_regclass('public.plan_live_locations') is not null")).toBe("t");
  });
});
