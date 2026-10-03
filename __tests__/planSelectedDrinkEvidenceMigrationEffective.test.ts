import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const skipReason = postgresSkipReason();
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

  it("captures saved named identity in completion and refuses rollback without data loss", () => {
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
    namedDb().applyFileTransactional(undo);
    expect(checkDefinition()).toBe(oldCheck);
    expect(access()).toBe(oldAccess);
    expect(namedDb().expectRefusal(write(named))).toContain("plan_stops_selected_drink_price_evidence_check");
    expect(namedDb().sql(`select route_snapshot::text from public.plan_completions where plan_id = '${plan("1")}'`)).toBe(snapshot);
  });
});
