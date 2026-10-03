import { spawn as spawnProcess } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const skipReason = postgresSkipReason();
type HeldRollback = { writerExit: number | null; writerErr: string; rollbackExit: number | null; rollbackErr: string };

/** One owned writer holds its transaction while a rollback file runs; the writer then finishes. */
async function holdWriterAcrossRollback(input: {
  psql: string; args: readonly string[]; probe: (statement: string) => string;
  undo: string; label: string; hold: string; finish: string;
}): Promise<HeldRollback> {
  const writerName = `${input.label}-writer-${process.pid}`;
  const rollbackName = `${input.label}-rollback-${process.pid}`;
  const writer = spawnProcess(input.psql, [...input.args], {
    stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, PGAPPNAME: writerName },
  });
  let writerOut = "";
  let writerErr = "";
  let rollbackErr = "";
  writer.stdout.setEncoding("utf8");
  writer.stderr.setEncoding("utf8");
  writer.stdout.on("data", (chunk: string) => { writerOut += chunk; });
  writer.stderr.on("data", (chunk: string) => { writerErr += chunk; });
  writer.stdin.on("error", () => {});
  const writerDone = new Promise<number | null>((resolve) => writer.once("close", resolve));
  let rollbackDone: Promise<number | null> | null = null;
  try {
    writer.stdin.write(`${input.hold}\nselect 'WRITER_HELD';\n`);
    for (let attempt = 0; attempt < 200 && !writerOut.includes("WRITER_HELD"); attempt += 1) {
      if (writer.exitCode !== null) throw new Error(`Held writer failed: ${writerErr}`);
      await sleep(25);
    }
    if (!writerOut.includes("WRITER_HELD")) throw new Error(`Held writer did not start: ${writerErr}`);
    const undo = spawnProcess(input.psql, [...input.args, "-f", input.undo], {
      stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PGAPPNAME: rollbackName },
    });
    undo.stderr.setEncoding("utf8");
    undo.stderr.on("data", (chunk: string) => { rollbackErr += chunk; });
    rollbackDone = new Promise<number | null>((resolve) => undo.once("close", resolve));
    let waited = false;
    for (let attempt = 0; attempt < 200 && !waited; attempt += 1) {
      if (undo.exitCode !== null) throw new Error(`Rollback did not wait for the held writer: ${rollbackErr}`);
      waited = input.probe(`select exists(select 1 from pg_stat_activity
        where application_name='${rollbackName}' and wait_event_type='Lock')::text`) === "true";
      if (!waited) await sleep(25);
    }
    if (!waited) throw new Error("Rollback never waited for the held writer");
    writer.stdin.end(`${input.finish}\n`);
    const writerExit = await writerDone;
    return { writerExit, writerErr, rollbackExit: await rollbackDone, rollbackErr };
  } finally {
    if (writer.exitCode === null && !writer.stdin.writableEnded) writer.stdin.end("rollback;\n");
    await writerDone;
    if (rollbackDone) await rollbackDone;
  }
}

const migrations = join(process.cwd(), "supabase/migrations");
const name = "20260929120000_0161_plan_selected_drink_evidence.sql";
const forward = join(migrations, name);
const rollback = join(migrations, "rollback/20260929120000_0161_plan_selected_drink_evidence_rollback.sql");
const prerequisites = readdirSync(migrations)
  .filter((entry) => entry.endsWith(".sql") && entry < name)
  .sort()
  .map((entry) => join(migrations, entry));
const pendingBatchNames = [
  "20260929120000_0161_plan_selected_drink_evidence.sql",
  "20260929130000_0162_plan_create_selected_drink_evidence.sql",
  "20260929140000_0163_plan_replace_selected_drink_evidence.sql",
  "20260929150000_0164_plan_proposal_selected_drink_evidence.sql",
  "20260929160000_0165_plan_completion_selected_drink_evidence.sql",
  "20260929170000_0166_plan_context_selected_drink_evidence.sql",
  "20260929180000_0167_plan_replace_context_evidence.sql",
  "20260930120000_0168_plan_proposal_context_evidence.sql",
  "20260930121000_0175_friend_locations.sql",
  "20261001073000_0176_plan_listed_drink_evidence.sql",
  "20261001073100_0177_plan_manual_selected_evidence.sql",
  "20261001090000_0178_plan_route_alternatives.sql",
  "20261001091000_0179_plan_backup_context_evidence.sql",
  "20261001092000_0180_completion_group_snapshot.sql",
  "20261001092100_0181_social_crew_completion.sql",
  "20261001092200_0182_completion_group_active_accounts.sql",
] as const;
const planId = "10000000-0000-4000-8000-000000000161";
const memberId = "20000000-0000-4000-8000-000000000161";
const evidence = JSON.stringify({
  category: "wine",
  pence: 550,
  serving: null,
  source: "community",
  reportedAt: "2026-09-25T12:00:00.000Z",
});

let session: PostgresSession | null = null;
let policiesBefore = "";
let batchCatalogBefore = "";

function db(): PostgresSession {
  if (!session) throw new Error("PostgreSQL session unavailable");
  return session;
}

function columnExists(): boolean {
  return db().sql(`select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'plan_stops'
      and column_name = 'selected_drink_price_evidence'`) === "1";
}

function policies(): string {
  return db().sql(`select coalesce(string_agg(policyname || ':' || cmd || ':' || coalesce(qual, ''), ',' order by policyname), '')
    from pg_policies where schemaname = 'public' and tablename = 'plan_stops'`);
}

// Capture the complete objects touched by this batch, including every overload
// and every grantee. Route/table authorization remains in its single matrix.
function batchCatalog(): string {
  return db().sql(`with relations as (
    select c.*, n.nspname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname || '.' || c.relname in (
      'public.plan_stops', 'public.plan_completions', 'auth.users',
      'public.private_friend_location_generations', 'public.private_friend_location_sessions',
      'public.private_friend_location_grants', 'pubmax_private.plan_completion_group_snapshots'
    )
  ), functions as (
    select p.*, n.nspname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'pubmax_private') and p.proname in (
      'create_plan_idempotent_atomic', 'replace_plan_route_atomic',
      'decide_plan_route_proposal_atomic', 'update_legacy_plan_status_context_atomic',
      'plan_completion_capture_selected_drink_evidence', 'friend_location_account_live',
      'friend_location_grant_bound', 'friend_location_operation', 'purge_friend_locations',
      'plan_stop_evidence_for_context', 'snapshot_plan_completion_group',
      'erase_plan_completion_groups_on_account_delete', 'completion_group_week',
      'lock_plan_completion_identities', 'complete_social_crew_plan_atomic', 'complete_plan_atomic'
    )
  ), entries as (
    select jsonb_build_array('relation', nspname, relname, relkind, pg_get_userbyid(relowner),
      relrowsecurity, relforcerowsecurity, relreplident) as item from relations
    union all select jsonb_build_array('column', r.nspname, r.relname, a.attname,
      format_type(a.atttypid, a.atttypmod), a.attnotnull, a.attidentity, a.attgenerated,
      pg_get_expr(d.adbin, d.adrelid))
      from relations r join pg_attribute a on a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
      left join pg_attrdef d on d.adrelid = r.oid and d.adnum = a.attnum
    union all select jsonb_build_array('relation-grant', r.nspname, r.relname,
      pg_get_userbyid(g.grantor), case when g.grantee = 0 then 'PUBLIC' else pg_get_userbyid(g.grantee) end,
      g.privilege_type, g.is_grantable)
      from relations r cross join lateral aclexplode(coalesce(r.relacl, acldefault('r', r.relowner))) g
    union all select jsonb_build_array('column-grant', r.nspname, r.relname, a.attname,
      pg_get_userbyid(g.grantor), case when g.grantee = 0 then 'PUBLIC' else pg_get_userbyid(g.grantee) end,
      g.privilege_type, g.is_grantable)
      from relations r join pg_attribute a on a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
      cross join lateral aclexplode(a.attacl) g
    union all select jsonb_build_array('constraint', r.nspname, r.relname, c.conname,
      c.contype, c.convalidated, pg_get_constraintdef(c.oid, false))
      from relations r join pg_constraint c on c.conrelid = r.oid
    union all select jsonb_build_array('index', r.nspname, r.relname, i.relname,
      x.indisvalid, x.indisready, pg_get_indexdef(x.indexrelid))
      from relations r join pg_index x on x.indrelid = r.oid join pg_class i on i.oid = x.indexrelid
    union all select jsonb_build_array('trigger', r.nspname, r.relname, t.tgname,
      t.tgenabled, pg_get_triggerdef(t.oid, false))
      from relations r join pg_trigger t on t.tgrelid = r.oid where not t.tgisinternal
    union all select jsonb_build_array('policy', p.schemaname, p.tablename, p.policyname,
      p.permissive, p.roles, p.cmd, p.qual, p.with_check)
      from pg_policies p join relations r on r.nspname = p.schemaname and r.relname = p.tablename
    union all select jsonb_build_array('function', nspname, proname,
      pg_get_function_identity_arguments(oid), pg_get_userbyid(proowner), pg_get_functiondef(oid)) from functions
    union all select jsonb_build_array('function-grant', f.nspname, f.proname,
      pg_get_function_identity_arguments(f.oid), pg_get_userbyid(g.grantor),
      case when g.grantee = 0 then 'PUBLIC' else pg_get_userbyid(g.grantee) end,
      g.privilege_type, g.is_grantable)
      from functions f cross join lateral aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) g
    union all select jsonb_build_array('default-grant', n.nspname, pg_get_userbyid(d.defaclrole),
      d.defaclobjtype, pg_get_userbyid(g.grantor),
      case when g.grantee = 0 then 'PUBLIC' else pg_get_userbyid(g.grantee) end,
      g.privilege_type, g.is_grantable)
      from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
      cross join lateral aclexplode(d.defaclacl) g where n.nspname in ('public', 'pubmax_private')
  ) select coalesce(jsonb_agg(item order by item::text), '[]'::jsonb)::text from entries`);
}

beforeAll(async () => {
  if (skipReason) return;
  session = await startPostgres({ label: "plan-evidence-0161", database: "pubmax_plan_evidence" });
  try {
    db().applyFile(join(process.cwd(), "scripts/rls/session-fixture.sql"));
    for (const path of prerequisites) db().applyFile(path);
    db().sql(`insert into public.plans (id, title, start_time)
      values ('${planId}', 'Wine night', '2026-09-30T19:00:00Z');
      insert into public.plan_stops (plan_id, venue_id, venue_name, position)
      values ('${planId}', 'venue-a', 'A', 0);
      insert into auth.users (id) values ('${memberId}');
      insert into public.plan_crew_members (plan_id, name, token_hash, user_id)
      values ('${planId}', 'Member', '${"a".repeat(64)}', '${memberId}');`);
    policiesBefore = policies();
    batchCatalogBefore = batchCatalog();
  } catch (error) {
    await session.stop();
    session = null;
    throw error;
  }
}, 600_000);

afterAll(async () => {
  await session?.stop();
  session = null;
});

describe.skipIf(skipReason !== null)("0161 selected drink evidence storage", () => {
  it("reproduces the missing per-stop column before migration", () => {
    expect(columnExists()).toBe(false);
    expect(db().expectRefusal(`update public.plan_stops
      set selected_drink_price_evidence = '${evidence}'::jsonb
      where plan_id = '${planId}'`)).toContain("selected_drink_price_evidence");
  });

  it("adds nullable, bounded evidence without changing existing stops or access policy", () => {
    db().applyFile(forward);
    expect(columnExists()).toBe(true);
    expect(db().sql(`select venue_id || ':' || venue_name || ':' || position || ':' ||
      (selected_drink_price_evidence is null)::text from public.plan_stops where plan_id = '${planId}'`))
      .toBe("venue-a:A:0:true");
    expect(policies()).toBe(policiesBefore);
    expect(db().sql("select has_column_privilege('anon', 'public.plan_stops', 'selected_drink_price_evidence', 'select')"))
      .toBe("f");
    expect(db().sql("select has_column_privilege('authenticated', 'public.plan_stops', 'selected_drink_price_evidence', 'update')"))
      .toBe("f");
  });

  it("round trips wine evidence and rejects oversized, extra, or wrong-shaped data", () => {
    db().sql(`update public.plan_stops set selected_drink_price_evidence = '${evidence}'::jsonb
      where plan_id = '${planId}'`);
    expect(JSON.parse(db().sql(`select selected_drink_price_evidence::text
      from public.plan_stops where plan_id = '${planId}'`))).toEqual(JSON.parse(evidence));
    for (const invalid of [
      JSON.stringify({ ...JSON.parse(evidence), contributorHandle: "private" }),
      JSON.stringify({ ...JSON.parse(evidence), reportedAt: "x".repeat(600) }),
      JSON.stringify([JSON.parse(evidence)]),
    ]) {
      expect(db().expectRefusal(`update public.plan_stops
        set selected_drink_price_evidence = '${invalid}'::jsonb where plan_id = '${planId}'`))
        .toContain("plan_stops_selected_drink_price_evidence_check");
    }
  });

  it("keeps linked-member table reads within the closed display-value contract", () => {
    expect(JSON.parse(db().sql(`begin;
      set local request.jwt.claims = '{"sub":"${memberId}","role":"authenticated"}';
      set local role authenticated;
      select selected_drink_price_evidence::text from public.plan_stops where plan_id = '${planId}';
      commit;`))).toEqual(JSON.parse(evidence));

    for (const invalid of [
      { ...JSON.parse(evidence), category: "beer" },
      { ...JSON.parse(evidence), category: "cocktails" },
      { ...JSON.parse(evidence), category: null },
      { ...JSON.parse(evidence), pence: { amount: 550, contributorHandle: "private" } },
      { ...JSON.parse(evidence), pence: null },
      { ...JSON.parse(evidence), pence: 0 },
      { ...JSON.parse(evidence), pence: 100_001 },
      { ...JSON.parse(evidence), pence: 550.5 },
      { ...JSON.parse(evidence), serving: { contributorId: "private" } },
      { ...JSON.parse(evidence), source: { contributorHandle: "private" } },
      { ...JSON.parse(evidence), source: null },
      { ...JSON.parse(evidence), reportedAt: { contributorHandle: "private" } },
      { ...JSON.parse(evidence), reportedAt: null },
      { ...JSON.parse(evidence), reportedAt: "2026-09-25T12:00:00Z" },
      { ...JSON.parse(evidence), reportedAt: "2026-09-25T12:00:00.000+00:00" },
      { ...JSON.parse(evidence), reportedAt: "2026-02-30T12:00:00.000Z" },
    ]) {
      expect(db().expectRefusal(`update public.plan_stops
        set selected_drink_price_evidence = '${JSON.stringify(invalid)}'::jsonb
        where plan_id = '${planId}'`)).toMatch(/plan_stops_selected_drink_price_evidence_check|date\/time field value out of range/);
    }
  });

  it("rollback drops only evidence storage and preserves the route", () => {
    db().applyFile(rollback);
    expect(columnExists()).toBe(false);
    expect(db().sql(`select venue_id || ':' || venue_name || ':' || position
      from public.plan_stops where plan_id = '${planId}'`)).toBe("venue-a:A:0");
    expect(policies()).toBe(policiesBefore);
  });

  it("reverses all sixteen pending migrations to the exact pre-batch catalog and route", () => {
    expect(batchCatalog()).toBe(batchCatalogBefore);
    const routeBefore = db().sql(`select to_jsonb(s)::text from public.plan_stops s where plan_id = '${planId}'`);
    const batchPaths = pendingBatchNames.map((entry) => join(migrations, entry));
    const rollbackPaths = [...pendingBatchNames].reverse()
      .map((entry) => join(migrations, "rollback", entry.replace(/\.sql$/, "_rollback.sql")));
    for (const path of [...batchPaths, ...rollbackPaths]) {
      expect(existsSync(path), `Required pending-batch migration: ${path}`).toBe(true);
    }

    // Each file is transactional. Files containing BEGIN/COMMIT retain their
    // own transaction; this does not assert one transaction across the batch.
    for (const path of batchPaths) db().applyFileTransactional(path);
    expect(columnExists()).toBe(true);
    expect(db().sql(`select count(*) from information_schema.columns where table_schema = 'public'
      and table_name = 'plan_stops' and column_name = 'alternatives'`)).toBe("1");
    expect(db().sql(`select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname || '.' || c.relname in (
        'public.private_friend_location_generations', 'public.private_friend_location_sessions',
        'public.private_friend_location_grants', 'pubmax_private.plan_completion_group_snapshots'
      )`)).toBe("4");
    expect(batchCatalog()).not.toBe(batchCatalogBefore);

    for (const path of rollbackPaths) db().applyFileTransactional(path);
    expect(JSON.parse(batchCatalog())).toStrictEqual(JSON.parse(batchCatalogBefore));
    expect(db().sql(`select to_jsonb(s)::text from public.plan_stops s where plan_id = '${planId}'`)).toBe(routeBefore);
  });
});

describe.skipIf(skipReason !== null)("0185 named listed quote storage", () => {
  const migration = "20261003031818_0185_plan_named_listed_drink_evidence.sql";
  const undo = join(migrations, "rollback", migration.replace(/\.sql$/, "_rollback.sql"));
  const legacy = {
    category: "wine", pence: 550, serving: "125ml", source: "listed",
    sourceUrl: "https://www.sydneyarmschelsea.com/menu/", observedAt: "2026-09-29T10:40:17.846Z",
  };
  const named = { ...legacy, drinkLabel: "Chardonnay, Pays D’oc, France", drinkSubtype: "wine-white" };
  const community = JSON.parse(evidence);
  const literal = (value: unknown): string => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
  const plan = (suffix: string): string => `10000000-0000-4000-8000-00000000185${suffix}`;
  const member = (suffix: string): string => `20000000-0000-4000-8000-00000000185${suffix}`;
  let namedSession: PostgresSession | null = null;
  let oldCheck = "";
  let oldAccess = "";

  function namedDb(): PostgresSession {
    if (!namedSession) throw new Error("Named quote PostgreSQL session unavailable");
    return namedSession;
  }
  function checkDefinition(): string {
    return namedDb().sql(`select pg_get_constraintdef(oid) from pg_constraint
      where conrelid = 'public.plan_stops'::regclass
      and conname = 'plan_stops_selected_drink_price_evidence_check'`);
  }
  function access(): string {
    return namedDb().sql(`select jsonb_build_object(
      'policies', (select jsonb_agg(to_jsonb(p) order by policyname) from pg_policies p
        where schemaname = 'public' and tablename = 'plan_stops'),
      'acl', (select relacl::text from pg_class where oid = 'public.plan_stops'::regclass),
      'columnAcl', (select attacl::text from pg_attribute where attrelid = 'public.plan_stops'::regclass
        and attname = 'selected_drink_price_evidence'))::text`);
  }
  function route(value: unknown): Array<Record<string, unknown>> {
    return [
      { venueId: "venue-uk-n8308248176", venueName: "The Sydney Arms", selectedDrinkPriceEvidence: value },
      { venueId: "venue-b", venueName: "B", selectedDrinkPriceEvidence: legacy },
      { venueId: "venue-c", venueName: "C", selectedDrinkPriceEvidence: community },
    ];
  }
  function create(suffix: string, value: unknown): string {
    return namedDb().sql(`select public.create_plan_with_context_idempotent_atomic(
      '${plan(suffix)}'::uuid, 'Named wine', '2026-10-03T19:00:00Z', ${literal(route(value))},
      '${member(suffix)}'::uuid, 'Host', '${suffix.repeat(64)}', '2026-10-03T12:00:00Z',
      '${suffix.repeat(64)}', '${suffix.repeat(64)}', null, null, null, null)`);
  }
  function saved(suffix: string): unknown[] {
    return JSON.parse(namedDb().sql(`select jsonb_agg(selected_drink_price_evidence order by position)::text
      from public.plan_stops where plan_id = '${plan(suffix)}'`));
  }
  function write(value: unknown): string {
    return `update public.plan_stops set selected_drink_price_evidence = ${literal(value)}
      where plan_id = '${plan("1")}' and position = 0`;
  }

  beforeAll(async () => {
    if (skipReason) return;
    namedSession = await startPostgres({ label: "named-quote-0185", database: "pubmax_named_quote" });
    try {
      namedDb().applyFile(join(process.cwd(), "scripts/rls/session-fixture.sql"));
      for (const entry of readdirSync(migrations).filter((entry) => entry.endsWith(".sql") && entry < migration).sort()) {
        namedDb().applyFile(join(migrations, entry));
      }
      oldCheck = checkDefinition();
      oldAccess = access();
      expect(create("1", legacy)).toBe("created");
    } catch (error) {
      await namedSession.stop();
      namedSession = null;
      throw error;
    }
  }, 600_000);
  afterAll(async () => { await namedSession?.stop(); namedSession = null; });

  it("reproduces the existing CHECK refusing named fields while legacy citations persist", () => {
    expect(saved("1")).toEqual([legacy, legacy, community]);
    expect(namedDb().expectRefusal(write(named))).toContain("plan_stops_selected_drink_price_evidence_check");
    expect(saved("1")).toEqual([legacy, legacy, community]);
  });

  it("admits named quotes and explicit unknown subtype without changing existing evidence or access", () => {
    namedDb().applyFile(join(migrations, migration));
    expect(access()).toBe(oldAccess);
    expect(saved("1")).toEqual([legacy, legacy, community]);
    namedDb().sql(`update public.plan_stops set selected_drink_price_evidence = null
      where plan_id = '${plan("1")}' and position = 0`);
    expect(saved("1")).toEqual([null, legacy, community]);
    namedDb().sql(write(named));
    expect(saved("1")).toEqual([named, legacy, community]);
    const unknown = { ...legacy, category: "other", drinkLabel: "House special", drinkSubtype: null };
    namedDb().sql(write(unknown));
    expect(saved("1")).toEqual([unknown, legacy, community]);
    namedDb().sql(write(named));
  });

  it("keeps the SQL subtype vocabulary aligned with every eligible canonical category", async () => {
    const { DRINK_SUBTYPES } = await import("@/lib/drinkSubtypes");
    for (const subtype of DRINK_SUBTYPES.filter((entry) => entry.category !== "beer")) {
      const value = { ...named, category: subtype.category, drinkSubtype: subtype.id };
      namedDb().sql(write(value));
      expect(saved("1")[0]).toEqual(value);
    }
    namedDb().sql(write(named));
  });

  it("refuses malformed identity and citations without replacing the stored quote", () => {
    const invalid = [
      null, {}, [],
      ...["category", "pence", "serving", "source", "sourceUrl", "observedAt"]
        .map((key) => ({ ...named, [key]: undefined })),
      { ...legacy, drinkLabel: named.drinkLabel }, { ...legacy, drinkSubtype: "wine-white" },
      { ...named, drinkLabel: "" }, { ...named, drinkLabel: " x" },
      { ...named, drinkLabel: "x\n" }, { ...named, drinkLabel: "x".repeat(81) },
      { ...named, drinkLabel: null }, { ...named, drinkSubtype: 4 },
      { ...named, drinkSubtype: "wine-invented" }, { ...named, drinkSubtype: "gin-london-dry" },
      { ...named, category: "beer", drinkSubtype: "beer-ipa" },
      { ...named, extra: "private" }, { ...named, pence: 0 }, { ...named, pence: 100_001 },
      { ...named, pence: 550.5 },
      { ...named, sourceUrl: "https://user:secret@example.org/menu" },
      { ...named, sourceUrl: "javascript:alert(1)" }, { ...named, observedAt: "2026-09-29" },
      { ...named, source: "community", reportedAt: community.reportedAt },
    ];
    for (const value of invalid) {
      expect(namedDb().expectRefusal(write(value))).toContain("plan_stops_selected_drink_price_evidence_check");
      expect(saved("1")[0]).toEqual(named);
    }
  });

  it("preserves all eight fields through creation, replay and proposal acceptance", () => {
    expect(create("2", named)).toBe("created");
    expect(saved("2")).toEqual([named, legacy, community]);
    expect(create("2", named)).toBe("replayed");
    expect(saved("2")).toEqual([named, legacy, community]);
    const proposed = route(named).map((stop, position) => ({ ...stop, position }));
    namedDb().sql(`insert into public.plan_route_proposals
      (id, plan_id, proposed_by_member_id, expected_route_revision, stops, reason, idempotency_key, created_at)
      values ('30000000-0000-4000-8000-000000001852', '${plan("2")}', '${member("2")}',
        1, ${literal(proposed)}, 'Route', 'named-0185', now())`);
    const decide = `select public.decide_plan_route_proposal_atomic('${plan("2")}'::uuid,
      '30000000-0000-4000-8000-000000001852'::uuid, '${"2".repeat(64)}', 'accepted', 'named-decision', now())`;
    expect(namedDb().sql(decide)).toBe("decided");
    expect(saved("2")).toEqual([named, legacy, community]);
    expect(namedDb().sql(decide)).toBe("already_decided");
    expect(saved("2")).toEqual([named, legacy, community]);
    expect(access()).toBe(oldAccess);
  });

  it("captures saved named identity in completion and refuses rollback without data loss", async () => {
    namedDb().sql(`insert into public.plan_actions (id, plan_id, actor_member_id, type, stop_position, created_at)
      values ('30000000-0000-4000-8000-000000001851', '${plan("1")}', '${member("1")}',
        'arrived', 0, '2026-10-03T12:10:00Z')`);
    expect(namedDb().sql(`select public.complete_plan_atomic('${plan("1")}'::uuid, '${"1".repeat(64)}', 1,
      '40000000-0000-4000-8000-000000001851'::uuid, '50000000-0000-4000-8000-000000001851'::uuid,
      'get_home', null, '{"kind":"get_home","optionId":"transport:nearest-station","evidenceSnapshot":{"label":"Station"}}'::jsonb,
      '2026-10-03T13:00:00Z')`)).toBe("completed");
    const snapshot = namedDb().sql(`select route_snapshot::text from public.plan_completions where plan_id = '${plan("1")}'`);
    expect(JSON.parse(snapshot)[0].selectedDrinkPriceEvidence).toEqual(named);
    const currentCheck = checkDefinition();
    expect(() => namedDb().applyFileTransactional(undo)).toThrow("Named selected-price rows remain");
    expect(checkDefinition()).toBe(currentCheck);
    expect(saved("1")[0]).toEqual(named);
    expect(namedDb().sql(`select route_snapshot::text from public.plan_completions where plan_id = '${plan("1")}'`)).toBe(snapshot);
    // A local fixture downgrades only its own active rows to exercise the old
    // CHECK. Production data needs a separate explicit captain decision.
    namedDb().sql(`update public.plan_stops set selected_drink_price_evidence =
      selected_drink_price_evidence - array['drinkLabel','drinkSubtype']
      where selected_drink_price_evidence ? 'drinkLabel'`);
    const namedBackup = [{ venueId: "venue-uk-n8308248176", venueName: "The Sydney Arms", selectedDrinkPriceEvidence: named }];
    namedDb().sql(`update public.plan_stops set alternatives = ${literal(namedBackup)}
      where plan_id = '${plan("1")}' and position = 1`);
    expect(() => namedDb().applyFileTransactional(undo)).toThrow("Named selected-price rows remain");
    expect(checkDefinition()).toBe(currentCheck);
    namedDb().sql(`update public.plan_stops set alternatives = '[]'::jsonb
      where plan_id = '${plan("1")}' and position = 1`);
    namedDb().sql(`insert into public.plan_route_proposals
      (id, plan_id, proposed_by_member_id, expected_route_revision, stops, reason, idempotency_key, created_at)
      values ('30000000-0000-4000-8000-000000001853', '${plan("1")}', '${member("1")}',
        1, ${literal(route(named).map((stop, position) => ({ ...stop, position })))}, 'Route', 'named-0185-pending', now())`);
    expect(() => namedDb().applyFileTransactional(undo)).toThrow("Named selected-price rows remain");
    expect(checkDefinition()).toBe(currentCheck);
    namedDb().sql(`update public.plan_route_proposals set stops = ${literal(route(legacy).map((stop, position) => ({
      ...stop, position, ...(position === 1 ? { alternatives: namedBackup } : {}) })))}
      where id = '30000000-0000-4000-8000-000000001853'`);
    expect(() => namedDb().applyFileTransactional(undo)).toThrow("Named selected-price rows remain");
    expect(checkDefinition()).toBe(currentCheck);
    namedDb().sql(`update public.plan_route_proposals set status = 'rejected', decided_at = now()
      where id = '30000000-0000-4000-8000-000000001853'`);
    const held = await holdWriterAcrossRollback({
      psql: namedDb().psql, args: [...namedDb().databaseArgs, "-t", "-A"], probe: (statement) => namedDb().sql(statement),
      undo, label: "named-0185",
      hold: `begin; insert into public.plan_route_proposals
        (id, plan_id, proposed_by_member_id, expected_route_revision, stops, reason, idempotency_key, created_at)
        values ('30000000-0000-4000-8000-000000001854', '${plan("1")}', '${member("1")}',
          1, ${literal(route(named).map((stop, position) => ({ ...stop, position })))}, 'Route', 'named-0185-held', now());`,
      finish: "commit;",
    });
    expect(held.writerExit, held.writerErr).toBe(0);
    expect(held.rollbackExit, held.rollbackErr).not.toBe(0);
    expect(held.rollbackErr).toContain("Named selected-price rows remain");
    expect(checkDefinition()).toBe(currentCheck);
    namedDb().sql(`update public.plan_route_proposals set status = 'rejected', decided_at = now()
      where id = '30000000-0000-4000-8000-000000001854'`);
    namedDb().applyFileTransactional(undo);
    expect(checkDefinition()).toBe(oldCheck);
    expect(access()).toBe(oldAccess);
    expect(namedDb().expectRefusal(write(named))).toContain("plan_stops_selected_drink_price_evidence_check");
    expect(namedDb().sql(`select route_snapshot::text from public.plan_completions where plan_id = '${plan("1")}'`)).toBe(snapshot);
  });
});

// The durable seam is the existing RPC over real local PostgREST. SQL reads
// inspect atomic persistence/catalog restoration; no store or HTTP double.
describe.skipIf(skipReason !== null)("0186 Cider evidence over durable RPCs", () => {
  const migration = "20261003085500_0186_plan_cider_selected_evidence.sql";
  const undo = join(migrations, "rollback", migration.replace(".sql", "_rollback.sql"));
  const cider = {
    category: "beer", pence: 365, serving: null, source: "listed",
    sourceUrl: "https://www.theploughstjohnshill.co.uk/the-bar/",
    observedAt: "2026-09-21T18:27:31.674Z",
    drinkLabel: "Aspall 4.5%", drinkSubtype: "beer-cider",
  };
  const ciderContext = { drinkCategory: "beer", drinkSubtype: "beer-cider" };
  const wine = {
    category: "wine", pence: 550, serving: "125ml", source: "listed",
    sourceUrl: "https://www.sydneyarmschelsea.com/menu/",
    observedAt: "2026-09-29T10:40:17.846Z",
  };
  type DurableSession = {
    port: number;
    sqlFile(path: string): void;
    sql(statement: string): { ok: boolean; out: string; err: string };
    catalogSnapshot(): string;
    reloadPostgrestSchema(): Promise<void>;
    restBaseUrl: string;
    serviceRoleKey: string;
    stop(): Promise<void>;
  };
  let durable: DurableSession | null = null;
  let priorCatalog = "";
  let priorAccess = "";
  const id = (kind: number, suffix: number) => `${kind}0000000-0000-4000-8000-0000000186${String(suffix).padStart(2, "0")}`;
  const host = (suffix: number) => String(suffix).padStart(64, "0");
  const literal = (value: unknown) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
  const route = (value: unknown = cider) => [
    { venueId: "venue-13xdb1p", venueName: "The Plough", ...(value ? { selectedDrinkPriceEvidence: value } : {}), alternatives: [] },
    { venueId: "venue-stage5-base", venueName: "Local route fixture", alternatives: [
      { venueId: "venue-13xdb1p", venueName: "The Plough", ...(value ? { selectedDrinkPriceEvidence: value } : {}) },
    ] },
  ];
  function session0186(): DurableSession {
    if (!durable) throw new Error("Cider durable session unavailable");
    return durable;
  }
  function sql0186(statement: string): string {
    const result = session0186().sql(statement);
    if (!result.ok) throw new Error(result.err);
    return result.out.trim();
  }
  async function rpc(name: string, body: Record<string, unknown>) {
    const current = session0186();
    const response = await fetch(`${current.restBaseUrl}/rpc/${name}`, {
      method: "POST",
      headers: { authorization: `Bearer ${current.serviceRoleKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as unknown };
  }
  function createArgs(suffix: number, selectedContext: unknown = ciderContext, stops: unknown = route()) {
    return {
      p_id: id(1, suffix), p_title: "Durable Cider fixture", p_start_time: "2026-10-03T19:00:00Z",
      p_stops: stops, p_member_id: id(2, suffix), p_member_name: "Host", p_token_hash: host(suffix),
      p_joined_at: "2026-10-03T12:00:00Z", p_idempotency_key_hash: host(suffix), p_request_hash: host(suffix),
      p_anchor_venue_id: null, p_anchor_source: null, p_outcome: null, p_context: selectedContext,
    };
  }
  const create0186 = (suffix: number, selectedContext: unknown = ciderContext, stops: unknown = route()) =>
    rpc("create_plan_with_context_idempotent_atomic", createArgs(suffix, selectedContext, stops));
  const patchContext = (suffix: number, selectedContext: unknown, token = host(suffix)) =>
    rpc("update_legacy_plan_status_context_atomic", {
      p_plan_id: id(1, suffix), p_token_hash: token, p_status: null, p_context: selectedContext,
    });
  const replace0186 = (suffix: number, stops: unknown = route(), revision = 1, token = host(suffix), grounded = false) =>
    rpc("replace_plan_route_atomic", {
      p_plan_id: id(1, suffix), p_token_hash: token, p_expected_route_revision: revision,
      p_stops: stops, p_context: null, p_grounded_upgrade: grounded,
    });
  function saved0186(suffix: number): Array<{ selectedDrinkPriceEvidence: unknown; alternatives: Array<Record<string, unknown>> }> {
    return JSON.parse(sql0186(`select jsonb_agg(jsonb_build_object(
      'selectedDrinkPriceEvidence', selected_drink_price_evidence, 'alternatives', alternatives)
      order by position)::text from public.plan_stops where plan_id = '${id(1, suffix)}'`));
  }
  function quotes0186(suffix: number): unknown[] {
    const stops = saved0186(suffix);
    return [stops[0]?.selectedDrinkPriceEvidence ?? null, stops[1]?.alternatives[0]?.selectedDrinkPriceEvidence ?? null];
  }
  function catalog0186(): string {
    return session0186().catalogSnapshot() + "\n" + sql0186(`select jsonb_agg(jsonb_build_array(
      n.nspname, c.relname, con.conname, pg_get_constraintdef(con.oid)) order by n.nspname,c.relname,con.conname)::text
      from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','pubmax_private')`);
  }
  function access0186(): string {
    return sql0186(`select jsonb_build_object(
      'defaults', (select jsonb_agg(jsonb_build_array(pg_get_userbyid(defaclrole),coalesce(n.nspname,''),defaclobjtype,defaclacl::text)
        order by defaclrole,coalesce(n.nspname,''),defaclobjtype) from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace),
      'policies', (select jsonb_agg(jsonb_build_array(schemaname,tablename,policyname,cmd,roles,qual,with_check)
        order by schemaname,tablename,policyname) from pg_policies),
      'rpc', (select jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,coalesce(p.proacl::text,'<default>'),p.prosecdef,p.proconfig)
        order by p.oid::regprocedure::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname in ('plan_stop_evidence_for_context','create_plan_with_context_idempotent_atomic',
          'replace_plan_route_atomic','decide_plan_route_proposal_atomic','update_legacy_plan_status_context_atomic','complete_plan_atomic'))
    )::text`);
  }
  beforeAll(async () => {
    // @ts-expect-error Executable existing MJS harness has no declaration file.
    const { startRlsSession } = await import("../scripts/rls/session-harness.mjs") as { startRlsSession(): Promise<DurableSession> };
    durable = await startRlsSession();
    for (const candidate of readdirSync(migrations).filter((entry) => entry.endsWith(".sql")
      && entry > "20260806035204_0070_v1_release_security.sql" && entry < migration).sort()) {
      durable.sqlFile(join(migrations, candidate));
    }
    priorCatalog = catalog0186();
    priorAccess = access0186();
    // Before runs current 0185 + 0172. After uses the same frozen tests once
    // the authorized forward file exists; absence is never a skip or a pass.
    if (existsSync(join(migrations, migration))) durable.sqlFile(join(migrations, migration));
    await durable.reloadPostgrestSchema();
  }, 180_000);
  afterAll(async () => { await durable?.stop(); }, 30_000);

  it("refuses rollback after a held backup-only writer commits without changing catalog or evidence", async () => {
    // Run before the other Cider cases: the guard must observe this writer's
    // new backup, rather than being refused by previously committed fixtures.
    const { spawn } = await import("node:child_process");
    const { setTimeout: delay } = await import("node:timers/promises");
    const { findPostgresBinary } = await import("../scripts/rls/postgresHost.mjs");
    const psql = findPostgresBinary("psql");
    if (!psql) throw new Error("Existing PostgreSQL harness has no psql binary");
    expect(await create0186(65, ciderContext, route(null))).toEqual({ status: 200, body: "created" });
    expect(sql0186(`select count(*)::text from public.plan_stops where
      selected_drink_price_evidence->>'drinkSubtype'='beer-cider'
      or exists (select 1 from jsonb_array_elements(alternatives) item
        where item->'selectedDrinkPriceEvidence'->>'drinkSubtype'='beer-cider')`)).toBe("0");
    const currentCatalog = catalog0186();
    const args = ["-h", "127.0.0.1", "-p", String(session0186().port), "-U", "postgres", "-d", "pubmax_rls",
      "-v", "ON_ERROR_STOP=1", "-t", "-A"];
    const writerName = `cider-backup-writer-${process.pid}`;
    const rollbackName = `cider-backup-rollback-${process.pid}`;
    const writer = spawn(psql, args, {
      stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, PGAPPNAME: writerName },
    });
    let writerOut = "";
    let writerErr = "";
    const failures: { writer: Error | null; rollback: Error | null } = { writer: null, rollback: null };
    writer.stdout.setEncoding("utf8");
    writer.stderr.setEncoding("utf8");
    writer.stdout.on("data", (chunk: string) => { writerOut += chunk; });
    writer.stderr.on("data", (chunk: string) => { writerErr += chunk; });
    writer.stdin.on("error", (error: Error) => { failures.writer = error; });
    writer.on("error", (error: Error) => { failures.writer = error; });
    const writerDone = new Promise<number | null>((resolve) => writer.once("close", resolve));
    let rollback: ReturnType<typeof spawn> | null = null;
    let rollbackDone: Promise<number | null> | null = null;
    let rollbackErr = "";
    try {
      writer.stdin.write(`begin;
        update public.plan_stops set alternatives=${literal(route()[1].alternatives)}
          where plan_id='${id(1, 65)}' and position=1;
        select 'CIDER_BACKUP_WRITER_HELD';\n`);
      for (let attempt = 0; attempt < 100 && !writerOut.includes("CIDER_BACKUP_WRITER_HELD"); attempt += 1) {
        if (failures.writer || writer.exitCode !== null) throw new Error(`Backup writer failed: ${failures.writer?.message ?? writerErr}`);
        await delay(25);
      }
      expect(writerOut, writerErr).toContain("CIDER_BACKUP_WRITER_HELD");
      expect(sql0186(`select exists(select 1 from pg_locks l join pg_stat_activity a on a.pid=l.pid
        where a.application_name='${writerName}' and l.relation='public.plan_stops'::regclass
          and l.mode='RowExclusiveLock' and l.granted)::text`)).toBe("true");
      const undoProcess = spawn(psql, [...args, "-f", undo], {
        stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PGAPPNAME: rollbackName },
      });
      rollback = undoProcess;
      undoProcess.stderr.setEncoding("utf8");
      undoProcess.stderr.on("data", (chunk: string) => { rollbackErr += chunk; });
      undoProcess.on("error", (error: Error) => { failures.rollback = error; });
      rollbackDone = new Promise<number | null>((resolve) => undoProcess.once("close", resolve));
      let waited = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (failures.rollback || undoProcess.exitCode !== null) throw new Error(`Rollback did not wait: ${failures.rollback?.message ?? rollbackErr}`);
        if (sql0186(`select exists(select 1 from pg_stat_activity
          where application_name='${rollbackName}' and wait_event_type='Lock')::text`) === "true") {
          waited = true;
          break;
        }
        await delay(25);
      }
      expect(waited).toBe(true);
      writer.stdin.end("commit;\n");
      expect(await writerDone, writerErr).toBe(0);
      const rollbackExit = await rollbackDone;
      expect(rollbackExit, rollbackErr).not.toBeNull();
      expect(rollbackExit, rollbackErr).not.toBe(0);
      expect(rollbackErr).toContain("Cider selected-price rows remain");
      expect(quotes0186(65)).toEqual([null, cider]);
      expect(catalog0186()).toBe(currentCatalog);
    } finally {
      // Settle only these two owned psql children. Closing the writer's stdin
      // with ROLLBACK releases its table lock on any earlier assertion failure.
      if (writer.exitCode === null && !writer.stdin.writableEnded && !writer.stdin.destroyed) {
        writer.stdin.end("rollback;\n");
      }
      await writerDone;
      if (rollback && rollbackDone) await rollbackDone;
    }
  });

  it("waits behind a held proposal decision that then writes stops, without deadlock", async () => {
    const { findPostgresBinary } = await import("../scripts/rls/postgresHost.mjs");
    const psql = findPostgresBinary("psql");
    if (!psql) throw new Error("Existing PostgreSQL harness has no psql binary");
    expect(quotes0186(65)).toEqual([null, cider]);
    sql0186(`insert into public.plan_route_proposals
      (id,plan_id,proposed_by_member_id,expected_route_revision,stops,reason,idempotency_key,created_at)
      values('${id(3, 65)}','${id(1, 65)}','${id(2, 65)}',1,
        ${literal(route(null).map((stop, position) => ({ ...stop, position })))},'Held decision','held-decision-65',now())`);
    const currentCatalog = catalog0186();
    const held = await holdWriterAcrossRollback({
      psql, args: ["-h", "127.0.0.1", "-p", String(session0186().port), "-U", "postgres", "-d", "pubmax_rls",
        "-v", "ON_ERROR_STOP=1", "-t", "-A"],
      probe: sql0186, undo, label: "cider-decision",
      hold: `begin; update public.plan_route_proposals set reason='Held decision accepted' where id='${id(3, 65)}';`,
      finish: `update public.plan_stops set venue_name=venue_name where plan_id='${id(1, 65)}'; commit;`,
    });
    expect(held.writerExit, held.writerErr).toBe(0);
    expect(held.rollbackErr).not.toContain("deadlock");
    expect(held.rollbackExit, held.rollbackErr).not.toBe(0);
    expect(held.rollbackErr).toContain("Cider selected-price rows remain");
    expect(catalog0186()).toBe(currentCatalog);
    sql0186(`update public.plan_route_proposals set status='rejected', decided_at=now() where id='${id(3, 65)}'`);
  });

  it("stores the own published unknown-measure Cider tuple in primary and backup through create/read/replay", async () => {
    expect(await create0186(1)).toEqual({ status: 200, body: "created" });
    expect(quotes0186(1)).toEqual([cider, cider]);
    const read = await fetch(`${session0186().restBaseUrl}/plan_stops?plan_id=eq.${id(1, 1)}&select=selected_drink_price_evidence,alternatives&order=position`, {
      headers: { authorization: `Bearer ${session0186().serviceRoleKey}` },
    });
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual([
      { selected_drink_price_evidence: cider, alternatives: [] },
      { selected_drink_price_evidence: null, alternatives: route()[1].alternatives },
    ]);
    expect(await create0186(1)).toEqual({ status: 200, body: "replayed" });
    expect(quotes0186(1)).toEqual([cider, cider]);
    expect(sql0186(`select route_revision::text from public.plans where id='${id(1, 1)}'`)).toBe("1");
  });

  it.each([
    ["generic Beer", { drinkCategory: "beer" }],
    ["other Beer subtype", { drinkCategory: "beer", drinkSubtype: "beer-stout" }],
    ["explicit pint", { ...ciderContext, drinkServing: "pint" }],
    ["explicit volume", { ...ciderContext, drinkServing: "500ml" }],
    ["other category", { drinkCategory: "wine" }],
    ["zero proof", { ...ciderContext, zeroProof: true }],
    ["missing context", null],
  ])("does not attach Cider authority during create for %s", async (_label, selectedContext) => {
    const suffix = 10 + ["generic Beer", "other Beer subtype", "explicit pint", "explicit volume", "other category", "zero proof", "missing context"].indexOf(_label as string);
    expect(await create0186(suffix, selectedContext)).toEqual({ status: 200, body: "created" });
    expect(quotes0186(suffix)).toEqual([null, null]);
    expect(saved0186(suffix)[1]?.alternatives[0]).toEqual({ venueId: "venue-13xdb1p", venueName: "The Plough" });
  });

  it.each([
    ["pint", "pint"], ["PINT", "pint"], ["500ml", "500ml"], ["500 ml", "500ml"], ["500 ml glass", "500ml"],
  ])("matches source-stated serving alias %s without scaling a price", async (sourceServing, chosenServing) => {
    // Serving-only controlled SQL fixtures, not claims about the Plough's
    // real menu. Its actual captured Aspall row above remains serving:null.
    const value = { ...cider, serving: sourceServing };
    for (const position of [0, 1]) {
      const filtered = await rpc("plan_stop_evidence_for_context", {
        p_stop: route(value)[position], p_context: { ...ciderContext, drinkServing: chosenServing },
      });
      expect(filtered).toEqual({ status: 200, body: route(value)[position] });
      const mismatch = await rpc("plan_stop_evidence_for_context", {
        p_stop: route(value)[position], p_context: { ...ciderContext, drinkServing: chosenServing === "pint" ? "500ml" : "pint" },
      });
      expect(mismatch).toEqual({ status: 200, body: route(null)[position] });
    }
  });

  it.each([
    ["generic Beer", { drinkCategory: "beer" }],
    ["other Beer subtype", { drinkCategory: "beer", drinkSubtype: "beer-stout" }],
    ["pint with unknown source measure", { ...ciderContext, drinkServing: "pint" }],
    ["volume with unknown source measure", { ...ciderContext, drinkServing: "500ml" }],
    ["missing current context", null],
  ])("shared context RPC clears primary and backup Cider for %s independently of the table CHECK", async (_label, selectedContext) => {
    for (const position of [0, 1]) {
      expect(await rpc("plan_stop_evidence_for_context", { p_stop: route()[position], p_context: selectedContext }))
        .toEqual({ status: 200, body: route(null)[position] });
    }
  });

  it.each([
    ["another measure", wine, { drinkCategory: "wine", drinkServing: "175ml" }, false],
    ["its own measure", wine, { drinkCategory: "wine", drinkServing: "125ml" }, true],
    ["an unnamed quote under a subtype", wine, { drinkCategory: "wine", drinkSubtype: "wine-white" }, false],
    ["named White under White", { ...wine, drinkLabel: "Chardonnay", drinkSubtype: "wine-white" },
      { drinkCategory: "wine", drinkSubtype: "wine-white", drinkServing: "125ml" }, true],
    ["named White under Red", { ...wine, drinkLabel: "Chardonnay", drinkSubtype: "wine-white" },
      { drinkCategory: "wine", drinkSubtype: "wine-red" }, false],
    ["a community quote under a measure", { category: "wine", pence: 550, serving: null, source: "community",
      reportedAt: wine.observedAt }, { drinkCategory: "wine", drinkServing: "125ml" }, false],
  ])("shared context RPC keeps non-Cider evidence only under its named subtype and measure: %s", async (_label, value, selectedContext, kept) => {
    for (const position of [0, 1]) {
      expect(await rpc("plan_stop_evidence_for_context", { p_stop: route(value)[position], p_context: selectedContext }))
        .toEqual({ status: 200, body: route(kept ? value : null)[position] });
    }
  });

  it("keeps legacy six-key Beer, community five-key Beer and malformed named Beer outside the CHECK", async () => {
    expect(await create0186(20, null, route(null))).toEqual({ status: 200, body: "created" });
    const legacyBeer = { category: "beer", pence: 365, serving: null, source: "listed",
      sourceUrl: cider.sourceUrl, observedAt: cider.observedAt };
    const invalid = [legacyBeer,
      { category: "beer", pence: 365, serving: null, source: "community", reportedAt: cider.observedAt },
      { ...cider, drinkSubtype: "beer-ipa" }, { ...cider, drinkSubtype: null },
      { ...cider, drinkLabel: "" }, { ...cider, extra: "private" },
    ];
    for (const value of invalid) {
      const response = await fetch(`${session0186().restBaseUrl}/plan_stops?plan_id=eq.${id(1, 20)}&position=eq.0`, {
        method: "PATCH", headers: { authorization: `Bearer ${session0186().serviceRoleKey}`, "content-type": "application/json" },
        body: JSON.stringify({ selected_drink_price_evidence: value }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "23514" });
      expect(quotes0186(20)).toEqual([null, null]);
    }
  });

  it.each([
    ["category", { drinkCategory: "wine" }], ["generic Beer", { drinkCategory: "beer" }],
    ["subtype", { drinkCategory: "beer", drinkSubtype: "beer-ipa" }],
    ["serving", { ...ciderContext, drinkServing: "pint" }], ["zero proof", { ...ciderContext, zeroProof: true }],
  ])("context PATCH removes incompatible primary and backup identity after %s changes", async (_label, selectedContext) => {
    const suffix = 30 + ["category", "generic Beer", "subtype", "serving", "zero proof"].indexOf(_label as string);
    expect(await create0186(suffix)).toEqual({ status: 200, body: "created" });
    expect(await patchContext(suffix, ciderContext)).toEqual({ status: 200, body: "ok" });
    expect(quotes0186(suffix)).toEqual([cider, cider]);
    expect(await patchContext(suffix, selectedContext, "wrong-token")).toEqual({ status: 200, body: "forbidden" });
    expect(quotes0186(suffix)).toEqual([cider, cider]);
    expect(await patchContext(suffix, selectedContext)).toEqual({ status: 200, body: "ok" });
    expect(quotes0186(suffix)).toEqual([null, null]);
    expect(saved0186(suffix)[1]?.alternatives[0]).toEqual({ venueId: "venue-13xdb1p", venueName: "The Plough" });
    expect(await create0186(suffix)).toEqual({ status: 200, body: "replayed" });
    expect(quotes0186(suffix)).toEqual([null, null]);
    expect(JSON.parse(sql0186(`select night_context::text from public.plans where id='${id(1, suffix)}'`))).toEqual(selectedContext);
    expect(sql0186(`select route_revision::text from public.plans where id='${id(1, suffix)}'`)).toBe("1");
  });

  it.each([
    ["generic Beer", { drinkCategory: "beer" }],
    ["subtype", { drinkCategory: "beer", drinkSubtype: "beer-ipa" }],
    ["measure", { ...ciderContext, drinkServing: "500ml" }],
  ])("context PATCH invalidates the saved Cider backup for %s even before primary CHECK admission", async (_label, selectedContext) => {
    const suffix = 60 + ["generic Beer", "subtype", "measure"].indexOf(_label as string);
    const backupOnly = route().map((stop, position) => position === 0 ? route(null)[0] : stop);
    expect(await create0186(suffix, ciderContext, backupOnly)).toEqual({ status: 200, body: "created" });
    expect(quotes0186(suffix)).toEqual([null, cider]);
    expect(await patchContext(suffix, selectedContext)).toEqual({ status: 200, body: "ok" });
    expect(quotes0186(suffix)).toEqual([null, null]);
    expect(saved0186(suffix)[1]?.alternatives[0]).toEqual({ venueId: "venue-13xdb1p", venueName: "The Plough" });
  });

  it("replacement retains Cider and keeps host, revision and grounded-anchor gates", async () => {
    expect(await create0186(40, ciderContext, route(null))).toEqual({ status: 200, body: "created" });
    expect(await replace0186(40, route(), 1, "wrong-token")).toEqual({ status: 200, body: "forbidden" });
    expect(await replace0186(40, route(), 2)).toEqual({ status: 200, body: "conflict" });
    expect(quotes0186(40)).toEqual([null, null]);
    sql0186(`update public.plans set anchor_venue_id='venue-13xdb1p',anchor_source='map-search',plan_outcome='anchor-only'
      where id='${id(1, 40)}'`);
    expect(await replace0186(40)).toEqual({ status: 200, body: "forbidden" });
    expect(quotes0186(40)).toEqual([null, null]);
    expect(await replace0186(40, route(), 1, host(40), true)).toEqual({ status: 200, body: "ok" });
    expect(quotes0186(40)).toEqual([cider, cider]);
    expect(await replace0186(40, route(null), 1, host(40), true)).toEqual({ status: 200, body: "conflict" });
    expect(quotes0186(40)).toEqual([cider, cider]);
    expect(sql0186(`select route_revision::text from public.plans where id='${id(1, 40)}'`)).toBe("2");
  });

  it("accepted proposal retains Cider only under current own context and preserves decision/revision capability", async () => {
    expect(await create0186(41, ciderContext, route(null))).toEqual({ status: 200, body: "created" });
    const proposed = route().map((stop, position) => ({ ...stop, position }));
    sql0186(`insert into public.plan_route_proposals
      (id,plan_id,proposed_by_member_id,expected_route_revision,stops,reason,idempotency_key,created_at)
      values('${id(3, 41)}','${id(1, 41)}','${id(2, 41)}',1,${literal(proposed)},'Cider route','cider-proposal-41',now())`);
    const decide = (token: string) => rpc("decide_plan_route_proposal_atomic", {
      p_plan_id: id(1, 41), p_proposal_id: id(3, 41), p_token_hash: token,
      p_decision: "accepted", p_idempotency_key: "cider-decision-41", p_decided_at: "2026-10-03T12:30:00Z",
    });
    expect(await decide("wrong-token")).toEqual({ status: 200, body: "forbidden" });
    expect(quotes0186(41)).toEqual([null, null]);
    sql0186(`update public.plans set route_revision=2 where id='${id(1, 41)}'`);
    expect(await decide(host(41))).toEqual({ status: 200, body: "conflict" });
    expect(quotes0186(41)).toEqual([null, null]);
    sql0186(`update public.plans set route_revision=1 where id='${id(1, 41)}'`);
    expect(await decide(host(41))).toEqual({ status: 200, body: "decided" });
    expect(quotes0186(41)).toEqual([cider, cider]);
    expect(await decide(host(41))).toEqual({ status: 200, body: "already_decided" });
    expect(quotes0186(41)).toEqual([cider, cider]);
    expect(sql0186(`select route_revision::text from public.plans where id='${id(1, 41)}'`)).toBe("2");
  });

  it("proposal acceptance and replacement cannot reattach an unknown-measure quote after a serving edit", async () => {
    expect(await create0186(42, { ...ciderContext, drinkServing: "pint" }, route(null))).toEqual({ status: 200, body: "created" });
    const proposed = route().map((stop, position) => ({ ...stop, position }));
    sql0186(`insert into public.plan_route_proposals
      (id,plan_id,proposed_by_member_id,expected_route_revision,stops,reason,idempotency_key,created_at)
      values('${id(3, 42)}','${id(1, 42)}','${id(2, 42)}',1,${literal(proposed)},'Prior quote','cider-proposal-42',now())`);
    expect(await rpc("decide_plan_route_proposal_atomic", {
      p_plan_id: id(1, 42), p_proposal_id: id(3, 42), p_token_hash: host(42), p_decision: "accepted",
      p_idempotency_key: "cider-decision-42", p_decided_at: "2026-10-03T12:30:00Z",
    })).toEqual({ status: 200, body: "decided" });
    expect(quotes0186(42)).toEqual([null, null]);
    expect(await replace0186(42, route(), 2)).toEqual({ status: 200, body: "ok" });
    expect(quotes0186(42)).toEqual([null, null]);
  });

  it("preserves non-Cider listed/manual evidence and the delegate's malformed-stop behavior", async () => {
    expect(await create0186(43, null, route(wine))).toEqual({ status: 200, body: "created" });
    expect(quotes0186(43)).toEqual([wine, wine]);
    expect(await create0186(44, { drinkCategory: "wine" }, route(wine))).toEqual({ status: 200, body: "created" });
    expect(quotes0186(44)).toEqual([wine, wine]);
    // Create retains its old non-Cider persistence semantics. The existing
    // category/zero-proof invalidation remains at PATCH/replacement/proposal.
    expect(await create0186(63, ciderContext, route(wine))).toEqual({ status: 200, body: "created" });
    expect(quotes0186(63)).toEqual([wine, wine]);
    const beerBackups = [
      { venueId: "venue-13xdb1p", venueName: "The Plough", selectedDrinkPriceEvidence: {
        category: "beer", pence: 365, serving: null, source: "listed",
        sourceUrl: cider.sourceUrl, observedAt: cider.observedAt,
      } },
      { venueId: "venue-13xdb1p", venueName: "The Plough", selectedDrinkPriceEvidence: {
        category: "beer", pence: 365, serving: null, source: "community", reportedAt: cider.observedAt,
      } },
    ];
    const siblingBackups = route(wine).map((stop, position) => position === 1 ? { ...stop, alternatives: beerBackups } : stop);
    expect(await create0186(64, { drinkCategory: "wine" }, siblingBackups)).toEqual({ status: 200, body: "created" });
    expect(saved0186(64)[1]?.alternatives).toEqual(beerBackups);
    expect(await create0186(45, null, [])).toEqual({ status: 200, body: "created" });
    expect(await create0186(46, ciderContext, null)).toEqual({ status: 200, body: "created" });
    for (const [suffix, malformed] of [[47, {}], [48, [{}]]] as const) {
      const response = await create0186(suffix, ciderContext, malformed);
      expect(response.status).toBe(400);
      expect(sql0186(`select count(*)::text from public.plans where id='${id(1, suffix)}'`)).toBe("0");
    }
  });

  it("does not widen helper/RPC browser grants or the post-0172 catalog access", async () => {
    expect(access0186()).toBe(priorAccess);
    for (const signature of ["plan_stop_evidence_for_context(jsonb,jsonb)",
      "create_plan_with_context_idempotent_atomic(uuid,text,timestamptz,jsonb,uuid,text,text,timestamptz,text,text,text,text,text,jsonb)"]) {
      expect(sql0186(`select has_function_privilege('anon','public.${signature}','execute')::text || ':' ||
        has_function_privilege('authenticated','public.${signature}','execute')::text || ':' ||
        has_function_privilege('service_role','public.${signature}','execute')::text`)).toBe("false:false:true");
    }
    const before = sql0186("select count(*)::text from public.plans");
    const denied = await fetch(`${session0186().restBaseUrl}/rpc/plan_stop_evidence_for_context`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ p_stop: route()[0], p_context: ciderContext }),
    });
    expect([401, 404]).toContain(denied.status);
    expect(await denied.text()).not.toContain(cider.drinkLabel);
    expect(sql0186("select count(*)::text from public.plans")).toBe(before);
  });

  it("keeps completion identity immutable and refuses rollback while active Cider rows remain", async () => {
    expect(await create0186(50)).toEqual({ status: 200, body: "created" });
    sql0186(`insert into public.plan_actions(id,plan_id,actor_member_id,type,stop_position,created_at)
      values('${id(3, 50)}','${id(1, 50)}','${id(2, 50)}','arrived',0,'2026-10-03T12:10:00Z')`);
    expect(await rpc("complete_plan_atomic", {
      p_plan_id: id(1, 50), p_token_hash: host(50), p_expected_route_revision: 1,
      p_completion_id: id(4, 50), p_action_id: id(5, 50), p_ending: "get_home", p_terminal_venue_id: null,
      p_ending_selection: { kind: "get_home", optionId: "transport:nearest-station", evidenceSnapshot: { label: "Station" } },
      p_completed_at: "2026-10-03T13:00:00Z",
    })).toEqual({ status: 200, body: "completed" });
    const snapshot = sql0186(`select route_snapshot::text from public.plan_completions where plan_id='${id(1, 50)}'`);
    expect(JSON.parse(snapshot)[0].selectedDrinkPriceEvidence).toEqual(cider);
    const read = await fetch(`${session0186().restBaseUrl}/plan_completions?plan_id=eq.${id(1, 50)}&select=route_snapshot`, {
      headers: { authorization: `Bearer ${session0186().serviceRoleKey}` },
    });
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual([{ route_snapshot: JSON.parse(snapshot) }]);
    expect(await patchContext(50, { drinkCategory: "wine" })).toEqual({ status: 200, body: "ok" });
    expect(quotes0186(50)).toEqual([null, null]);
    expect(sql0186(`select route_snapshot::text from public.plan_completions where plan_id='${id(1, 50)}'`)).toBe(snapshot);
    expect(await replace0186(50, route(), 1)).toEqual({ status: 200, body: "invalid" });
    expect(await create0186(51)).toEqual({ status: 200, body: "created" });
    const currentCatalog = catalog0186();
    expect(existsSync(undo)).toBe(true);
    expect(() => session0186().sqlFile(undo)).toThrow("Cider selected-price rows remain");
    expect(catalog0186()).toBe(currentCatalog);
    expect(quotes0186(51)).toEqual([cider, cider]);
    // Primary admission and backup retention are separate storage paths.
    // Remove only this disposable cluster's active primary Cider evidence;
    // the remaining backup must still prevent a lossy compatibility rollback.
    sql0186(`update public.plan_stops set selected_drink_price_evidence=null
      where selected_drink_price_evidence->>'category'='beer'`);
    expect(quotes0186(51)).toEqual([null, cider]);
    expect(() => session0186().sqlFile(undo)).toThrow("Cider selected-price rows remain");
    expect(catalog0186()).toBe(currentCatalog);
    expect(quotes0186(51)).toEqual([null, cider]);
    expect(sql0186(`select route_snapshot::text from public.plan_completions where plan_id='${id(1, 50)}'`)).toBe(snapshot);
    // Explicit downgrade of this throwaway fixture only. Rollback performs no
    // erasure; production rows require a separate captain data decision.
    sql0186(`update public.plan_stops set selected_drink_price_evidence=null
      where selected_drink_price_evidence->>'category'='beer';
      update public.plan_stops set alternatives=(select coalesce(jsonb_agg(case
        when item->'selectedDrinkPriceEvidence'->>'category'='beer' then item - 'selectedDrinkPriceEvidence' else item end),'[]'::jsonb)
        from jsonb_array_elements(alternatives) item)`);
    sql0186(`insert into public.plan_route_proposals
      (id,plan_id,proposed_by_member_id,expected_route_revision,stops,reason,idempotency_key,created_at)
      values('${id(3, 51)}','${id(1, 51)}','${id(2, 51)}',1,
        ${literal(route(null).map((stop, position) => ({ ...stop, position, ...(position === 0 ? { selectedDrinkPriceEvidence: cider } : {}) })))},
        'Pending Cider route','cider-proposal-51',now())`);
    expect(() => session0186().sqlFile(undo)).toThrow("Cider selected-price rows remain");
    expect(catalog0186()).toBe(currentCatalog);
    sql0186(`update public.plan_route_proposals set stops=${literal([route(null)[0], { ...route(null)[1],
      alternatives: [{ venueId: "venue-13xdb1p", venueName: "The Plough", selectedDrinkPriceEvidence: cider }] }]
      .map((stop, position) => ({ ...stop, position })))} where id='${id(3, 51)}'`);
    expect(() => session0186().sqlFile(undo)).toThrow("Cider selected-price rows remain");
    expect(catalog0186()).toBe(currentCatalog);
    sql0186(`update public.plan_route_proposals set status='rejected', decided_at=now() where id='${id(3, 51)}'`);
    session0186().sqlFile(undo);
    expect(catalog0186()).toBe(priorCatalog);
    expect(access0186()).toBe(priorAccess);
    expect(sql0186(`select route_snapshot::text from public.plan_completions where plan_id='${id(1, 50)}'`)).toBe(snapshot);
  });
});
