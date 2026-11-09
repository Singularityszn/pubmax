// One rule, two copies: planBeaconLocation in lib/planBeacon.ts and the
// location block of plan_table_beacon (0213). For every Plan status, both
// sides of the night's end and each shape of the latest action, the database
// read and the TypeScript rule must name the same arrival, stop and next stop.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PLANNED_NIGHT_STATUSES, type PlanActionDTO, type PlannedNightStatus, type PlanState } from "@/lib/plan";
import { planBeaconLocation } from "@/lib/planBeacon";
import { asServiceRole, postgresSkipReason, startMigratedPostgres, type PostgresSession } from "./helpers/postgres";

const skipReason = postgresSkipReason();
const PLAN = "a2130000-0000-4000-8000-000000000001";
const HOST = "a2130000-0000-4000-8000-000000000002";
const HOST_HASH = "a".repeat(64);
const HOUR = 60 * 60 * 1000;
const STOPS = [
  { venueId: "venue-first", venueName: "The First", position: 0 },
  { venueId: "venue-last", venueName: "The Last", position: 1 },
];

type Action = { type: "arrived" | "skipped"; position: number; venueId: string; routeRevision: number | null; minutesAgo: number };
const PLAN_REVISION = 2;
const ACTIONS: Record<string, Action[]> = {
  none: [],
  "arrived at the first stop": [{ type: "arrived", position: 0, venueId: "venue-first", routeRevision: 2, minutesAgo: 30 }],
  "arrived at the last stop": [{ type: "arrived", position: 1, venueId: "venue-last", routeRevision: 2, minutesAgo: 30 }],
  "skipped the first stop": [{ type: "skipped", position: 0, venueId: "venue-first", routeRevision: 2, minutesAgo: 30 }],
  "arrived on an older route": [{ type: "arrived", position: 0, venueId: "venue-first", routeRevision: 1, minutesAgo: 30 }],
  "arrived with no route version": [{ type: "arrived", position: 0, venueId: "venue-first", routeRevision: null, minutesAgo: 30 }],
  "arrived at a different pub": [{ type: "arrived", position: 0, venueId: "venue-elsewhere", routeRevision: 2, minutesAgo: 30 }],
  "an arrival after a skip": [
    { type: "skipped", position: 0, venueId: "venue-first", routeRevision: 2, minutesAgo: 40 },
    { type: "arrived", position: 1, venueId: "venue-last", routeRevision: 2, minutesAgo: 20 },
  ],
  "two actions at the same instant": [
    { type: "arrived", position: 0, venueId: "venue-first", routeRevision: 2, minutesAgo: 30 },
    { type: "skipped", position: 1, venueId: "venue-last", routeRevision: 2, minutesAgo: 30 },
  ],
};
const WINDOWS = { "inside the night": -1 * HOUR, "after the night's end": -9 * HOUR } as const;
const CASES = PLANNED_NIGHT_STATUSES.flatMap((status) => Object.keys(WINDOWS).flatMap((window) =>
  Object.keys(ACTIONS).map((actions) => [status, window as keyof typeof WINDOWS, actions] as const)));

let session: PostgresSession | null = null;
function db() { if (!session) throw new Error("The test database is not running."); return session; }

beforeAll(async () => {
  if (skipReason) return;
  session = await startMigratedPostgres({ label: "beacon-location-parity", database: "beacon_location_parity" });
  db().sql(`insert into public.plans(id,title,start_time,status) values ('${PLAN}','Parity night',now(),'active');
    insert into public.plan_stops(plan_id,venue_id,venue_name,position) values
      ${STOPS.map((stop) => `('${PLAN}','${stop.venueId}','${stop.venueName}',${stop.position})`).join(",")};
    insert into public.plan_crew_members(id,plan_id,name,token_hash,can_collaborate,joined_at)
    values ('${HOST}','${PLAN}','Host','${HOST_HASH}',true,now());
    update public.plans set route_revision=${PLAN_REVISION} where id='${PLAN}';`);
}, 600_000);
afterAll(async () => { await session?.stop(); session = null; });

function scenario(status: PlannedNightStatus, startOffset: number, actions: Action[]): PlanState {
  const now = Date.now();
  const startTime = new Date(now + startOffset).toISOString();
  const rows = actions.map((action, index) => ({
    id: `a2130000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`,
    createdAt: new Date(now - action.minutesAgo * 60_000).toISOString(),
    action,
  }));
  db().sql(`delete from public.plan_actions where plan_id='${PLAN}';
    update public.plans set status='${status}', start_time='${startTime}' where id='${PLAN}';
    ${rows.map(({ id, createdAt, action }) => `insert into public.plan_actions(id,plan_id,actor_member_id,type,stop_position,created_at,route_revision,venue_id)
      values ('${id}','${PLAN}','${HOST}','${action.type}',${action.position},'${createdAt}',${action.routeRevision ?? "null"},'${action.venueId}');`).join("\n")}`);
  return {
    plan: { id: PLAN, title: "Parity night", startTime, createdAt: startTime, status, routeRevision: PLAN_REVISION },
    stops: STOPS,
    crew: [],
    actions: rows.map(({ id, createdAt, action }): PlanActionDTO => ({
      id, type: action.type, stopPosition: action.position, ending: null, createdAt, venueId: action.venueId,
      ...(action.routeRevision === null ? {} : { routeRevision: action.routeRevision }),
    })),
  };
}

describe.skipIf(skipReason !== null)("the table beacon location: TypeScript and SQL agree", () => {
  it("names a stop when the latest action is a live arrival", () => {
    const state = scenario("active", WINDOWS["inside the night"], ACTIONS["arrived at the first stop"]!);
    expect(planBeaconLocation(state, new Date())).toMatchObject({ current: { venueId: "venue-first" }, next: { venueId: "venue-last" } });
  });

  it.each(CASES)("%s, %s, %s", (status, window, actions) => {
    const state = scenario(status, WINDOWS[window], ACTIONS[actions]!);
    const read = JSON.parse(db().sql(asServiceRole(`select public.plan_table_beacon('${PLAN}','${HOST_HASH}','read')::text`)));
    expect(read.ok).toBe(true);
    const { routeRevision, arrivalId, current, next } = read.view;
    expect({ routeRevision, arrivalId, current, next }).toEqual(planBeaconLocation(state, new Date()));
  });
});
