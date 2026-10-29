// External, unexecuted proposal for __tests__/roundSpendCloseRaceEffective.test.ts.
// The schedule reproduces the exact final-read -> committed close -> insert gap.
// It does not use sleep, a mock database or a source-string oracle.
import { spawn } from "node:child_process";
import { setImmediate } from "node:timers/promises";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asServiceRole, postgresSkipReason, startMigratedPostgres, type PostgresSession } from "./helpers/postgres";
const skipReason = postgresSkipReason();
const ROUND = "e2040000-0000-4000-8000-000000000001";
let session: PostgresSession | null = null;
function db(): PostgresSession {
  if (!session) throw new Error("Round close race proof has no database session");
  return session;
}
beforeAll(async () => {
  if (skipReason) return;
  session = await startMigratedPostgres({ label: "round-close-race", database: "pubmax_round_close_race" });
  db().sql(`insert into public.rounds(id,code,title,created_by_handle)
    values ('${ROUND}','CLOSEPROOF','Friday','ken')`);
}, 600_000);
afterAll(async () => { await session?.stop(); session = null; });
beforeEach(() => {
  if (skipReason) return;
  db().sql(`delete from public.round_spends where round_id='${ROUND}'; update public.rounds set closed_at=null where id='${ROUND}'`);
});

function insertSpend(ref: string): string {
  return `insert into public.round_spends
    (round_id,client_ref,payer_handle,recorded_by_handle,venue_id,venue_name,total_pence,items,receipt_photo_key)
    values ('${ROUND}','${ref}','ken','ken','venue-1','The Ship',620,'[]'::jsonb,'venue-1/${ref}/receipt.jpg')`;
}

// Keep one real transaction open until the other connection demonstrably waits on its row lock.
async function holdTransaction(statement: string) {
  const child = spawn(db().psql, [...db().databaseArgs, "-X", "-qAt"], { stdio: "pipe" });
  let output = "";
  let errors = "";
  child.stderr.on("data", (chunk) => { errors += String(chunk); });
  const exited = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Transaction exited ${code}: ${errors}`)));
  });
  // Attach rejection handling before the readiness wait can fail.
  void exited.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ready = new Promise<void>((resolve, reject) => {
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
      if (output.split(/\r?\n/).includes("LOCK_HELD")) resolve();
    });
    timer = setTimeout(() => reject(new Error(`Transaction readiness timed out: ${errors}`)), 10_000);
  });
  child.stdin.write(asServiceRole(`begin; set local statement_timeout='5s'; ${statement};`) + "\n\\echo LOCK_HELD\n");
  try {
    await Promise.race([ready, exited.then(() => { throw new Error("Transaction exited before lock barrier"); })]);
  } catch (error) {
    child.stdin.end("rollback;\n\\q\n");
    await exited.catch(() => {});
    throw error;
  } finally { clearTimeout(timer); }
  return async (action: "commit" | "rollback") => {
    if (child.exitCode !== null) { await exited; return; }
    child.stdin.end(`${action};\n\\q\n`);
    await exited;
  };
}

async function waitForBlockedConnection(name: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const blocked = db().sql(`select exists(select 1 from pg_stat_activity
      where application_name='${name}' and wait_event_type='Lock'
      and cardinality(pg_blocking_pids(pid)) > 0)`);
    if (blocked === "t") return;
    await setImmediate();
  }
  throw new Error(`No actual database lock barrier for ${name}`);
}

describe.skipIf(skipReason !== null)("a receipt spend cannot land after its Round closes", () => {
  it("rejects the stale open read after another request commits the close", async () => {
    // This is the final open-state observation recordSpend already makes.
    expect(db().sql(asServiceRole(`select closed_at is null from public.rounds where id='${ROUND}'`))).toBe("t");
    // Each sql/attempt uses a separate connection. The update commits before insert.
    db().sql(asServiceRole(`update public.rounds set closed_at='2026-10-28T23:00:00Z' where id='${ROUND}'`));
    expect(db().sql(asServiceRole(`select closed_at is not null from public.rounds where id='${ROUND}'`))).toBe("t");
    const result = await db().attempt(asServiceRole(`insert into public.round_spends
      (round_id,client_ref,payer_handle,recorded_by_handle,venue_id,venue_name,total_pence,items,receipt_photo_key)
      values ('${ROUND}','late-bill','ken','ken','venue-1','The Ship',620,'[]'::jsonb,'venue-1/late-bill/receipt.jpg')`));
    expect(result.ok, "The service-role insert must refuse the closed Round").toBe(false);
    expect(db().sql(`select count(*) from public.round_spends where round_id='${ROUND}'`)).toBe("0");
  });

  it("lets independent inserts coexist, then makes close wait for their commit", async () => {
    const finish = await holdTransaction(insertSpend("first"));
    let close: Promise<string> | undefined;
    try {
      // This would time out under FOR UPDATE. SHARE permits another independent spend.
      const second = await db().attempt(asServiceRole(`set statement_timeout='2s'; ${insertSpend("second")}`));
      expect(second.ok, second.said).toBe(true);
      close = db().sqlAsync(asServiceRole(`set application_name='round_close_wait'; update public.rounds set closed_at=now() where id='${ROUND}' returning closed_at is not null`));
      void close.catch(() => {});
      await waitForBlockedConnection("round_close_wait");
      await finish("commit");
      expect(await close).toBe("t");
      expect(db().sql(`select count(*) from public.round_spends where round_id='${ROUND}'`)).toBe("2");
    } finally {
      await finish("rollback");
      await close?.catch(() => {});
    }
  });

  it("makes an insert wait behind close and refuse after that close commits", async () => {
    const finish = await holdTransaction(`update public.rounds set closed_at=now() where id='${ROUND}'`);
    let insert: ReturnType<PostgresSession["attempt"]> | undefined;
    try {
      insert = db().attempt(asServiceRole(`set application_name='round_insert_wait'; ${insertSpend("after_close")}`));
      await waitForBlockedConnection("round_insert_wait");
      await finish("commit");
      const result = await insert;
      expect(result.ok).toBe(false);
      expect(result.said).toContain("P0204");
      expect(result.said).toContain("round_spend_round_closed");
      expect(db().sql(`select count(*) from public.round_spends where round_id='${ROUND}'`)).toBe("0");
    } finally {
      await finish("rollback");
      await insert;
    }
  });

  it("preserves the unique replay refusal without creating a second bill", async () => {
    db().sql(asServiceRole(insertSpend("replay")));
    for (const closed of [false, true]) {
      if (closed) db().sql(asServiceRole(`update public.rounds set closed_at=now() where id='${ROUND}'`));
      const replay = await db().attempt(asServiceRole(insertSpend("replay")));
      expect(replay.ok).toBe(false);
      expect(replay.said).toContain("23505");
      expect(db().sql(`select count(*) from public.round_spends where round_id='${ROUND}'`)).toBe("1");
    }
  });

  it("keeps browser writes refused and the missing-parent foreign key intact", async () => {
    for (const role of ["anon", "authenticated"]) {
      const result = await db().attempt(`set role ${role}; ${insertSpend("browser")}`);
      expect(result.ok).toBe(false);
      expect(result.said).toContain("42501");
    }
    const missing = await db().attempt(asServiceRole(insertSpend("missing").replace(ROUND, "e2040000-0000-4000-8000-000000000099")));
    expect(missing.ok).toBe(false);
    expect(missing.said).toContain("23503");
  });

  it("rolls back only the guard and reproduces the original late insert", async () => {
    const name = "20261029140000_0204_round_spend_closed_guard";
    db().applyFile(join(process.cwd(), `supabase/migrations/rollback/${name}_rollback.sql`));
    try {
      db().sql(asServiceRole(`update public.rounds set closed_at=now() where id='${ROUND}'`));
      expect((await db().attempt(asServiceRole(insertSpend("rollback_late")))).ok).toBe(true);
    } finally {
      db().applyFile(join(process.cwd(), `supabase/migrations/${name}.sql`));
    }
  });


  it("refuses a closed duplicate even when its prior spend is deleted before uniqueness enforcement", async () => {
    db().sql(asServiceRole(insertSpend("delete_race")));
    db().sql(asServiceRole(`update public.rounds set closed_at=now() where id='${ROUND}'`));
    // PostgreSQL orders same-event triggers by name. This test trigger runs after
    // the real round_spends_require_open_round guard, before uniqueness checks.
    db().sql(`create function pubmax_private.test_after_round_guard_barrier()
      returns trigger language plpgsql set search_path='' as $$
      begin perform pg_advisory_xact_lock(204204); return new; end $$;
      create trigger zz_test_after_round_guard_barrier before insert on public.round_spends
      for each row execute function pubmax_private.test_after_round_guard_barrier()`);
    const finish = await holdTransaction("select pg_advisory_xact_lock(204204)");
    let pending: ReturnType<PostgresSession["attempt"]> | undefined;
    let deleted = false;
    try {
      let settled: Awaited<ReturnType<PostgresSession["attempt"]>> | undefined;
      pending = db().attempt(asServiceRole(`set application_name='round_duplicate_delete_wait'; ${insertSpend("delete_race").replace("receipt.jpg", "replacement.jpg")}`));
      void pending.then((result) => { settled = result; });
      const deadline = Date.now() + 10_000;
      let atBarrier = false;
      while (Date.now() < deadline && settled === undefined) {
        atBarrier = db().sql(`select exists(select 1 from pg_stat_activity a
          where a.application_name='round_duplicate_delete_wait' and a.wait_event_type='Lock'
          and a.wait_event='advisory' and cardinality(pg_blocking_pids(a.pid)) > 0)`)==="t";
        if (atBarrier) break;
        await setImmediate();
      }
      // A corrected guard can refuse the duplicate before the test trigger.
      // Do not require that implementation to reach an intentionally unreachable barrier.
      expect(atBarrier || settled !== undefined, "Insert must reach the real barrier or return an early refusal").toBe(true);
      if (atBarrier) {
        expect(db().sql(asServiceRole(`delete from public.round_spends where round_id='${ROUND}' and client_ref='delete_race' returning client_ref`))).toBe("delete_race");
        deleted = true;
      }
      await finish("commit");
      const result = await pending;
      expect(result.ok, "A deleted duplicate must never let a replacement bill enter a closed Round").toBe(false);
      expect(result.said).toContain("23505");
      expect(db().sql(`select count(*) from public.round_spends where round_id='${ROUND}' and receipt_photo_key like '%replacement.jpg'`)).toBe("0");
      expect(db().sql(`select count(*) from public.round_spends where round_id='${ROUND}'`)).toBe(deleted ? "0" : "1");
    } finally {
      await finish("rollback");
      await pending;
      db().sql(`drop trigger zz_test_after_round_guard_barrier on public.round_spends;
        drop function pubmax_private.test_after_round_guard_barrier()`);
    }
  });

});
