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

const hex = (value: string) => createHash("sha256").update(value).digest("hex");

let session: PostgresSession | null = null;
function db() { if (!session) throw new Error("The test database is not running."); return session; }

let actionCount = 0;
function act(key: string, actionId = `a2310000-0000-4000-8000-1${String(++actionCount).padStart(11, "0")}`): string {
  return db().sql(asServiceRole(`select public.add_plan_action_idempotent_atomic('${PLAN}','${HOST_HASH}','${actionId}','arrived',1,'${hex(key)}','${hex(`request-${key}`)}',now())`));
}

let completionCount = 0;
function complete(): string {
  const n = String(++completionCount).padStart(11, "0");
  return db().sql(asServiceRole(`select public.complete_plan_atomic('${PLAN}','${HOST_HASH}',1,'a2310000-0000-4000-8000-2${n}','a2310000-0000-4000-8000-3${n}','get_home',null,
    '{"kind":"get_home","optionId":"walk","evidenceSnapshot":{"label":"Walk home"}}'::jsonb,now())`));
}

function seed(status: string) {
  db().sql(`delete from public.plan_completions where plan_id='${PLAN}';
    delete from public.plan_actions where plan_id='${PLAN}' and id<>'${ARRIVAL}';
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
        values ('${HOST}','${PLAN}','Host','${HOST_HASH}',true,now());
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

  it("rollback restores the old answers", () => {
    db().applyFile(join(directory, rollback));
    seed("abandoned");
    expect(act("rollback-abandoned")).toBe("applied");
    expect(complete()).toBe("completed");
  });
});
