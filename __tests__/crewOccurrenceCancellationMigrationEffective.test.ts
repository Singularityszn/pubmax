import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { postgresPoll } from "./helpers/postgresPoll";
import { asServiceRole } from "./helpers/postgres";
import {
  type Person, DIGEST, NO_CREW, NOT_FOUND, STAFF_ROLE, block, blockCall,
  bootCrewAdmissionDatabase, call, crewWith, db, decideCall, deleteAccount,
  hold, holdRpc, invite, json, key, leave, memberId, mutual, startedOutcome as outcome, person,
  remove, request, rpc, state, stopCrewAdmissionDatabase, waitsOnAnyLock,
} from "./helpers/crewAdmissionHarness";

const directory = join(process.cwd(), "supabase/migrations");
const migration = "20261118100000_0249_crew_occurrence_cancellation.sql";
const signature = "public.cancel_social_crew_occurrence_admin(uuid,uuid,bigint,text,text)";
const staffFor = (who: Person, role = "moderator") => db().sql(`insert into public.private_social_staff_roles
  (profile_id,display_name,role) values('${who.profile}','Independent moderator','${role}') returning id`);
const ledger = (crew: string) => db().sql(`select coalesce((select to_jsonb(saved)::text
  from public.social_crew_occurrence_cancellations saved where crew_id='${crew}'),'none')`);
const count = (table: string, crew: string) => db().sql(`select count(*) from public.${table} where crew_id='${crew}'`);
const REFUSED_BY_LOCKS = /deadlock|lock timeout|statement timeout|foreign key/i;
function successful(result: { ok: boolean; said: string }) {
  expect(result.ok, result.said).toBe(true);
  expect(result.said).not.toMatch(REFUSED_BY_LOCKS);
  return result.said ? json(result.said) : null;
}
const deletion = (crew: string) => `select id from public.social_crews where id='${crew}' for update;
  select id from public.plans where id='${planOf(crew)}' for update;
  delete from public.plans where id='${planOf(crew)}'`;
function seedPositions(crew: string) {
  const plan = planOf(crew);
  db().sql(`insert into public.plan_live_locations(plan_id,member_id,latitude,longitude,updated_at,expires_at)
    select '${plan}',plan_member_id,51.5,-0.1,now(),now()+interval '1 hour'
    from public.social_crew_members where crew_id='${crew}' and state='active';
    insert into public.plan_live_location_stops(plan_id,member_id,stopped_at,expires_at)
    select '${plan}',plan_member_id,now(),now()+interval '1 hour'
    from public.social_crew_members where crew_id='${crew}' and state='active';`);
}
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
    expect(db().sql(asServiceRole(`select public.update_legacy_plan_status_context_atomic(
      '${plan}','${token}','abandoned',null)`))).toBe("not_found");
    expect(status(crew)).toBe("ready");
  });

  it("lets an independent moderator cancel one reviewed occurrence", () => {
    const host = person(), guest = person();
    const crew = crewWith(host, [guest]);
    expect(call(cancelCall(crew))).toMatchObject({ ok: true, code: "cancelled" });
    expect(status(crew)).toBe("abandoned");
  });

  it.each(["draft", "ready", "active", "ending"])("cancels the permitted %s from-state once", (from) => {
    const crew = crewWith(person());
    db().sql(`update public.plans set status='${from}' where id='${planOf(crew)}'`);
    const seen = revision(crew), statement = cancelCall(crew);
    expect(call(statement)).toEqual({ ok: true, code: "cancelled" });
    const saved = ledger(crew);
    expect(JSON.parse(saved)).toMatchObject({ prior_status: from, prior_authority_revision: seen,
      reason, staff_role_id: STAFF_ROLE, staff_display_name: "Moderator" });
    expect(call(statement)).toEqual({ ok: true, code: "unchanged" });
    expect(ledger(crew)).toBe(saved);
    expect(revision(crew)).toBe(seen + 1);
    expect(call(cancelCall(crew, seen, from, STAFF_ROLE, "Another independent reason")))
      .toEqual({ ok: false, code: "stale" });
    expect(call(cancelCall(crew, seen + 1, from))).toEqual({ ok: false, code: "stale" });
  });

  it("refuses missing, invalid, stale and ended occurrences without a write", () => {
    const crew = crewWith(person());
    const seen = revision(crew);
    expect(call(cancelCall(NO_CREW, seen, "ready"))).toEqual(NOT_FOUND);
    expect(call(cancelCall(planOf(crew), seen, "ready"))).toEqual(NOT_FOUND);
    for (const why of ["", "  ", "x", "x".repeat(501)]) {
      expect(call(cancelCall(crew, seen, "ready", STAFF_ROLE, why))).toEqual({ ok: false, code: "invalid" });
    }
    for (const [rev, from] of [[seen + 1, "ready"], [seen, "active"]] as const) {
      expect(call(cancelCall(crew, rev, from))).toEqual({ ok: false, code: "stale" });
    }
    for (const [rev, from] of [[0, "ready"], [seen, "completed"], [seen, "paused"]] as const) {
      expect(call(cancelCall(crew, rev, from))).toEqual({ ok: false, code: "invalid" });
    }
    expect(call(`cancel_social_crew_occurrence_admin('${STAFF_ROLE}','${crew}',null,'ready','${reason}')`))
      .toEqual({ ok: false, code: "invalid" });
    for (const from of ["completed", "abandoned"]) {
      db().sql(`update public.plans set status='${from}' where id='${planOf(crew)}'`);
      expect(call(cancelCall(crew, seen, "ready"))).toEqual({ ok: false, code: "closed" });
    }
    db().sql(`update public.plans set status='ready',start_time=now()-interval '12 hours' where id='${planOf(crew)}'`);
    expect(call(cancelCall(crew))).toEqual({ ok: false, code: "closed" });
    expect(ledger(crew)).toBe("none");
    expect(revision(crew)).toBe(seen);
  });

  it("requires an active moderator before recording a cancellation", () => {
    const crew = crewWith(person());
    for (const staff of [NO_CREW, staffFor(person(), "product_staff")]) {
      expect(() => call(cancelCall(crew, revision(crew), "ready", staff))).toThrow(/staff required/);
    }
    const revoked = staffFor(person());
    db().sql(`update public.private_social_staff_roles set revoked_at=now() where id='${revoked}'`);
    expect(() => call(cancelCall(crew, revision(crew), "ready", revoked))).toThrow(/staff required/);
    expect(call(cancelCall(crew))).toMatchObject({ code: "cancelled" });
    expect(JSON.parse(ledger(crew))).toMatchObject({ staff_role_id: STAFF_ROLE, reason });
  });

  it.each(["owner", "cohost", "member", "left", "removed", "requested", "invited"])(
    "refuses a moderator who is an occurrence insider: %s", (kind) => {
      const host = person(), insider = person();
      const crew = crewWith(host, [insider]);
      if (kind === "cohost") db().sql(`update public.social_crew_members set role='cohost'
        where crew_id='${crew}' and social_account_id='${insider.account}'`);
      if (kind === "left") expect(leave(crew, insider)).toMatchObject({ code: "left" });
      if (kind === "removed") expect(remove(host, crew, insider)).toMatchObject({ code: "removed" });
      let actor = kind === "owner" ? host : insider;
      if (kind === "requested" || kind === "invited") {
        actor = person();
        if (kind === "requested") request(actor, crew);
        else { mutual(host, actor); invite(host, crew, actor); }
      }
      expect(call(cancelCall(crew, revision(crew), "ready", staffFor(actor)))).toEqual(NOT_FOUND);
      expect(status(crew)).toBe("ready");
      expect(ledger(crew)).toBe("none");
    },
  );

  it.each([false, true])("refuses a moderator blocked with a participant in either direction: %s", (reverse) => {
    const host = person(), guest = person(), staff = person();
    const crew = crewWith(host, [guest]);
    block(...(reverse ? [guest, staff] : [staff, guest]) as [Person, Person]);
    expect(call(cancelCall(crew, revision(crew), "ready", staffFor(staff)))).toEqual(NOT_FOUND);
    expect(status(crew)).toBe("ready");
    expect(ledger(crew)).toBe("none");
  });

  it("a participant block alone keeps the night, places and reporting available", () => {
    const host = person(), ana = person(), bea = person();
    const crew = crewWith(host, [ana, bea]);
    const seen = revision(crew);
    block(ana, bea);
    expect(status(crew)).toBe("ready");
    expect(revision(crew)).toBe(seen);
    expect([state(crew, ana), state(crew, bea)]).toEqual(["active", "active"]);
    expect(ledger(crew)).toBe("none");
    expect(call(cancelCall(crew))).toEqual({ ok: true, code: "cancelled" });
    expect(db().sql(`set role service_role; select content_kind from public.report_social_content(
      '${ana.profile}','profile','${host.profile}','harassment')`)).toBe("profile");
    expect(db().sql(`set role service_role; select content_kind from public.report_social_content(
      '${ana.profile}','profile','${bea.profile}','harassment')`)).toBe("profile");
  });

  it("expires pending admissions, clears live data, preserves history and changes only the selected night", () => {
    const host = person(), guest = person(), applicant = person(), invited = person(), removed = person();
    const crew = crewWith(host, [guest, removed]), other = crewWith(host);
    expect(remove(host, crew, removed)).toMatchObject({ code: "removed" });
    request(applicant, crew);
    mutual(host, invited); invite(host, crew, invited);
    seedPositions(crew);
    const seen = revision(crew), plan = planOf(crew);
    expect(call(cancelCall(crew))).toEqual({ ok: true, code: "cancelled" });
    expect(status(crew)).toBe("abandoned");
    expect(status(other)).toBe("ready");
    expect(revision(crew)).toBe(seen + 1);
    expect([state(crew, host), state(crew, guest), state(crew, removed)]).toEqual(["active", "active", "removed"]);
    expect(count("social_crew_members", crew)).toBe("3");
    expect(db().sql(`select state from public.social_crew_join_requests where crew_id='${crew}'
      and requester_account_id='${applicant.account}'`)).toBe("expired");
    expect(db().sql(`select state from public.social_crew_invitations where crew_id='${crew}'`)).toBe("expired");
    for (const table of ["plan_live_locations", "plan_live_location_stops"]) {
      expect(db().sql(`select count(*) from public.${table} where plan_id='${plan}'`)).toBe("0");
    }
    expect(request(person(), crew)).toEqual(NOT_FOUND);
  });

  it("simultaneous identical cancellations commit one audit and one revision", async () => {
    const crew = crewWith(person()), seen = revision(crew), statement = cancelCall(crew);
    const results = await db().concurrentResults([
      asServiceRole(rpc(statement)), asServiceRole(rpc(statement)),
    ]);
    expect(results.map(json)).toEqual(expect.arrayContaining([
      { ok: true, code: "cancelled" }, { ok: true, code: "unchanged" },
    ]));
    expect(revision(crew)).toBe(seen + 1);
    expect(count("social_crew_occurrence_cancellations", crew)).toBe("1");
  });

  it.each([false, true])("cancellation and acceptance serialise under the Crew row, cancellation first: %s", async (cancelFirst) => {
    const host = person(), applicant = person(), crew = crewWith(host);
    const asked = request(applicant, crew), statement = cancelCall(crew);
    const approval = decideCall(host, crew, asked.request_id as string);
    const first = await holdRpc(cancelFirst ? statement : approval);
    const next = outcome("cancel_acceptance", rpc(cancelFirst ? approval : statement));
    try { await next.started; await postgresPoll(() => waitsOnAnyLock("cancel_acceptance")).toBe("t"); }
    finally { await first.finish(); }
    const answer = successful(await next);
    if (cancelFirst) {
      expect(answer).toMatchObject({ ok: false });
      expect(state(crew, applicant)).toBe("none");
    } else {
      expect(answer).toEqual({ ok: false, code: "stale" });
      expect(state(crew, applicant)).toBe("active");
      expect(call(cancelCall(crew))).toEqual({ ok: true, code: "cancelled" });
    }
    expect(status(crew)).toBe("abandoned");
  });

  it.each([false, true])("cancellation and account deletion complete with shared live positions, cancellation first: %s", async (cancelFirst) => {
    for (const subject of ["host", "guest", "creator"] as const) {
      const host = person(), guest = person(), creator = person();
      if (subject === "creator") mutual(creator, host);
      const crew = crewWith(subject === "creator" ? creator : host, [guest, ...(subject === "creator" ? [host] : [])]);
      if (subject === "creator") {
        expect(call(`transfer_social_crew_owner_atomic('${creator.account}','${crew}','${memberId(crew, host)}',
          '${key()}','${DIGEST}')`)).toMatchObject({ code: "transferred" });
      }
      seedPositions(crew);
      const who = subject === "host" ? host : subject === "guest" ? guest : creator;
      const statement = cancelCall(crew);
      const first = await hold(cancelFirst ? rpc(statement) : deleteAccount(who), cancelFirst ? "service_role" : "postgres");
      const name = `cancel_delete_${subject}`;
      const next = outcome(name, cancelFirst ? deleteAccount(who) : rpc(statement), cancelFirst ? "postgres" : "service_role");
      try { await next.started; await postgresPoll(() => waitsOnAnyLock(name)).toBe("t"); }
      finally { await first.finish(); }
      successful(await next);
      expect(status(crew)).toBe("abandoned");
      expect(db().sql(`select count(*) from auth.users where id='${who.user}'`)).toBe("0");
      expect(db().sql(`select count(*) from public.plan_live_locations where plan_id='${planOf(crew)}'`)).toBe("0");
      expect(count("social_crew_occurrence_cancellations", crew)).toBe("1");
    }
  });

  it.each([false, true])("cancellation and the documented Plan deletion order complete, cancellation first: %s", async (cancelFirst) => {
    const crew = crewWith(person(), [person()]), statement = cancelCall(crew), removing = deletion(crew);
    const first = await hold(cancelFirst ? rpc(statement) : removing, cancelFirst ? "service_role" : "postgres");
    const next = outcome("cancel_plan_delete", cancelFirst ? removing : rpc(statement), cancelFirst ? "postgres" : "service_role");
    try { await next.started; await postgresPoll(() => waitsOnAnyLock("cancel_plan_delete")).toBe("t"); }
    finally { await first.finish(); }
    const result = await next;
    if (cancelFirst) { expect(result.ok, result.said).toBe(true); expect(result.said).not.toMatch(REFUSED_BY_LOCKS); }
    else expect(successful(result)).toEqual(NOT_FOUND);
    expect(count("social_crew_occurrence_cancellations", crew)).toBe("0");
    expect(db().sql(`select count(*) from public.social_crews where id='${crew}'`)).toBe("0");
  });

  it.each([false, true])("cancellation and departed-place cleanup complete, cancellation first: %s", async (cancelFirst) => {
    const host = person(), guest = person(), crew = crewWith(host, [guest]);
    db().sql(deleteAccount(guest));
    const statement = cancelCall(crew);
    const releasing = `_release_departed_crew_places('${crew}')`;
    const first = await hold(cancelFirst ? rpc(statement) : `select public.${releasing}`, cancelFirst ? "service_role" : "postgres");
    const next = outcome("cancel_departure", cancelFirst ? `select public.${releasing}` : rpc(statement), cancelFirst ? "postgres" : "service_role");
    try { await next.started; await postgresPoll(() => waitsOnAnyLock("cancel_departure")).toBe("t"); }
    finally { await first.finish(); }
    const result = await next;
    expect(result.ok, result.said).toBe(true);
    expect(result.said).not.toMatch(REFUSED_BY_LOCKS);
    if (!cancelFirst) {
      expect(json(result.said)).toEqual({ ok: false, code: "stale" });
      expect(call(cancelCall(crew))).toEqual({ ok: true, code: "cancelled" });
    }
    expect(status(crew)).toBe("abandoned");
    expect(state(crew, guest)).toBe("left");
  });

  it.each([false, true])("staff revocation serialises with cancellation, cancellation first: %s", async (cancelFirst) => {
    const crew = crewWith(person()), staff = staffFor(person());
    const statement = cancelCall(crew, revision(crew), "ready", staff);
    const revoke = `update public.private_social_staff_roles set active=false where id='${staff}'`;
    const first = await hold(cancelFirst ? rpc(statement) : revoke, cancelFirst ? "service_role" : "postgres");
    const next = outcome("cancel_staff_revoke", cancelFirst ? revoke : rpc(statement), cancelFirst ? "postgres" : "service_role");
    try { await next.started; await postgresPoll(() => waitsOnAnyLock("cancel_staff_revoke")).toBe("t"); }
    finally { await first.finish(); }
    const result = await next;
    if (cancelFirst) expect(result.ok, result.said).toBe(true);
    else { expect(result.ok).toBe(false); expect(result.said).toMatch(/staff required/); }
    expect(status(crew)).toBe(cancelFirst ? "abandoned" : "ready");
    expect(() => call(statement)).toThrow(/staff required/);
  });

  it("a moderator deletion that commits during the auth wait prevents cancellation", async () => {
    const staff = person(), role = staffFor(staff), crew = crewWith(person());
    const statement = cancelCall(crew, revision(crew), "ready", role);
    const first = await hold(deleteAccount(staff), "postgres");
    const next = outcome("cancel_staff_delete", rpc(statement));
    try { await next.started; await postgresPoll(() => waitsOnAnyLock("cancel_staff_delete")).toBe("t"); }
    finally { await first.finish(); }
    const result = await next;
    expect(result.ok).toBe(false);
    expect(result.said).toMatch(/staff required/);
    expect(status(crew)).toBe("ready");
    expect(ledger(crew)).toBe("none");
  });

  it.each([false, true])("a moderator block and cancellation share account locks, cancellation first: %s", async (cancelFirst) => {
    const staff = person(), role = staffFor(staff), host = person(), guest = person(), crew = crewWith(host, [guest]);
    const statement = cancelCall(crew, revision(crew), "ready", role);
    const blocking = blockCall(staff, guest);
    const first = await holdRpc(cancelFirst ? statement : blocking);
    const next = outcome("cancel_staff_block", rpc(cancelFirst ? blocking : statement));
    try { await next.started; await postgresPoll(() => waitsOnAnyLock("cancel_staff_block")).toBe("t"); }
    finally { await first.finish(); }
    const result = await next;
    expect(result.ok, result.said).toBe(true);
    expect(result.said).not.toMatch(REFUSED_BY_LOCKS);
    if (!cancelFirst) expect(json(result.said)).toEqual(NOT_FOUND);
    expect(status(crew)).toBe(cancelFirst ? "abandoned" : "ready");
    expect(call(statement)).toEqual(NOT_FOUND);
  });

  it.each([false, true])("live-position sharing and cancellation finish without retained positions, cancellation first: %s", async (cancelFirst) => {
    const host = person(), guest = person(), crew = crewWith(host, [guest]);
    const plan = planOf(crew);
    db().sql(`update public.plans set start_time=now()+interval '3 hours' where id='${plan}'`);
    const sharing = `plan_live_location('${plan}',null,'${guest.account}','share',51.5,-0.1)`;
    const cancellation = cancelCall(crew);
    const first = await holdRpc(cancelFirst ? cancellation : sharing);
    expect(first.result).toMatchObject(cancelFirst ? { code: "cancelled" } : { ok: true, view: { sharing: true } });
    const next = outcome("cancel_position_share", rpc(cancelFirst ? sharing : cancellation));
    try { await next.started; await postgresPoll(() => waitsOnAnyLock("cancel_position_share")).toBe("t"); }
    finally { await first.finish(); }
    expect(successful(await next)).toMatchObject(cancelFirst ? { ok: false, error: "ended" } : { code: "cancelled" });
    expect(db().sql(`select count(*) from public.plan_live_locations where plan_id='${plan}'`)).toBe("0");
    expect(call(sharing)).toEqual({ ok: false, error: "ended" });
  });

  it.each([false, true])("moderator suspension and cancellation share account locks, cancellation first: %s", async (cancelFirst) => {
    const staff = person(), role = staffFor(staff), crew = crewWith(person());
    const cancellation = cancelCall(crew, revision(crew), "ready", role);
    const suspension = `set_social_account_suspension_admin('${STAFF_ROLE}','${staff.profile}','suspend','Safety review',null)`;
    const first = await holdRpc(cancelFirst ? cancellation : suspension);
    const next = outcome("cancel_staff_suspend", rpc(cancelFirst ? suspension : cancellation));
    try { await next.started; await postgresPoll(() => waitsOnAnyLock("cancel_staff_suspend")).toBe("t"); }
    finally { await first.finish(); }
    const result = await next;
    if (cancelFirst) expect(successful(result)).toMatchObject({ ok: true, code: "suspended" });
    else { expect(result.ok).toBe(false); expect(result.said).toMatch(/staff required/); }
    expect(status(crew)).toBe(cancelFirst ? "abandoned" : "ready");
    expect(() => call(cancellation)).toThrow(/staff required/);
  });

  it("rollback stops new cancellations, preserves the audit and history, and reapply restores safe replay", () => {
    const crew = crewWith(person()), statement = cancelCall(crew);
    expect(call(statement)).toEqual({ ok: true, code: "cancelled" });
    const saved = ledger(crew);
    apply(`rollback/${migration.replace(".sql", "_rollback.sql")}`);
    expect(db().sql(`select to_regprocedure('${signature}') is null`)).toBe("t");
    expect(ledger(crew)).toBe(saved);
    expect(status(crew)).toBe("abandoned");
    apply(migration);
    expect(call(statement)).toEqual({ ok: true, code: "unchanged" });
    expect(ledger(crew)).toBe(saved);
  });

});
