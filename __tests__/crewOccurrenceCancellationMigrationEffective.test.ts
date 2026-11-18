import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  STAFF_ROLE, bootCrewAdmissionDatabase, call, crewWith, db, person,
  stopCrewAdmissionDatabase,
} from "./helpers/crewAdmissionHarness";

const directory = join(process.cwd(), "supabase/migrations");
const migration = "20261118100000_0249_crew_occurrence_cancellation.sql";
const signature = "public.cancel_social_crew_occurrence_admin(uuid,uuid,bigint,text,text)";
const reason = "Independent safety review cannot resolve this incident";
const planOf = (crew: string) => db().sql(`select plan_id from public.social_crews where id='${crew}'`);
const status = (crew: string) => db().sql(`select status from public.plans where id='${planOf(crew)}'`);
const revision = (crew: string) => Number(db().sql(`select authority_revision from public.social_crews where id='${crew}'`));
const cancelCall = (crew: string, seen = revision(crew), from = status(crew), staff = STAFF_ROLE, why = reason) =>
  `cancel_social_crew_occurrence_admin('${staff}','${crew}',${seen},'${from}','${why}')`;

function apply(file: string) {
  execFileSync(db().psql, [...db().databaseArgs, "-X", "-q", "-c", "set role pubmax_migrator",
    "-f", join(directory, file)], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

beforeAll(async () => {
  await bootCrewAdmissionDatabase("crew-cancellation-0249", "after");
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".sql") && name >
    "20261117140000_0246_crew_departure_release.sql" && name <= migration).sort()) apply(file);
}, 600_000);
afterAll(stopCrewAdmissionDatabase);

describe("0249: independently authorised cancellation of one Crew occurrence", () => {
  it("reproduces the legacy Plan status RPC refusing the real host token of a Crew-bound Plan", () => {
    const host = person(), guest = person();
    const crew = crewWith(host, [guest]);
    const plan = planOf(crew);
    const token = db().sql(`select token_hash from public.plan_crew_members where plan_id='${plan}' order by joined_at,id limit 1`);
    expect(db().sql(`set role service_role; select public.update_legacy_plan_status_context_atomic(
      '${plan}','${token}','abandoned',null)`)).toBe("not_found");
    expect(status(crew)).toBe("ready");
  });

  it("lets an independent moderator cancel one reviewed occurrence", () => {
    const host = person(), guest = person();
    const crew = crewWith(host, [guest]);
    expect(call(cancelCall(crew))).toMatchObject({ ok: true, code: "cancelled" });
    expect(status(crew)).toBe("abandoned");
  });
});
