// Migration 0231 on a real PostgreSQL replay: an ended Plan takes no new stop
// action and no completion, an earlier action still replays, and completion
// follows the same status table as lib/plan.ts.

import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { canTransitionPlannedNight, PLANNED_NIGHT_STATUSES } from "@/lib/plan";
import { asServiceRole, postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const skipReason = postgresSkipReason();
const directory = join(process.cwd(), "supabase/migrations");
const name = "20261110130000_0231_plan_ended_refuses_actions.sql";
const rollback = "rollback/20261110130000_0231_plan_ended_refuses_actions_rollback.sql";
const PLAN = "a2310000-0000-4000-8000-000000000001";
const HOST = "a2310000-0000-4000-8000-000000000002";
const HOST_HASH = "a".repeat(64);
const ARRIVAL = "a2310000-0000-4000-8000-000000000003";
const GUEST = "a2310000-0000-4000-8000-000000000004";
const GUEST_HASH = "b".repeat(64);

const hex = (value: string) => createHash("sha256").update(value).digest("hex");

let session: PostgresSession | null = null;
function db() { if (!session) throw new Error("The test database is not running."); return session; }

let actionCount = 0;
function act(key: string, actionId = `a2310000-0000-4000-8000-1${String(++actionCount).padStart(11, "0")}`): string {
  return db().sql(asServiceRole(`select public.add_plan_action_idempotent_atomic('${PLAN}','${HOST_HASH}','${actionId}','arrived',1,'${hex(key)}','${hex(`request-${key}`)}',now())`));
}

let completionCount = 0;
function complete(tokenHash = HOST_HASH, arity: 8 | 9 = 9): string {
  const n = String(++completionCount).padStart(11, "0");
  const selection = arity === 9 ? `'{"kind":"get_home","optionId":"walk","evidenceSnapshot":{"label":"Walk home"}}'::jsonb,` : "";
  return db().sql(asServiceRole(`select public.complete_plan_atomic('${PLAN}','${tokenHash}',1,'a2310000-0000-4000-8000-2${n}','a2310000-0000-4000-8000-3${n}','get_home',null,
    ${selection}now())`));
}

function seed(status: string) {
  db().sql(`delete from public.plan_completions where plan_id='${PLAN}';
    delete from public.plan_actions where plan_id='${PLAN}' and id<>'${ARRIVAL}';
    update public.plan_actions set type='arrived', stop_position=0, created_at=now()-interval '1 hour' where id='${ARRIVAL}';
    update public.plans set status='${status}', ending=null where id='${PLAN}';`);
}

beforeAll(async () => {
  if (skipReason) return;
  session = await startPostgres({ label: "plan-ended-0231", database: "plan_ended_0231" });
  try {
    db().applyFile(join(process.cwd(), "scripts/rls/session-fixture.sql"));
    for (const file of readdirSync(directory).filter((entry) => entry.endsWith(".sql") && entry < name).sort()) db().applyFile(join(directory, file));
    db().sql(`insert into public.plans(id,title,start_time,status) values ('${PLAN}','Ended night',now(),'active');
      insert into public.plan_crew_members(id,plan_id,name,token_hash,can_collaborate,joined_at)
        values ('${HOST}','${PLAN}','Host','${HOST_HASH}',true,now()),
          ('${GUEST}','${PLAN}','Guest','${GUEST_HASH}',true,now()+interval '1 second');
      insert into public.plan_stops(plan_id,venue_id,venue_name,position) values
        ('${PLAN}','venue-a','Venue A',0), ('${PLAN}','venue-b','Venue B',1);
      insert into public.plan_actions(id,plan_id,actor_member_id,type,stop_position,created_at,idempotency_key_hash,request_hash)
        values ('${ARRIVAL}','${PLAN}','${HOST}','arrived',0,now()-interval '1 hour','${hex("first-key")}','${hex("request-first-key")}');`);
  } catch (error) { await session.stop(); session = null; throw error; }
}, 600_000);
beforeEach(() => { if (session) seed("active"); });
afterAll(async () => { await session?.stop(); session = null; });

describe.skipIf(skipReason !== null)("0231 an ended Plan refuses actions and completion", () => {
  it("before 0231: an abandoned Plan takes a new arrival and completes", () => {
    seed("abandoned");
    expect(act("before-abandoned")).toBe("applied");
    expect(complete()).toBe("completed");
    expect(db().sql(`select status from public.plans where id='${PLAN}'`)).toBe("completed");
  });

  it("after 0231: an abandoned or completed Plan refuses a new arrival and writes nothing", () => {
    db().applyFile(join(directory, name));
    db().applyFile(join(directory, name));
    for (const status of ["abandoned", "completed"]) {
      seed(status);
      expect(act(`after-${status}`)).toBe("closed");
      expect(db().sql(`select count(*) from public.plan_actions where plan_id='${PLAN}'`)).toBe("1");
    }
  });

  it("after 0231: an earlier arrival still replays on an ended Plan", () => {
    seed("abandoned");
    expect(db().sql(asServiceRole(`select public.add_plan_action_idempotent_atomic('${PLAN}','${HOST_HASH}','${ARRIVAL}','arrived',0,'${hex("first-key")}','${hex("request-first-key")}',now())`))).toBe("replayed");
  });

  it("after 0231: an ending Plan still takes an arrival", () => {
    seed("ending");
    expect(act("after-ending")).toBe("applied");
  });

  it.each(PLANNED_NIGHT_STATUSES)("after 0231: completion from %s matches lib/plan.ts", (status) => {
    seed(status);
    const answer = complete();
    expect(answer === "completed").toBe(canTransitionPlannedNight(status, "completed"));
    if (answer !== "completed") {
      expect(answer).toBe("closed");
      expect(db().sql(`select count(*) from public.plan_completions where plan_id='${PLAN}'`)).toBe("0");
      expect(db().sql(`select status from public.plans where id='${PLAN}'`)).toBe(status);
    }
  });

  it("after 0231: a completed Plan still answers already_completed on a retry", () => {
    seed("active");
    expect(complete()).toBe("completed");
    expect(complete()).toBe("already_completed");
  });

  describe.each([8, 9] as const)("completion RPC with %i arguments", (arity) => {
    it("refuses a collaborating guest and lets the canonical host complete", () => {
      expect(complete(GUEST_HASH, arity)).toBe("forbidden");
      expect(db().sql(`select count(*) from public.plan_completions where plan_id='${PLAN}'`)).toBe("0");
      expect(db().sql(`select count(*) from public.plan_actions where plan_id='${PLAN}' and type='ending'`)).toBe("0");
      expect(db().sql(`select status from public.plans where id='${PLAN}'`)).toBe("active");
      expect(complete(HOST_HASH, arity)).toBe("completed");
      expect(db().sql(`select actor_member_id from public.plan_completions where plan_id='${PLAN}'`)).toBe(HOST);
    });

    it.each([
      ["off-route arrival", "stop_position=7"],
      ["future arrival", "created_at=now()+interval '1 hour'"],
      ["skipped stop", "type='skipped'"],
    ])("refuses completion with only a %s", (_label, change) => {
      db().sql(`update public.plan_actions set ${change} where id='${ARRIVAL}'`);
      expect(complete(HOST_HASH, arity)).toBe("arrival_required");
      expect(db().sql(`select count(*) from public.plan_completions where plan_id='${PLAN}'`)).toBe("0");
      expect(db().sql(`select count(*) from public.plan_actions where plan_id='${PLAN}' and type='ending'`)).toBe("0");
      expect(db().sql(`select status from public.plans where id='${PLAN}'`)).toBe("active");
    });

    it("persists the earliest qualifying arrival and protects its reference", () => {
      db().sql(`insert into public.plan_actions(id,plan_id,actor_member_id,type,stop_position,created_at) values
        ('a2310000-0000-4000-8000-000000000005','${PLAN}','${HOST}','arrived',7,now()-interval '2 hours'),
        ('a2310000-0000-4000-8000-000000000006','${PLAN}','${HOST}','arrived',1,now()+interval '1 hour'),
        ('a2310000-0000-4000-8000-000000000007','${PLAN}','${HOST}','skipped',1,now()-interval '2 hours'),
        ('a2310000-0000-4000-8000-000000000008','${PLAN}','${HOST}','arrived',1,now()-interval '30 minutes');`);
      expect(complete(HOST_HASH, arity)).toBe("completed");
      const stored = JSON.parse(db().sql(`select row_to_json(completion) from public.plan_completions completion where plan_id='${PLAN}'`));
      expect(stored).toMatchObject({
        actor_member_id: HOST,
        route_revision: 1,
        ending: "get_home",
        qualifying_arrival_action_id: ARRIVAL,
        qualifying_arrival_stop_position: 0,
        route_snapshot: [
          { venueId: "venue-a", venueName: "Venue A", position: 0 },
          { venueId: "venue-b", venueName: "Venue B", position: 1 },
        ],
      });
      if (arity === 9) expect(stored.ending_selection).toEqual({ kind: "get_home", optionId: "walk", evidenceSnapshot: { label: "Walk home" } });
      expect(db().sql(`select (completion.qualifying_arrival_at = action.created_at and completion.qualifying_arrival_at <= completion.completed_at)::text
        from public.plan_completions completion join public.plan_actions action on action.id=completion.qualifying_arrival_action_id where completion.plan_id='${PLAN}'`)).toBe("true");
      expect(db().expectRefusal(`update public.plan_completions set qualifying_arrival_at=null where plan_id='${PLAN}'`)).toContain("23514");
      expect(db().expectRefusal(`delete from public.plan_actions where id='${ARRIVAL}'`)).toContain("23503");
      expect(db().sql(`select count(*) from public.plan_completions where plan_id='${PLAN}'`)).toBe("1");
      db().sql(`begin; delete from public.plan_actions where id='${ARRIVAL}'; delete from public.plan_completions where plan_id='${PLAN}'; rollback;`);
      expect(db().sql(`select qualifying_arrival_action_id from public.plan_completions where plan_id='${PLAN}'`)).toBe(ARRIVAL);
    });
  });

  it("rollback restores the old answers", () => {
    db().applyFile(join(directory, rollback));
    seed("abandoned");
    expect(act("rollback-abandoned")).toBe("applied");
    expect(complete()).toBe("completed");
  });
});
