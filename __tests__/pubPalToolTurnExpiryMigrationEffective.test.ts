import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as pollDelay } from "node:timers/promises";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const skipReason = postgresSkipReason();
const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");
const NAME = "20261002235326_0184_pub_pal_tool_turn_expiry_guard.sql";
const FORWARD = join(MIGRATIONS, NAME);
const ROLLBACK = join(MIGRATIONS, "rollback/20261002235326_0184_pub_pal_tool_turn_expiry_guard_rollback.sql");
const PREREQUISITES = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith(".sql") && name < NAME)
  .sort()
  .map((name) => join(MIGRATIONS, name));
const OWNER = "11111111-1111-4111-8111-111111111184";
const OTHER = "22222222-2222-4222-8222-222222222184";
const PAYLOAD = { revision: 1, query: "Synthetic user line", turns: [{ role: "user", content: "Synthetic user line" }], hints: [] as string[] };
type TurnRow = { conversation_id: string; owner_id: string | null; created_at: string; expires_at: string; payload: typeof PAYLOAD };
let session: PostgresSession | null = null;
let originalCatalog = "";

function db(): PostgresSession {
  if (!session) throw new Error("PubPal expiry PostgreSQL session unavailable.");
  return session;
}

function literal(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'";
}

function row(id: string): TurnRow {
  return JSON.parse(db().sql(`select row_to_json(turn)::text from public.pub_pal_tool_turns turn
    where conversation_id = ${literal(id)};`)) as TurnRow;
}

function seed(id: string, expiry = "clock_timestamp() + interval '120 seconds'", owner: string | null = OWNER): TurnRow {
  db().sql(`set role service_role;
    insert into public.pub_pal_tool_turns (conversation_id, owner_id, payload, expires_at)
    values (${literal(id)}, ${owner === null ? "null" : literal(owner) + "::uuid"},
      ${literal(JSON.stringify(PAYLOAD))}::jsonb, ${expiry});`);
  return row(id);
}

function receiptPayload(before: TurnRow): typeof PAYLOAD {
  return { ...before.payload, revision: before.payload.revision + 1, hints: ["Synthetic tool receipt"] };
}

// Same owner, raw birth, exact expiry and revision CAS as the real SDK PATCH.
// PostgreSQL's now() predicate deliberately remains: the row trigger must close
// the observed post-lock gap, rather than a changed test predicate hiding it.
function receiptSql(before: TurnRow, expected: Partial<Pick<TurnRow, "owner_id" | "created_at" | "expires_at">> & { revision?: number } = {}): string {
  const owner = expected.owner_id === undefined ? before.owner_id : expected.owner_id;
  return `set role service_role;
    with changed as (
      update public.pub_pal_tool_turns set payload = ${literal(JSON.stringify(receiptPayload(before)))}::jsonb
      where conversation_id = ${literal(before.conversation_id)}
        and owner_id ${owner === null ? "is null" : "= " + literal(owner) + "::uuid"}
        and created_at = ${literal(expected.created_at ?? before.created_at)}::timestamptz
        and expires_at = ${literal(expected.expires_at ?? before.expires_at)}::timestamptz
        and expires_at > now()
        and payload->>'revision' = ${literal(String(expected.revision ?? before.payload.revision))}
      returning conversation_id
    ) select count(*) from changed;`;
}

function tableCatalog(): string {
  return db().sql(`select jsonb_build_object(
    'rls', table_row.relrowsecurity, 'forceRls', table_row.relforcerowsecurity,
    'owner', pg_get_userbyid(table_row.relowner), 'acl', table_row.relacl,
    'privateSchemaAcl', (select nspacl from pg_namespace where nspname = 'pubmax_private'),
    'columns', (select jsonb_agg(jsonb_build_array(attribute.attname,
      format_type(attribute.atttypid, attribute.atttypmod), attribute.attnotnull,
      pg_get_expr(definition.adbin, definition.adrelid)) order by attribute.attnum)
      from pg_attribute attribute left join pg_attrdef definition
        on definition.adrelid = attribute.attrelid and definition.adnum = attribute.attnum
      where attribute.attrelid = table_row.oid and attribute.attnum > 0 and not attribute.attisdropped),
    'constraints', (select jsonb_agg(pg_get_constraintdef(oid) order by conname)
      from pg_constraint where conrelid = table_row.oid),
    'indexes', (select jsonb_agg(pg_get_indexdef(indexrelid) order by indexrelid::regclass::text)
      from pg_index where indrelid = table_row.oid),
    'policies', (select jsonb_agg(jsonb_build_array(polname, polcmd, polroles,
      pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)) order by polname)
      from pg_policy where polrelid = table_row.oid)
    )::text from pg_class table_row where table_row.oid = 'public.pub_pal_tool_turns'::regclass;`);
}

async function observe(statement: string, failure: string): Promise<void> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (await db().sqlAsync(statement) === "t") return;
    // Poll cadence never chooses the interleaving; an actual DB condition does.
    await pollDelay(50);
  }
  throw new Error(failure);
}

async function blockedReceipt(id: string): Promise<{ before: TurnRow; after: TurnRow; affected: string }> {
  expect(db().sql("select extract(epoch from current_setting('lock_timeout')::interval);")).toBe("15.000000");
  const before = seed(id, "clock_timestamp() + interval '5 seconds'");
  const locker = spawn(db().psql, [...db().databaseArgs, "-q", "-t", "-A"], { stdio: ["pipe", "pipe", "pipe"] });
  const closed = new Promise<number | null>((resolve) => locker.once("close", resolve));
  let pending: Promise<string> | undefined;
  let affected: string | undefined;
  try {
    const lockerPid = await new Promise<number>((resolve, reject) => {
      let output = "";
      const deadline = setTimeout(() => reject(new Error("Owned row-lock marker deadline.")), 5_000);
      locker.stdout.on("data", (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-2_000);
        const marker = /PUBPAL_LOCK_READY:(\d+)/.exec(output);
        if (marker) { clearTimeout(deadline); resolve(Number(marker[1])); }
      });
      locker.stderr.on("data", () => {});
      locker.once("error", (error) => { clearTimeout(deadline); reject(error); });
      locker.once("exit", () => { clearTimeout(deadline); reject(new Error("Owned psql exited before row lock.")); });
      locker.stdin.write(`begin;
        select conversation_id from public.pub_pal_tool_turns where conversation_id = ${literal(id)} for update;
        select 'PUBPAL_LOCK_READY:' || pg_backend_pid();\n`);
    });
    const application = "pubpal-expiry-" + id;
    pending = db().sqlAsync(`set application_name = ${literal(application)}; ${receiptSql(before)}`);
    await Promise.race([
      observe(`select exists (select 1 from pg_stat_activity where application_name = ${literal(application)}
        and wait_event_type = 'Lock' and ${lockerPid} = any(pg_blocking_pids(pid)));`,
      "No UPDATE blocked on the owned row lock."),
      pending.then(() => { throw new Error("UPDATE completed before observed row-lock wait."); }),
    ]);
    expect(db().sql(`select expires_at > clock_timestamp() from public.pub_pal_tool_turns
      where conversation_id = ${literal(id)};`), "Row must still be live after the wait is observed").toBe("t");
    await observe(`select expires_at <= clock_timestamp() from public.pub_pal_tool_turns
      where conversation_id = ${literal(id)};`, "Row did not expire before lock release.");
    expect(row(id)).toEqual(before);
  } finally {
    if (locker.exitCode === null) locker.stdin.end("rollback;\n");
    let forced = false;
    const deadline = setTimeout(() => { forced = true; locker.kill("SIGTERM"); }, 5_000);
    let exit: number | null;
    try { exit = await closed; } finally { clearTimeout(deadline); }
    if (pending) affected = await pending;
    if (forced || exit !== 0) throw new Error("Owned psql failed orderly row-lock teardown.");
  }
  if (affected === undefined) throw new Error("Missing UPDATE result after lock release.");
  return { before, after: row(id), affected };
}

beforeAll(async () => {
  if (skipReason) return;
  try {
    session = await startPostgres({ label: "pubpal-expiry-0184", database: "pubmax_pubpal_expiry_0184" });
    db().applyFile(join(ROOT, "scripts/rls/session-fixture.sql"));
    for (const path of PREREQUISITES) db().applyFile(path);
    db().sql(`insert into auth.users (id) values ('${OWNER}'), ('${OTHER}');`);
    originalCatalog = tableCatalog();
  } catch (error) {
    await session?.stop();
    session = null;
    throw error;
  }
}, 600_000);

afterAll(async () => {
  await session?.stop();
  session = null;
});

describe.skipIf(skipReason !== null)("0184 PubPal post-lock expiry on PostgreSQL", () => {
  it("reproduces a receipt written after expiry when now() passed before a row-lock wait", async () => {
    const result = await blockedReceipt("conv_BeforeExpiry0184");
    expect(result.affected).toBe("1");
    expect(result.after).toEqual({ ...result.before, payload: receiptPayload(result.before) });
  }, 30_000);

  it("adds only a private invoker trigger, preserving rows, grants, RLS and table shape", () => {
    const before = seed("conv_MigrateExpiry0184");
    db().applyFile(FORWARD);
    expect(row(before.conversation_id)).toEqual(before);
    expect(tableCatalog()).toBe(originalCatalog);
    expect(db().sql(`select count(*) from pg_trigger where tgrelid = 'public.pub_pal_tool_turns'::regclass
      and not tgisinternal and tgname = 'pub_pal_tool_turns_refuse_expired_update';`)).toBe("1");
    expect(db().sql(`select not prosecdef and proconfig @> array['search_path=""']
      from pg_proc where oid = 'pubmax_private.refuse_expired_pub_pal_tool_turn_update()'::regprocedure;`)).toBe("t");
    expect(db().sql(`select to_regprocedure('public.refuse_expired_pub_pal_tool_turn_update()') is null;`)).toBe("t");
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect(db().sql(`select has_function_privilege('${role}',
        'pubmax_private.refuse_expired_pub_pal_tool_turn_update()', 'execute');`)).toBe("f");
    }
    for (const role of ["anon", "authenticated"]) {
      expect(db().expectRefusal(`set role ${role}; select payload from public.pub_pal_tool_turns;`)).toContain("permission denied");
    }
  });

  it("returns zero rows and preserves the whole stored row after an observed lock wait crosses expiry", async () => {
    const result = await blockedReceipt("conv_AfterExpiry0184");
    expect(result.affected).toBe("0");
    expect(result.after).toEqual(result.before);
  }, 30_000);

  it("keeps live service-role receipts and the user's exact 120-second deadline extension", () => {
    const before = seed("conv_LiveExpiry0184");
    expect(db().sql(receiptSql(before))).toBe("1");
    const receipt = row(before.conversation_id);
    expect(receipt).toEqual({ ...before, payload: receiptPayload(before) });
    const lineAt = db().sql("select clock_timestamp();");
    const result = db().sql(`set role service_role;
      update public.pub_pal_tool_turns
      set expires_at = ${literal(lineAt)}::timestamptz + interval '120 seconds',
        payload = jsonb_set(payload, '{revision}', '3'::jsonb)
      where conversation_id = ${literal(before.conversation_id)} and owner_id = '${OWNER}'
        and created_at = ${literal(before.created_at)}::timestamptz
        and expires_at = ${literal(before.expires_at)}::timestamptz
        and expires_at > now() and payload->>'revision' = '2'
      returning extract(epoch from (expires_at - ${literal(lineAt)}::timestamptz));`);
    expect(Number(result)).toBe(120);
    const after = row(before.conversation_id);
    expect(after.owner_id).toBe(before.owner_id);
    expect(after.created_at).toBe(before.created_at);
    expect(after.payload).toEqual({ ...receipt.payload, revision: 3 });
    expect(Date.parse(after.expires_at)).toBeGreaterThanOrEqual(Date.parse(before.expires_at));
  });

  it("refuses an expired-row resurrection and an expiry equal to transaction time", () => {
    const before = seed("conv_ExpiredExpiry0184", "clock_timestamp() - interval '1 second'");
    expect(db().sql(`set role service_role;
      with changed as (update public.pub_pal_tool_turns
        set payload = ${literal(JSON.stringify(receiptPayload(before)))}::jsonb,
          expires_at = clock_timestamp() + interval '120 seconds'
        where conversation_id = ${literal(before.conversation_id)} returning conversation_id)
      select count(*) from changed;`)).toBe("0");
    expect(row(before.conversation_id)).toEqual(before);
    // >= deliberately admits exact transaction-time equality to the trigger;
    // using the normal > predicate here would never exercise its refusal.
    expect(db().sql(`begin; set role service_role;
      insert into public.pub_pal_tool_turns (conversation_id, owner_id, payload, expires_at)
      values ('conv_EqualityExpiry0184', '${OWNER}', ${literal(JSON.stringify(PAYLOAD))}::jsonb, now());
      select expires_at = now() from public.pub_pal_tool_turns where conversation_id = 'conv_EqualityExpiry0184';
      with changed as (update public.pub_pal_tool_turns set payload = jsonb_set(payload, '{revision}', '2'::jsonb)
        where conversation_id = 'conv_EqualityExpiry0184' and expires_at >= now() returning conversation_id)
      select count(*) from changed;
      select payload->>'revision' from public.pub_pal_tool_turns where conversation_id = 'conv_EqualityExpiry0184';
      commit;`)).toBe("t\n0\n1");
  });

  it("retains owner, raw-birth, exact-expiry, revision and unowned-row CAS fences", () => {
    const before = seed("conv_FencesExpiry0184");
    const wrongBirth = db().sql(`select (${literal(before.created_at)}::timestamptz + interval '1 microsecond')::text;`);
    const wrongExpiry = db().sql(`select (${literal(before.expires_at)}::timestamptz + interval '1 microsecond')::text;`);
    for (const expected of [{ owner_id: OTHER }, { owner_id: null }, { created_at: wrongBirth },
      { expires_at: wrongExpiry }, { revision: before.payload.revision + 1 }]) {
      expect(db().sql(receiptSql(before, expected))).toBe("0");
      expect(row(before.conversation_id)).toEqual(before);
    }
    const unowned = seed("conv_UnownedExpiry0184", undefined, null);
    expect(db().sql(receiptSql(unowned, { owner_id: OWNER }))).toBe("0");
    expect(row(unowned.conversation_id)).toEqual(unowned);
    expect(db().sql(receiptSql(unowned))).toBe("1");
    expect(row(unowned.conversation_id)).toEqual({ ...unowned, payload: receiptPayload(unowned) });
  });

  it("preserves expired DELETE/INSERT recovery and refuses the former generation's receipt", () => {
    const old = seed("conv_RecoveryExpiry0184", "clock_timestamp() - interval '1 second'");
    expect(db().sql(`set role service_role;
      delete from public.pub_pal_tool_turns where conversation_id = ${literal(old.conversation_id)}
        and expires_at <= now() returning conversation_id;`)).toBe(old.conversation_id);
    const fresh = seed(old.conversation_id);
    expect(fresh.created_at).not.toBe(old.created_at);
    expect(db().sql(receiptSql(old))).toBe("0");
    expect(row(fresh.conversation_id)).toEqual(fresh);
    expect(db().sql(receiptSql(fresh, { created_at: old.created_at }))).toBe("0");
    expect(row(fresh.conversation_id)).toEqual(fresh);
    expect(db().sql(receiptSql(fresh))).toBe("1");
    expect(row(fresh.conversation_id)).toEqual({ ...fresh, payload: receiptPayload(fresh) });
  });

  it("rolls back without changing rows or catalog and reproduces the post-lock expiry fault again", async () => {
    const before = db().sql("select jsonb_agg(to_jsonb(turn) order by conversation_id)::text from public.pub_pal_tool_turns turn;");
    db().applyFile(ROLLBACK);
    expect(db().sql("select jsonb_agg(to_jsonb(turn) order by conversation_id)::text from public.pub_pal_tool_turns turn;")).toBe(before);
    expect(tableCatalog()).toBe(originalCatalog);
    expect(db().sql("select to_regprocedure('pubmax_private.refuse_expired_pub_pal_tool_turn_update()') is null;")).toBe("t");
    expect(db().sql("select count(*) from pg_trigger where tgrelid = 'public.pub_pal_tool_turns'::regclass and not tgisinternal;")).toBe("0");
    const result = await blockedReceipt("conv_RollbackExpiry0184");
    expect(result.affected).toBe("1");
    expect(result.after).toEqual({ ...result.before, payload: receiptPayload(result.before) });
  }, 30_000);
});
