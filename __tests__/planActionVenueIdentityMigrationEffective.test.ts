import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const skipReason = postgresSkipReason();
const migrations = join(process.cwd(), "supabase/migrations");
const name = "20261026120000_0197_plan_action_venue_identity.sql";
const forward = join(migrations, name);
const rollback = join(migrations, "rollback/20261026120000_0197_plan_action_venue_identity_rollback.sql");
const prerequisites = readdirSync(migrations).filter((entry) => entry.endsWith(".sql") && entry < name).sort();
let session: PostgresSession | null = null;
let priorFunctions = "";
const id = (kind: number, suffix: number) => `${kind}0000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const token = (suffix: number) => String(suffix).padStart(64, "0");
const stops = (venues: readonly string[]) => JSON.stringify(venues.map((venueId) => ({ venueId, venueName: venueId })));

function db(): PostgresSession {
  if (!session) throw new Error("PostgreSQL session unavailable");
  return session;
}
function service(statement: string): string {
  return db().sql(`set role service_role; ${statement}; reset role`);
}
function create(suffix: number): void {
  expect(service(`select public.create_plan_idempotent_atomic(
    '${id(1, suffix)}', 'Arrival identity', '2026-10-26T19:00:00Z', '${stops(["a", "b", "c"])}'::jsonb,
    '${id(2, suffix)}', 'Host', '${token(suffix)}', '2026-10-26T18:00:00Z',
    '${token(suffix)}', '${token(suffix)}', null, null, null)`)).toBe("created");
}
function arrive(suffix: number): void {
  service(`insert into public.plan_actions(id,plan_id,actor_member_id,type,stop_position,created_at)
    values('${id(3, suffix)}','${id(1, suffix)}','${id(2, suffix)}','arrived',0,'2026-10-26T19:00:00Z')`);
}
function replace(suffix: number, venues: readonly string[]): void {
  expect(service(`select public.replace_plan_route_atomic('${id(1, suffix)}','${token(suffix)}',1,'${stops(venues)}'::jsonb,null,false)`)).toBe("ok");
}
function complete(suffix: number, revision = 2, legacy = false): string {
  const selection = legacy ? "" : `'{"kind":"get_home","optionId":"station","evidenceSnapshot":{"label":"Station"}}'::jsonb,`;
  return service(`select public.complete_plan_atomic('${id(1, suffix)}','${token(suffix)}',${revision},
    '${id(4, suffix)}','${id(5, suffix)}','get_home',null,${selection}'2026-10-26T22:00:00Z')`);
}
function functions(): string {
  return db().sql(`select string_agg(pg_get_functiondef(oid), E'\n' order by proname) from pg_proc
    where oid in ('public._0075_complete_plan_atomic_8(uuid,text,integer,uuid,uuid,text,text,timestamptz)'::regprocedure,
    'public._0075_complete_plan_atomic_9(uuid,text,integer,uuid,uuid,text,text,jsonb,timestamptz)'::regprocedure)`);
}

function arrivalRpc(suffix: number, revision?: number, attempt = suffix): string {
  return `select public.add_plan_action_idempotent_atomic('${id(1, suffix)}','${token(suffix)}','${id(3, attempt)}','arrived',0,'${token(attempt)}','${token(attempt)}','2026-10-26T19:00:00Z'${revision !== undefined ? `,${revision}` : ""})`;
}
async function waitForActivity(name: string, event?: string, kind?: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const found = await db().sqlAsync(`select count(*)::text from pg_stat_activity where application_name='${name}'
      ${event ? `and wait_event='${event}'` : ""} ${kind ? `and wait_event_type='${kind}'` : ""}`);
    if (found === "1") return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Expected lock schedule did not occur for ${name}`);
}

beforeAll(async () => {
  if (skipReason) return;
  session = await startPostgres({ label: "plan-action-identity-0197", database: "pubmax_action_identity" });
  try {
    db().applyFile(join(process.cwd(), "scripts/rls/session-fixture.sql"));
    for (const entry of prerequisites) db().applyFile(join(migrations, entry));
  } catch (error) {
    await session.stop();
    session = null;
    throw error;
  }
}, 600_000);
afterAll(async () => { await session?.stop(); session = null; });

describe.skipIf(skipReason !== null)("0197 action venue identity", () => {
  it("reproduces the positional completion defect before applying the migration", () => {
    create(1); arrive(1); replace(1, ["d", "e", "f"]);
    expect(complete(1)).toBe("completed");
    create(2); arrive(2);
    create(3); arrive(3); replace(3, ["c", "b", "a"]);
    priorFunctions = functions();
  });

  it("backfills only provable first-revision history and preserves completed replays", () => {
    db().applyFileTransactional(forward);
    expect(db().sql(`select venue_id || ':' || route_revision::text from public.plan_actions where id='${id(3, 2)}'`)).toBe("a:1");
    expect(db().sql(`select (venue_id is null and route_revision is null)::text from public.plan_actions where id='${id(3, 3)}'`)).toBe("true");
    expect(complete(1)).toBe("already_completed");
  });

  it.each([false, true])("refuses a replaced venue in the existing RPC, legacy=%s", (legacy) => {
    const suffix = legacy ? 5 : 4;
    create(suffix); arrive(suffix); replace(suffix, ["d", "e", "f"]);
    expect(complete(suffix, 2, legacy)).toBe("arrival_required");
    expect(db().sql(`select count(*)::text from public.plan_completions where plan_id='${id(1, suffix)}'`)).toBe("0");
  });

  it.each([false, true])("preserves an arrival when its pub moves, legacy=%s", (legacy) => {
    const suffix = legacy ? 7 : 6;
    create(suffix); arrive(suffix); replace(suffix, ["c", "b", "a"]);
    expect(complete(suffix, 2, legacy)).toBe("completed");
    expect(db().sql(`select qualifying_arrival_stop_position::text from public.plan_completions where plan_id='${id(1, suffix)}'`)).toBe("2");
    expect(db().sql(`select venue_id || ':' || stop_position::text || ':' || route_revision::text from public.plan_actions where id='${id(3, suffix)}'`)).toBe("a:0:1");
  });

  it("preserves exact action replays and rejects a new old-client action on an edited route", () => {
    create(11);
    expect(service(arrivalRpc(11, 1))).toBe("applied");
    replace(11, ["c", "b", "a"]);
    expect(service(arrivalRpc(11, 1))).toBe("replayed");
    expect(service(arrivalRpc(11))).toBe("replayed");
    expect(service(arrivalRpc(11, undefined, 12))).toBe("conflict");
  });

  it("keeps the RPC grants and selected-drink completion snapshot", () => {
    expect(db().sql("select has_function_privilege('service_role','public.add_plan_action_idempotent_atomic(uuid,text,uuid,text,integer,text,text,timestamptz,integer)','execute')::text")).toBe("true");
    for (const role of ["anon", "authenticated"]) {
      expect(db().expectRefusal(`set role ${role}; select public.complete_plan_atomic('${id(1, 6)}','${token(6)}',2,'${id(4, 6)}','${id(5, 6)}','get_home',null,'2026-10-26T22:00:00Z')`)).toMatch(/permission denied/i);
      expect(db().sql(`select has_function_privilege('${role}','public.add_plan_action_idempotent_atomic(uuid,text,uuid,text,integer,text,text,timestamptz,integer)','execute')::text`)).toBe("false");
    }
    create(8); arrive(8);
    const price = { category: "wine", pence: 550, serving: null, source: "community", reportedAt: "2026-10-25T12:00:00.000Z" };
    service(`update public.plan_stops set selected_drink_price_evidence='${JSON.stringify(price)}'::jsonb where plan_id='${id(1, 8)}' and position=0`);
    expect(complete(8, 1)).toBe("completed");
    const snapshot = JSON.parse(db().sql(`select route_snapshot::text from public.plan_completions where plan_id='${id(1, 8)}'`));
    expect(snapshot[0].selectedDrinkPriceEvidence).toEqual(price);
  });

  it("serializes an arrival before replacement without changing its venue", async () => {
    create(9);
    const arrival = db().sqlAsync(`begin; set local application_name='arrival-identity-first'; set local role service_role;
      ${arrivalRpc(9, 1)}; select pg_sleep(3); commit`);
    await waitForActivity("arrival-identity-first", "PgSleep");
    const replacement = db().sqlAsync(`begin; set local application_name='arrival-identity-replace'; set local role service_role;
      select public.replace_plan_route_atomic('${id(1, 9)}','${token(9)}',1,'${stops(["d", "e", "f"])}'::jsonb,null,false); commit`);
    await waitForActivity("arrival-identity-replace", undefined, "Lock");
    await Promise.all([arrival, replacement]);
    expect(db().sql(`select venue_id from public.plan_actions where id='${id(3, 9)}'`)).toBe("a");
    expect(complete(9)).toBe("arrival_required");
  });

  it("refuses a stale arrival that waits behind a route replacement", async () => {
    create(10);
    const replacement = db().sqlAsync(`begin; set local application_name='arrival-identity-edit-first'; set local role service_role;
      select public.replace_plan_route_atomic('${id(1, 10)}','${token(10)}',1,'${stops(["d", "e", "f"])}'::jsonb,null,false);
      select pg_sleep(3); commit`);
    await waitForActivity("arrival-identity-edit-first", "PgSleep");
    const arrival = db().sqlAsync(`begin; set local application_name='arrival-identity-stale'; set local role service_role; ${arrivalRpc(10, 1)}; commit`);
    await waitForActivity("arrival-identity-stale", undefined, "Lock");
    const [, outcome] = await Promise.all([replacement, arrival]);
    expect(outcome).toContain("conflict");
    expect(db().sql(`select count(*)::text from public.plan_actions where plan_id='${id(1, 10)}'`)).toBe("0");
  });

  it("restores the previous functions on rollback without erasing completion history", () => {
    const history = db().sql("select jsonb_agg(to_jsonb(c) order by plan_id)::text from public.plan_completions c");
    db().applyFileTransactional(rollback);
    expect(functions()).toBe(priorFunctions);
    expect(db().sql("select jsonb_agg(to_jsonb(c) order by plan_id)::text from public.plan_completions c")).toBe(history);
    expect(db().sql("select count(*)::text from information_schema.columns where table_schema='public' and table_name='plan_actions' and column_name in ('venue_id','route_revision')")).toBe("0");
  });
});
