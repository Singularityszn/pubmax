// One rule, two copies: PLAN_TRANSITIONS in lib/plan.ts and the status guard in
// update_legacy_plan_status_context_atomic (0166). Every (from, to) pair must
// get the same answer from both.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { canTransitionPlannedNight, PLANNED_NIGHT_STATUSES } from "@/lib/plan";
import { asServiceRole, postgresSkipReason, startMigratedPostgres, type PostgresSession } from "./helpers/postgres";

const skipReason = postgresSkipReason();
const PLAN = "a1660000-0000-4000-8000-000000000001";
const HOST = "a1660000-0000-4000-8000-000000000002";
const HOST_HASH = "a".repeat(64);
const PAIRS = PLANNED_NIGHT_STATUSES.flatMap((from) => PLANNED_NIGHT_STATUSES.map((to) => [from, to] as const));

let session: PostgresSession | null = null;
function db() { if (!session) throw new Error("The test database is not running."); return session; }

beforeAll(async () => {
  if (skipReason) return;
  session = await startMigratedPostgres({ label: "plan-transition-parity", database: "plan_transition_parity" });
  db().sql(`insert into public.plans(id,title,start_time,status) values ('${PLAN}','Parity night',now(),'draft');
    insert into public.plan_crew_members(id,plan_id,name,token_hash,can_collaborate,joined_at)
    values ('${HOST}','${PLAN}','Host','${HOST_HASH}',true,now());`);
}, 600_000);
afterAll(async () => { await session?.stop(); session = null; });

describe.skipIf(skipReason !== null)("Plan status transitions: TypeScript and SQL agree", () => {
  it("covers all 36 pairs", () => {
    expect(PAIRS).toHaveLength(36);
  });

  it.each(PAIRS)("%s -> %s", (from, to) => {
    db().sql(`update public.plans set status='${from}' where id='${PLAN}'`);
    const sql = db().sql(asServiceRole(`select public.update_legacy_plan_status_context_atomic('${PLAN}','${HOST_HASH}','${to}',null)`));
    expect(sql === "ok").toBe(canTransitionPlannedNight(from, to));
  });
});
