import { join } from "node:path";
import { spawn } from "node:child_process";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { postgresPoll } from "./helpers/postgresPoll";
import { startPostgres, type PostgresSession } from "./helpers/postgres";
import { transitionPaydayConsent, type PaydayConsentState } from "@/lib/paydayPintConsent";
import { paydayConsentCases } from "./helpers/paydayConsentCases";

let db: PostgresSession;
const base = join(process.cwd(), "supabase/migrations");
const migration = join(base, "20261120001000_0252_payday_pint.sql");
const rollback = join(base, "rollback/20261120001000_0252_payday_pint_rollback.sql");
beforeAll(async () => {
  db = await startPostgres({ label: "payday-pint" });
  db.sql("create role anon; create role authenticated; create role service_role bypassrls;");
  expect(db.sql("select to_regclass('public.payday_pint_subscribers') is null")).toBe("t");
  db.applyFile(migration);
});
afterAll(async () => { await db?.stop(); });
beforeEach(() => { db.sql("truncate public.payday_pint_pending, public.payday_pint_subscribers"); });

it("requires confirmation and rejects an older confirmation after withdrawal", async () => {
  db.sql("insert into public.payday_pint_pending values ('first', 'person@example.test', 'Bank', 'weekly', '2026-11-01', '2026-11-03', 'token-a')");
  expect(db.sql("select count(*) from public.payday_pint_subscribers")).toBe("0");
  expect(db.sql("set role service_role; select public.confirm_payday_pint('first', '2026-11-02')")).toBe("t");
  db.sql("insert into public.payday_pint_pending values ('older', 'person@example.test', 'Bank', 'weekly', '2026-11-01 12:00', '2026-11-04', 'token-b')");
  db.sql("insert into public.payday_pint_pending values ('newer', 'person@example.test', 'Oxford Circus', 'weekly', '2026-11-02 01:00', '2026-11-04', 'token-c')");
  expect(db.sql("select public.confirm_payday_pint('newer', '2026-11-02 02:00')")).toBe("t");
  expect(db.sql("select unsubscribe_token from public.payday_pint_subscribers")).toBe("token-a");
  expect(db.sql("set role service_role; select public.unsubscribe_payday_pint('token-a', '2026-11-03')")).toBe("t");
  expect(db.sql("select public.confirm_payday_pint('older', '2026-11-03')")).toBe("f");
  expect(db.sql("select count(*) from public.payday_pint_subscribers where unsubscribed_at is null")).toBe("0");
  expect((await db.attempt("set role anon; select * from public.payday_pint_pending")).ok).toBe(false);
  expect((await db.attempt("set role authenticated; select * from public.payday_pint_subscribers")).ok).toBe(false);
  for (const role of ["anon", "authenticated"]) {
    expect((await db.attempt(`set role ${role}; select public.confirm_payday_pint('invalid', now())`)).ok).toBe(false);
    expect((await db.attempt(`set role ${role}; select public.unsubscribe_payday_pint('token-a', now())`)).ok).toBe(false);
  }
});

function readConsent(): PaydayConsentState {
  const result = db.sql("select row_to_json(s) from public.payday_pint_subscribers s");
  if (!result) return { phase: "pending" };
  const row = JSON.parse(result);
  const confirmed = { consentAt: new Date(row.consent_at).toISOString(), confirmedAt: new Date(row.confirmed_at).toISOString() };
  return row.unsubscribed_at
    ? { phase: "withdrawn", ...confirmed, withdrawnAt: new Date(row.unsubscribed_at).toISOString() }
    : { phase: "confirmed", ...confirmed };
}

it.each(paydayConsentCases)("SQL and policy: $name", ({ state, event, expected, accepted }) => {
  if (state.phase !== "pending") {
    const withdrawal = state.phase === "withdrawn" ? `'${state.withdrawnAt}'` : "null";
    db.sql(`insert into public.payday_pint_subscribers
      (email, station, consent_text, consent_at, confirmed_at, unsubscribe_token, unsubscribed_at, last_claimed_week)
      values ('person@example.test', 'Bank', 'weekly', '${state.consentAt}', '${state.confirmedAt}', 'token-a', ${withdrawal}, '2026-10-30')`);
  }
  let result: string;
  if (event.type === "confirm") {
    db.sql(`insert into public.payday_pint_pending values
      ('request', 'person@example.test', 'Oxford Circus', 'weekly', '${event.requestedAt}', '${event.requestedAt}'::timestamptz + interval '48 hours', 'token-b')`);
    result = db.sql(`set role service_role; select public.confirm_payday_pint('request', '${event.now}')`);
  } else {
    result = db.sql(`set role service_role; select public.unsubscribe_payday_pint('token-a', '${event.now}')`);
  }
  expect(result).toBe(accepted ? "t" : "f");
  expect(readConsent()).toEqual(expected);
  expect(readConsent()).toEqual(transitionPaydayConsent(state, event));
  if (state.phase !== "pending") {
    expect(db.sql("select unsubscribe_token || '|' || last_claimed_week from public.payday_pint_subscribers")).toBe("token-a|2026-10-30");
  }
});

async function holdTransition(statement: string) {
  const child = spawn(db.psql, [...db.databaseArgs, "-X", "-qAt"], { stdio: "pipe" });
  let output = "", errors = "";
  child.stderr.on("data", (chunk) => { errors += String(chunk); });
  const exited = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(errors)));
  });
  void exited.catch(() => {});
  const ready = new Promise<void>((resolve) => {
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
      if (output.split(/\r?\n/).includes("LOCK_HELD")) resolve();
    });
  });
  child.stdin.write(`begin; set role service_role; ${statement};\n\\echo LOCK_HELD\n`);
  try {
    await Promise.race([ready, exited.then(() => { throw new Error("Transaction exited before the lock barrier"); })]);
  } catch (error) {
    child.stdin.end("rollback;\n\\q\n");
    await exited.catch(() => {});
    throw error;
  }
  return async (action: "commit" | "rollback") => {
    if (!child.stdin.writableEnded) child.stdin.end(`${action};\n\\q\n`);
    await exited;
  };
}

it.each(["confirm", "withdraw"] as const)("preserves withdrawal when %s holds the row lock first", async (first) => {
  db.sql(`insert into public.payday_pint_pending values ('initial', 'person@example.test', 'Bank', 'weekly', '2026-11-01', '2026-11-03', 'token-a');
    select public.confirm_payday_pint('initial', '2026-11-01 01:00Z');
    select public.unsubscribe_payday_pint('token-a', '2026-11-01 02:00Z');
    insert into public.payday_pint_pending values ('renew', 'person@example.test', 'Oxford Circus', 'weekly', '2026-11-01 03:00Z', '2026-11-03', 'token-b')`);
  const statements = {
    confirm: "select public.confirm_payday_pint('renew', '2026-11-01 05:00Z')",
    withdraw: "select public.unsubscribe_payday_pint('token-a', '2026-11-01 04:00Z')",
  };
  const finish = await holdTransition(statements[first]);
  const second = first === "confirm" ? "withdraw" : "confirm";
  const waiting = db.sqlAsync(`set role service_role; set application_name='payday_wait'; ${statements[second]}`);
  void waiting.catch(() => {});
  try {
    await postgresPoll(() => db.sqlAsync(`select exists(select 1 from pg_stat_activity
      where application_name='payday_wait' and wait_event_type='Lock' and cardinality(pg_blocking_pids(pid)) > 0)`)).toBe("t");
    await finish("commit");
    expect(await waiting).toBe(first === "withdraw" ? "f" : "t");
    expect(readConsent()).toEqual({ phase: "withdrawn", consentAt: first === "confirm" ? "2026-11-01T03:00:00.000Z" : "2026-11-01T00:00:00.000Z", confirmedAt: first === "confirm" ? "2026-11-01T05:00:00.000Z" : "2026-11-01T01:00:00.000Z", withdrawnAt: "2026-11-01T04:00:00.000Z" });
    expect(db.sql("select count(*) from public.payday_pint_subscribers where unsubscribed_at is null")).toBe("0");
    expect(db.sql("select count(*) from public.payday_pint_pending")).toBe("0");
  } finally {
    await finish("rollback");
    await waiting.catch(() => {});
  }
});

it("retries a failed delivery with a bounded claim and rolls back", async () => {
  db.sql("insert into public.payday_pint_subscribers (id,email,station,consent_text,consent_at,confirmed_at,unsubscribe_token) values ('00000000-0000-4000-8000-000000000001','person@example.test','Bank','weekly','2026-11-19','2026-11-19','token')");
  db.sql("update public.payday_pint_subscribers set last_claimed_week='2026-11-20'");
  expect(db.sql("update public.payday_pint_subscribers set last_claimed_week='2026-11-20' where last_claimed_week is distinct from '2026-11-20' returning id")).toBe("");
  const name = "20261125091000_0268_payday_delivery_retry.sql";
  expect(db.sql("select to_regprocedure('public.prepare_payday_pint_delivery(uuid,text,uuid,jsonb)') is null")).toBe("t");
  db.applyFile(join(base, name));
  const id = "00000000-0000-4000-8000-000000000001";
  const claim = (token: string) => `select public.claim_payday_pint_delivery('${id}', '2026-11-27', '${token}', '2026-11-27T09:00:00Z')`;
  const a = "00000000-0000-4000-8000-000000000002";
  const b = "00000000-0000-4000-8000-000000000003";
  const request = JSON.stringify({ from: "sender@example.test", to: "person@example.test", subject: "Original", html: "<p>Original</p>", text: "Original", idempotencyKey: "payday-original" });
  const prepare = (token: string, payload = request, week = "2026-11-27") => `select public.prepare_payday_pint_delivery('${id}','${week}','${token}','${payload}'::jsonb)`;
  expect(db.sql(`set role service_role; ${claim(a)}`)).toBe("t");
  expect(JSON.parse(db.sql(`set role service_role; ${prepare(a)}`))).toEqual(JSON.parse(request));
  expect((await db.attempt(`set role service_role; ${prepare(b)}`)).ok).toBe(false);
  expect(db.sql(`set role service_role; ${claim(b)}`)).toBe("f");
  expect(db.sql(`set role service_role; select public.finish_payday_pint_delivery('${id}','2026-11-27','${b}','retryable')`)).toBe("");
  expect(db.sql(`set role service_role; select public.finish_payday_pint_delivery('${id}','2026-11-27','${a}','retryable')`)).toBe("retryable");
  expect(db.sql(`set role service_role; ${claim(b)}`)).toBe("t");
  expect(JSON.parse(db.sql(`set role service_role; ${prepare(b, JSON.stringify({ ...JSON.parse(request), text: "Changed", from: "changed@example.test" }))}`))).toEqual(JSON.parse(request));
  expect((await db.attempt(`set role anon; ${prepare(b)}`)).ok).toBe(false);
  expect(db.sql(`set role service_role; select public.finish_payday_pint_delivery('${id}','2026-11-27','${b}','delivered')`)).toBe("delivered");
  expect(db.sql(`set role service_role; ${claim(a)}`)).toBe("f");
  expect((await db.attempt(`set role anon; ${claim(a)}`)).ok).toBe(false);
  expect(db.sql(`set role service_role; select public.claim_payday_pint_delivery('${id}','2026-12-04','${a}','2026-12-04T09:00:00Z')`)).toBe("t");
  const nextRequest = JSON.stringify({ ...JSON.parse(request), text: "Next week", idempotencyKey: "payday-next-week" });
  expect(JSON.parse(db.sql(`set role service_role; ${prepare(a, nextRequest, "2026-12-04")}`))).toEqual(JSON.parse(nextRequest));
  db.applyFile(join(base, "rollback", name));
  expect(db.sql("select to_regprocedure('public.claim_payday_pint_delivery(uuid,text,uuid,timestamptz)') is null")).toBe("t");
  expect(db.sql("select to_regprocedure('public.prepare_payday_pint_delivery(uuid,text,uuid,jsonb)') is null")).toBe("t");
  expect(db.sql("select count(*) from information_schema.columns where table_schema='public' and table_name='payday_pint_subscribers' and column_name='delivery_request'")).toBe("0");
});

it("rolls back the consent tables and both lifecycle RPCs", () => {
  db.applyFile(rollback);
  expect(db.sql("select to_regclass('public.payday_pint_subscribers') is null")).toBe("t");
  expect(db.sql("select to_regprocedure('public.confirm_payday_pint(text,timestamptz)') is null and to_regprocedure('public.unsubscribe_payday_pint(text,timestamptz)') is null")).toBe("t");
});
