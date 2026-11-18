import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asServiceRole } from "./helpers/postgres";
import {
  type Person, MIGRATOR, STAFF_ROLE, DIGEST, blockCall, bootCrewAdmissionDatabase, call, crewWith, db,
  deleteAccount, hold, key, memberId, outcome, person, rpc, stopCrewAdmissionDatabase,
  suspendCall, waitsOnAnyLock,
} from "./helpers/crewAdmissionHarness";
import { nextSeeAgainPair, seeAgainWindow, SEE_AGAIN_MUTUAL_MS, type SeeAgainPairState, type SeeAgainPairEvent } from "@/lib/crewSeeAgain";
import { OPEN_CRAWL_ARRIVAL_CLOSE_MS } from "@/lib/nightWindows";

const migration = "20261118100000_0250_crew_see_again.sql";
const migrations = join(process.cwd(), "supabase/migrations");
function apply(file: string) {
  execFileSync(db().psql, [...db().databaseArgs, "-X", "-q", "-c", `set role ${MIGRATOR}`, "-f", join(migrations, file)], { stdio: "pipe" });
}
beforeAll(async () => {
  await bootCrewAdmissionDatabase("crew-see-again-0250", "after");
  apply("20261117150000_0247_crew_host_attendance.sql");
  apply("20261117160000_0248_crew_block_cases.sql");
  if (existsSync(join(migrations, migration))) apply(migration);
}, 600_000);
afterAll(stopCrewAdmissionDatabase);

const neutral = { ok: true };
const chooseCall = (a: Person, crew: string, b: Person, context = "friendship", action = "choose", consent = true) =>
  `write_social_crew_see_again('${a.account}','${a.profile}','${crew}','${memberId(crew, b)}','${context}','${action}',${consent})`;
const choose = (a: Person, crew: string, b: Person, context?: string, action?: string, consent?: boolean) =>
  call(chooseCall(a, crew, b, context, action, consent));
const readCall = (a: Person, crew: string) => `read_social_crew_see_again('${a.account}','${a.profile}','${crew}')`;
type View = { open: boolean; closesAt: string; items: { memberId: string; handle: string; choice: string; mutual: boolean }[] };
const read = (a: Person, crew: string): View | null => JSON.parse(db().sql(asServiceRole(rpc(readCall(a, crew)))) || "null");
const item = (a: Person, crew: string, b: Person) => read(a, crew)?.items.find(x => x.memberId === memberId(crew, b));
const starts = (crew: string, interval: string) => db().sql(`update public.plans set start_time=now()+interval '${interval}' where id=(select plan_id from public.social_crews where id='${crew}')`);
function adult() {
  const p = person();
  db().sql(`insert into public.adult_self_assertions(user_id) values ('${p.user}')`);
  return p;
}
function night(guests?: Person[]) {
  const host = adult(), participants = guests ?? [adult(), adult()];
  const a = participants[0]!, b = participants[1]!;
  const crew = crewWith(host, participants);
  starts(crew, "-1 hour");
  for (const p of participants) expect(call(`attest_social_crew_attendance_atomic('${host.account}','${crew}','${memberId(crew, p)}','attended',0,'${key()}','${DIGEST}')`)).toMatchObject({ ok: true });
  starts(crew, "-13 hours");
  return { host, a, b, crew };
}
const matched = () => {
  const n = night();
  expect(choose(n.a, n.crew, n.b)).toEqual(neutral);
  expect(choose(n.b, n.crew, n.a)).toEqual(neutral);
  expect(item(n.a, n.crew, n.b)?.mutual).toBe(true);
  return n;
};
const rows = (crew: string) => db().sql(`select count(*) from public.social_crew_see_again_pairs where crew_id='${crew}'`);
const correctCall = (crew: string, p: Person) => `correct_social_crew_attendance_admin('${STAFF_ROLE}','${crew}','${memberId(crew, p)}','absent',1,'Attendance was incorrect')`;
const removeCall = (host: Person, crew: string, p: Person) => `remove_social_crew_member_atomic('${host.account}','${crew}','${memberId(crew, p)}','${key()}','${DIGEST}')`;
async function serial(first: string, second: string, label: string, firstRole: "service_role" | "postgres" = "service_role") {
  const held = await hold(first, firstRole);
  const pending = outcome(label, second, "postgres");
  try { await expect.poll(() => waitsOnAnyLock(label)).toBe("t"); }
  finally { await held.finish(); }
  const result = await pending;
  expect(result.ok, result.said).toBe(true);
  return result.said;
}

describe("0250 private event-bound friendship reconnection", () => {
  it("keeps a single choice private and reveals a same-context mutual only on each participant's read", () => {
    const { host, a, b, crew } = night();
    expect(choose(a, crew, b)).toEqual(neutral);
    expect(item(b, crew, a)).toMatchObject({ choice: "none", mutual: false });
    expect(read(host, crew)).toBeNull();
    expect(read(adult(), crew)).toBeNull();
    expect(choose(b, crew, a)).toEqual(neutral);
    expect(item(a, crew, b)).toMatchObject({ choice: "chosen", mutual: true });
    expect(item(b, crew, a)).toMatchObject({ choice: "chosen", mutual: true });
    expect(choose(a, crew, b)).toEqual(neutral);
    expect(rows(crew)).toBe("1");
    expect(db().sql(`select count(*) from public.social_crew_see_again_choices where crew_id='${crew}'`)).toBe("2");
    expect(db().sql(`select count(*) from public.follows where follower_id in ('${a.profile}','${b.profile}')`)).toBe("0");
  });

  it("requires explicit consent, refuses dating and keeps context mismatches neutral", () => {
    const { a, b, crew } = night();
    expect(choose(a, crew, b, "friendship", "choose", false)).toEqual(neutral);
    expect(choose(a, crew, b, "dating")).toEqual(neutral);
    expect(rows(crew)).toBe("0");
    choose(a, crew, b);
    choose(b, crew, a, "dating");
    expect(item(a, crew, b)?.mutual).toBe(false);
    expect(item(b, crew, a)?.choice).toBe("none");
  });

  it("never combines choices from different occurrences", () => {
    const a = adult(), b = adult(), first = night([a, b]), second = night([a, b]);
    choose(a, first.crew, b); choose(b, second.crew, a);
    expect(item(a, first.crew, b)?.mutual).toBe(false);
    expect(item(b, second.crew, a)?.mutual).toBe(false);
  });

  it("sorts the eligible roster alphabetically without exposing incoming choices", () => {
    const people = [adult(), adult(), adult(), adult()];
    const { crew } = night(people);
    for (const [index, handle] of ["viewer", "zulu", "ada", "bea"].entries()) {
      db().sql(`update public.profiles set handle='${handle}' where id='${people[index]!.profile}'`);
    }
    choose(people[1]!, crew, people[0]!);
    expect(read(people[0]!, crew)?.items.map(row => [row.handle,row.choice,row.mutual])).toEqual([
      ["ada","none",false],["bea","none",false],["zulu","none",false],
    ]);
  });

  it("uses the database attendance close and the 72-hour window, with no price or purchase", () => {
    const { a, b, crew } = night();
    starts(crew, "-11 hours");
    expect(read(a, crew)).toBeNull();
    choose(a, crew, b);
    expect(rows(crew)).toBe("0");
    starts(crew, "-12 hours");
    expect(read(a, crew)?.open).toBe(true);
    const start = Date.parse(db().sql(`select start_time::text from public.plans where id=(select plan_id from public.social_crews where id='${crew}')`));
    expect(Date.parse(read(a, crew)!.closesAt)).toBe(seeAgainWindow(start).closesAt);
    const delta = Number(db().sql(`select extract(epoch from (closes_at-(select start_time from public.plans where id=(select plan_id from public.social_crews where id='${crew}'))))*1000 from public._social_crew_attendance_window('${crew}')`));
    expect(delta).toBe(OPEN_CRAWL_ARRIVAL_CLOSE_MS);
    choose(a, crew, b);
    starts(crew, "-84 hours");
    expect(read(a, crew)).toBeNull();
    expect(choose(b, crew, a)).toEqual(neutral);
  });

  it("checks both adults in SQL, and stored minor DOB beats an assertion", () => {
    const { a, b, crew } = night();
    db().sql(`delete from public.adult_self_assertions where user_id='${b.user}'`);
    expect(read(b, crew)).toBeNull();
    expect(read(a, crew)?.items).toEqual([]);
    choose(a, crew, b);
    expect(rows(crew)).toBe("0");
    db().sql(`insert into public.adult_self_assertions(user_id) values ('${b.user}');
      insert into public.private_account_identities(user_id,full_name,date_of_birth) values ('${b.user}','Private name',current_date-interval '16 years')`);
    expect(read(b, crew)).toBeNull();
    expect(read(a, crew)?.items).toEqual([]);
    choose(b, crew, a);
    expect(rows(crew)).toBe("0");
    db().sql(`update public.private_account_identities set date_of_birth=current_date-interval '25 years' where user_id='${b.user}'`);
    choose(a, crew, b);
    expect(item(a, crew, b)?.choice).toBe("chosen");
  });

  it("fails closed on non-finite adult evidence, as accountIsAdult does", () => {
    const { a, b, crew } = night();
    db().sql(`update public.adult_self_assertions set asserted_at='infinity' where user_id='${b.user}'`);
    expect(read(b, crew)).toBeNull();
    expect(read(a, crew)?.items).toEqual([]);
    db().sql(`insert into public.private_account_identities(user_id,date_of_birth) values ('${b.user}','-infinity')`);
    expect(read(b, crew)).toBeNull();
  });

  it("rechecks current adult evidence after waiting for the participant locks", async () => {
    const { a, b, crew } = night();
    const readStatement = rpc(readCall(a, crew));
    const held = await hold(`select public._lock_social_participant_accounts(array['${b.account}'::uuid])`, "postgres");
    const pending = outcome("w6-age-after-wait", readStatement, "postgres");
    try {
      await expect.poll(() => waitsOnAnyLock("w6-age-after-wait")).toBe("t");
      db().sql(`insert into public.private_account_identities(user_id,full_name,date_of_birth)
        values ('${b.user}','Private name',current_date-interval '16 years')`);
    } finally { await held.finish(); }
    const result = await pending;
    expect(result.ok, result.said).toBe(true);
    expect((JSON.parse(result.said) as View).items).toEqual([]);
    choose(a, crew, b);
    expect(rows(crew)).toBe("0");
  });

  it("withdrawal before the second pick is terminal and exposes no hint to the other participant", () => {
    const { a, b, crew } = night();
    choose(a, crew, b);
    choose(a, crew, b, "friendship", "withdraw");
    choose(b, crew, a);
    choose(a, crew, b);
    expect(item(a, crew, b)).toMatchObject({ choice: "withdrawn", mutual: false });
    expect(item(b, crew, a)).toMatchObject({ choice: "chosen", mutual: false });
    choose(b, crew, a, "friendship", "withdraw");
    expect(item(b, crew, a)).toMatchObject({ choice: "withdrawn", mutual: false });
  });

  it("withdrawal after formation hides the outcome for both and keeps its original expiry", () => {
    const { a, b, crew } = matched();
    const before = db().sql(`select expires_at from public.social_crew_see_again_pairs where crew_id='${crew}'`);
    choose(a, crew, b, "friendship", "withdraw");
    expect(item(a, crew, b)?.mutual).toBe(false);
    expect(item(b, crew, a)?.mutual).toBe(false);
    expect(db().sql(`select expires_at from public.social_crew_see_again_pairs where crew_id='${crew}'`)).toBe(before);
    choose(a, crew, b);
    expect(item(a, crew, b)?.mutual).toBe(false);
  });

  it("serialises simultaneous opposing picks", async () => {
    const { a, b, crew } = night();
    await serial(rpc(chooseCall(a, crew, b)), rpc(chooseCall(b, crew, a)), "w6-opposing");
    expect(item(a, crew, b)?.mutual).toBe(true);
    expect(rows(crew)).toBe("1");
  });

  it.each(["withdraw-first", "pick-first"])("serialises withdrawal against second pick: %s", async order => {
    const { a, b, crew } = night();
    choose(a, crew, b);
    const withdraw = rpc(chooseCall(a, crew, b, "friendship", "withdraw"));
    const pick = rpc(chooseCall(b, crew, a));
    await serial(order === "withdraw-first" ? withdraw : pick, order === "withdraw-first" ? pick : withdraw, `w6-${order}`);
    expect(item(a, crew, b)?.mutual).toBe(false);
    expect(item(b, crew, a)?.mutual).toBe(false);
  });

  it.each(["block", "suspension", "correction", "removal", "account-delete", "crew-delete"])("denies reveal after %s commits first", async kind => {
    const { host, a, b, crew } = matched();
    const invalidation = kind === "block" ? rpc(blockCall(a, b)) : kind === "suspension" ? rpc(suspendCall(b))
      : kind === "correction" ? rpc(correctCall(crew, b)) : kind === "removal" ? rpc(removeCall(host, crew, b))
      : kind === "account-delete" ? deleteAccount(b) : `delete from public.social_crews where id='${crew}'`;
    const said = await serial(invalidation, rpc(readCall(a, crew)), `w6-${kind}`, kind.endsWith("delete") ? "postgres" : "service_role");
    const view = JSON.parse(said || "null") as View | null;
    expect(view?.items.some(x => x.mutual) ?? false).toBe(false);
    if (kind === "block") {
      call(`set_social_block('${a.profile}','${b.profile}',false)`);
      choose(a, crew, b); choose(b, crew, a);
      expect(item(a, crew, b)?.mutual).toBe(false);
    }
    if (kind === "account-delete" || kind === "crew-delete") expect(rows(crew)).toBe("0");
  });

  it.each(["block", "suspension", "correction", "removal", "account-delete", "crew-delete"])("allows a read that wins before %s, then removes access", async kind => {
    const { host, a, b, crew } = matched();
    const invalidation = kind === "block" ? rpc(blockCall(a, b)) : kind === "suspension" ? rpc(suspendCall(b))
      : kind === "correction" ? rpc(correctCall(crew, b)) : kind === "removal" ? rpc(removeCall(host, crew, b))
      : kind === "account-delete" ? deleteAccount(b) : `delete from public.social_crews where id='${crew}'`;
    await serial(rpc(readCall(a, crew)), invalidation, `w6-read-first-${kind}`);
    expect(read(a, crew)?.items.some(x => x.mutual) ?? false).toBe(false);
  });

  it("invalidates pairs across different crews without acquiring a second lower account lock", async () => {
    const a = adult(), b = adult();
    const first = night([a, b]), second = night([a, b]);
    for (const n of [first, second]) { choose(a, n.crew, b); choose(b, n.crew, a); }
    await serial(rpc(suspendCall(b)), rpc(readCall(a, second.crew)), "w6-cross-crew");
    for (const n of [first, second]) expect(read(a, n.crew)?.items.some(x => x.mutual) ?? false).toBe(false);
  });

  it("exports only the owner's directional record, without the other choice or private outcome", () => {
    const { a, b, crew } = matched();
    const records = call(`export_social_crew_see_again('${a.user}',100)`);
    expect(records).toEqual([expect.objectContaining({ crewId: crew, context: "friendship", choice: "chosen" })]);
    expect(JSON.stringify(records)).not.toContain(b.user);
    expect(JSON.stringify(records)).not.toContain('"mutual"');
    expect(JSON.stringify(records)).not.toContain('"date_of_birth"');
  });

  it("expires unmatched and matched records immediately and deletes them in bounded batches", async () => {
    const n = matched();
    const remaining = Number(db().sql(`select extract(epoch from expires_at-formed_at) from public.social_crew_see_again_pairs where crew_id='${n.crew}'`));
    expect(remaining).toBe(30 * 86400);
    db().sql(`update public.social_crew_see_again_pairs set expires_at=clock_timestamp()-interval '1 second' where crew_id='${n.crew}'`);
    expect(read(n.a, n.crew)?.items.some(x => x.mutual) ?? false).toBe(false);
    expect(choose(n.a, n.crew, n.b)).toEqual(neutral);
    expect(call("purge_expired_social_crew_see_again(1000)")).toMatchObject({ ok: true, deleted: 3 });
    expect(rows(n.crew)).toBe("0");
    const u = night(); choose(u.a, u.crew, u.b);
    db().sql(`update public.social_crew_see_again_pairs set expires_at=clock_timestamp()-interval '1 second' where crew_id='${u.crew}'`);
    await serial(rpc("purge_expired_social_crew_see_again(1000)"), rpc(chooseCall(u.b, u.crew, u.a)), "w6-expiry");
    // The original window is still open in this fixture, but an expired pair is not recreated.
    expect(item(u.a, u.crew, u.b)?.mutual).toBe(false);
  });

  it("denies table and RPC access to browser roles and provides no moderator choice reader", () => {
    for (const role of ["anon", "authenticated"]) {
      for (const table of ["social_crew_see_again_pairs", "social_crew_see_again_choices"]) {
        expect(db().sql(`select has_table_privilege('${role}','public.${table}','select')`)).toBe("f");
      }
      expect(db().sql(`select has_function_privilege('${role}','public.read_social_crew_see_again(uuid,uuid,uuid)','execute')`)).toBe("f");
    }
  });

  it("keeps the SQL state machine equal to the policy leaf, including every terminal refusal", () => {
    for (const state of ["open", "mutual", "withdrawn", "dismissed", "invalidated"] as SeeAgainPairState[]) {
      for (const event of ["form", "withdraw", "invalidate"] as SeeAgainPairEvent[]) {
        expect(db().sql(`select public._see_again_next('${state}','${event}')`)).toBe(nextSeeAgainPair(state, event));
      }
    }
    expect(SEE_AGAIN_MUTUAL_MS).toBe(30 * 86400_000);
  });

  it.each(["block", "suspension", "correction", "removal", "account-delete", "crew-delete"])("serialises second pick against %s in both transaction orders", async kind => {
    for (const order of ["pick-first", "invalidation-first"]) {
      const { host, a, b, crew } = night();
      choose(a, crew, b);
      const pick = rpc(chooseCall(b, crew, a));
      const invalidation = kind === "block" ? rpc(blockCall(a, b)) : kind === "suspension" ? rpc(suspendCall(b))
        : kind === "correction" ? rpc(correctCall(crew, b)) : kind === "removal" ? rpc(removeCall(host, crew, b))
        : kind === "account-delete" ? deleteAccount(b) : `delete from public.social_crews where id='${crew}'`;
      await serial(order === "pick-first" ? pick : invalidation, order === "pick-first" ? invalidation : pick,
        `w6-pick-${kind}-${order}`, order === "invalidation-first" && kind.endsWith("delete") ? "postgres" : "service_role");
      expect(read(a, crew)?.items.some(x => x.mutual) ?? false).toBe(false);
    }
  });

  it("bounds a batch including cascade-deleted directions and leaves unexpired choices intact", () => {
    const { a, b, crew } = matched();
    db().sql(`insert into public.social_crew_see_again_pairs(crew_id,context,low_account_id,high_account_id,low_user_id,high_user_id,
      low_attendance_revision,high_attendance_revision,state,expires_at)
      select '${crew}','friendship','${a.account}',('ff250000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${a.user}','${b.user}',1,1,'open',now()-interval '1 second'
      from generate_series(1,335) n;
      insert into public.social_crew_see_again_choices(pair_id,crew_id,context,picker_account_id,picked_account_id,picked_member_id,picker_user_id,choice)
      select p.id,p.crew_id,p.context,p.low_account_id,p.high_account_id,'${memberId(crew, b)}','${a.user}','chosen'
      from public.social_crew_see_again_pairs p where p.crew_id='${crew}' and p.state='open';
      insert into public.social_crew_see_again_choices(pair_id,crew_id,context,picker_account_id,picked_account_id,picked_member_id,picker_user_id,choice)
      select p.id,p.crew_id,p.context,p.high_account_id,p.low_account_id,'${memberId(crew, a)}','${b.user}','chosen'
      from public.social_crew_see_again_pairs p where p.crew_id='${crew}' and p.state='open'`);
    expect(call("purge_expired_social_crew_see_again(100000)")).toEqual({ ok: true, deleted: 999 });
    expect(call("purge_expired_social_crew_see_again(100000)")).toEqual({ ok: true, deleted: 6 });
    expect(item(a, crew, b)?.mutual).toBe(true);
  });

  it("rolls back under the migration role and reapplies", () => {
    const retained = db().sql("select count(*) from public.social_crew_see_again_pairs");
    expect(Number(retained)).toBeGreaterThan(0);
    expect(() => apply(`rollback/${migration.replace('.sql', '_rollback.sql')}`)).toThrow();
    expect(db().sql("select count(*) from public.social_crew_see_again_pairs")).toBe(retained);
    db().sql("delete from public.social_crew_see_again_pairs");
    apply(`rollback/${migration.replace('.sql', '_rollback.sql')}`);
    expect(db().sql("select to_regclass('public.social_crew_see_again_pairs') is null")).toBe("t");
    apply(migration);
    expect(read(adult(), "a2509999-0000-4000-8000-000000000001")).toBeNull();
  });
});
