import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const skipReason = postgresSkipReason();
const migrations = join(process.cwd(), "supabase/migrations");
const requiredMigrationNames = [
  "20261001073000_0176_plan_listed_drink_evidence.sql",
  "20261001073100_0177_plan_manual_selected_evidence.sql",
  "20261001090000_0178_plan_route_alternatives.sql",
  "20261001091000_0179_plan_backup_context_evidence.sql",
  "20261001092000_0180_completion_group_snapshot.sql",
  "20261001092100_0181_social_crew_completion.sql",
  "20261001092200_0182_completion_group_active_accounts.sql",
  "20261002110000_0183_plan_saved_stop_counts.sql",
] as const;
const requiredRollbackNames = [
  "rollback/20261002110000_0183_plan_saved_stop_counts_rollback.sql",
  "rollback/20261001092200_0182_completion_group_active_accounts_rollback.sql",
  "rollback/20261001092100_0181_social_crew_completion_rollback.sql",
  "rollback/20261001092000_0180_completion_group_snapshot_rollback.sql",
  "rollback/20261001091000_0179_plan_backup_context_evidence_rollback.sql",
  "rollback/20261001090000_0178_plan_route_alternatives_rollback.sql",
] as const;
function requiredFile(name: string): string {
  const path = join(migrations, name);
  if (!existsSync(path)) throw new Error(`Required Plan backup migration is missing: ${name}`);
  return path;
}
const forwardPaths = requiredMigrationNames.map(requiredFile);
const rollbackPaths = requiredRollbackNames.map(requiredFile);
const listedMigrationName = requiredMigrationNames[0];
const prerequisites = readdirSync(migrations)
  .filter((entry) => entry.endsWith(".sql") && entry < listedMigrationName)
  .sort()
  .map((entry) => join(migrations, entry));

const listed = {
  category: "wine", pence: 625, serving: "125ml", source: "listed",
  sourceUrl: "https://example.org/approved-menu", observedAt: "2026-07-23T10:40:17.846Z",
};
const community = {
  category: "wine", pence: 575, serving: null, source: "community",
  reportedAt: "2026-07-23T11:00:00.000Z",
};
const listedBackup = {
  venueId: "venue-d", venueName: "Canonical d", selectedDrinkPriceEvidence: listed,
};
const communityBackup = {
  venueId: "venue-e", venueName: "Canonical e", selectedDrinkPriceEvidence: community,
};
const routeWithEvidence = [
  { venueId: "venue-a", venueName: "A", alternatives: [listedBackup] },
  { venueId: "venue-b", venueName: "B", selectedDrinkPriceEvidence: listed, alternatives: [communityBackup] },
  { venueId: "venue-c", venueName: "C", alternatives: [] },
];
const emptyRoute = [
  { venueId: "venue-a", venueName: "A", alternatives: [] },
  { venueId: "venue-b", venueName: "B", alternatives: [] },
  { venueId: "venue-c", venueName: "C", alternatives: [] },
];
let session: PostgresSession | null = null;
let surfaceBeforeBackupMigrations = "";
let surfaceBeforeStopCountMigration = "";

function db(): PostgresSession {
  if (!session) throw new Error("PostgreSQL session unavailable");
  return session;
}
function planId(suffix: string): string { return `10000000-0000-4000-8000-00000000000${suffix}`; }
function memberId(suffix: string): string { return `20000000-0000-4000-8000-00000000000${suffix}`; }
function proposalId(suffix: string): string { return `30000000-0000-4000-8000-00000000000${suffix}`; }
function token(suffix: string): string { return suffix.repeat(64); }
function json(value: unknown): string { return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`; }

function create(suffix: string, stops: unknown[] = routeWithEvidence): string {
  return db().sql(`select public.create_plan_idempotent_atomic(
    '${planId(suffix)}'::uuid, 'Backup route', '2026-07-24T19:00:00Z', ${json(stops)},
    '${memberId(suffix)}'::uuid, 'Host', '${token(suffix)}', '2026-07-24T12:00:00Z',
    '${token(suffix)}', '${token(suffix)}', null, null, null)`);
}
function replace(suffix: string, stops: unknown[], context = "null", revision = 1): string {
  return db().sql(`select public.replace_plan_route_atomic(
    '${planId(suffix)}'::uuid, '${token(suffix)}', ${revision}, ${json(stops)}, ${context}, false)`);
}
function decide(suffix: string): string {
  return db().sql(`select public.decide_plan_route_proposal_atomic(
    '${planId(suffix)}'::uuid, '${proposalId(suffix)}'::uuid, '${token(suffix)}',
    'accepted', 'decision-${suffix}', '2026-07-24T12:30:00Z')`);
}
function updateContext(suffix: string, context: unknown): string {
  return db().sql(`select public.update_legacy_plan_status_context_atomic(
    '${planId(suffix)}'::uuid, '${token(suffix)}', null, ${json(context)})`);
}
function storedAlternatives(suffix: string, position: number): unknown {
  return JSON.parse(db().sql(`select alternatives::text from public.plan_stops
    where plan_id = '${planId(suffix)}' and position = ${position}`));
}
function primaryIsSqlNull(suffix: string, position: number): boolean {
  return db().sql(`select (selected_drink_price_evidence is null)::text from public.plan_stops
    where plan_id = '${planId(suffix)}' and position = ${position}`) === "true";
}
function primary(suffix: string, position: number): unknown {
  return JSON.parse(db().sql(`select coalesce(selected_drink_price_evidence, 'null'::jsonb)::text
    from public.plan_stops where plan_id = '${planId(suffix)}' and position = ${position}`));
}
function routeRevision(suffix: string): string {
  return db().sql(`select route_revision::text from public.plans where id = '${planId(suffix)}'`);
}
function savedContext(suffix: string): unknown {
  return JSON.parse(db().sql(`select coalesce(night_context, 'null'::jsonb)::text
    from public.plans where id = '${planId(suffix)}'`));
}
function functionSurface(): string {
  return db().sql(`select jsonb_build_object(
    'definitions', jsonb_build_array(
      pg_get_functiondef('public.create_plan_idempotent_atomic(uuid,text,timestamptz,jsonb,uuid,text,text,timestamptz,text,text,text,text,text)'::regprocedure),
      pg_get_functiondef('public.replace_plan_route_atomic(uuid,text,integer,jsonb,jsonb,boolean)'::regprocedure),
      pg_get_functiondef('public.decide_plan_route_proposal_atomic(uuid,uuid,text,text,text,timestamptz)'::regprocedure),
      pg_get_functiondef('public.update_legacy_plan_status_context_atomic(uuid,text,text,jsonb)'::regprocedure)
    ),
    'acls', jsonb_build_array(
      (select coalesce(proacl::text, '<default>') from pg_proc where oid = 'public.create_plan_idempotent_atomic(uuid,text,timestamptz,jsonb,uuid,text,text,timestamptz,text,text,text,text,text)'::regprocedure),
      (select coalesce(proacl::text, '<default>') from pg_proc where oid = 'public.replace_plan_route_atomic(uuid,text,integer,jsonb,jsonb,boolean)'::regprocedure),
      (select coalesce(proacl::text, '<default>') from pg_proc where oid = 'public.decide_plan_route_proposal_atomic(uuid,uuid,text,text,text,timestamptz)'::regprocedure),
      (select coalesce(proacl::text, '<default>') from pg_proc where oid = 'public.update_legacy_plan_status_context_atomic(uuid,text,text,jsonb)'::regprocedure)
    ),
    'tableGrants', coalesce((select jsonb_agg(jsonb_build_array(grantee, privilege_type, is_grantable)
      order by grantee, privilege_type) from information_schema.role_table_grants
      where table_schema = 'public' and table_name = 'plan_stops'), '[]'::jsonb),
    'stopPolicies', coalesce((select jsonb_agg(jsonb_build_array(policyname, cmd, roles, qual, with_check)
      order by policyname) from pg_policies where schemaname = 'public' and tablename = 'plan_stops'), '[]'::jsonb),
    'stopConstraints', coalesce((select jsonb_agg(jsonb_build_array(conname, pg_get_constraintdef(oid))
      order by conname) from pg_constraint where conrelid = 'public.plan_stops'::regclass), '[]'::jsonb)
  )::text`);
}
function alternativeColumnExists(): boolean {
  return db().sql(`select count(*)::text from information_schema.columns
    where table_schema = 'public' and table_name = 'plan_stops' and column_name = 'alternatives'`) === "1";
}
function functionPrivileges(signature: string): string {
  return db().sql(`select has_function_privilege('anon','${signature}','execute')::text || ':' ||
    has_function_privilege('authenticated','${signature}','execute')::text || ':' ||
    has_function_privilege('service_role','${signature}','execute')::text`);
}
function authenticatedStatements(userId: string, statement: string): string {
  return `begin;
    set local request.jwt.claims = '{"sub":"${userId}","role":"authenticated"}';
    set local role authenticated;
    ${statement};
    commit;`;
}

beforeAll(async () => {
  if (skipReason) return;
  session = await startPostgres({ label: "plan-backup-fullchain", database: "pubmax_plan_backup_fullchain" });
  try {
    db().applyFile(join(process.cwd(), "scripts/rls/session-fixture.sql"));
    for (const path of prerequisites) db().applyFile(path);
    db().applyFile(forwardPaths[0]);
    db().applyFile(forwardPaths[1]);
    surfaceBeforeBackupMigrations = functionSurface();
    for (const path of forwardPaths.slice(2)) {
      if (path.endsWith("_0183_plan_saved_stop_counts.sql")) surfaceBeforeStopCountMigration = functionSurface();
      db().applyFile(path);
    }
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

describe.skipIf(skipReason !== null)("Plan backup evidence through migrations 0176-0183", () => {
  it.each([1, 2])("replaces a saved route with %i stops without changing host or revision gates", (count) => {
    const suffix = String(count + 3);
    const stops = routeWithEvidence.slice(0, count);
    expect(create(suffix, emptyRoute)).toBe("created");
    expect(db().sql(`select public.replace_plan_route_atomic(
      '${planId(suffix)}'::uuid, '${token("f")}', 1, ${json(stops)}, null, false)`))
      .toBe("forbidden");
    expect(routeRevision(suffix)).toBe("1");
    expect(replace(suffix, stops, json({ drinkCategory: "wine" }))).toBe("ok");
    expect(routeRevision(suffix)).toBe("2");
    expect(savedContext(suffix)).toEqual({ drinkCategory: "wine" });
    const saved = db().sql(`select jsonb_agg(jsonb_build_object('venueId', venue_id,
      'position', position, 'primary', selected_drink_price_evidence, 'alternatives', alternatives)
      order by position)::text from public.plan_stops where plan_id = '${planId(suffix)}'`);
    expect(JSON.parse(saved)).toEqual(stops.map((stop, position) => ({
      venueId: stop.venueId, position,
      primary: "selectedDrinkPriceEvidence" in stop ? stop.selectedDrinkPriceEvidence : null,
      alternatives: stop.alternatives,
    })));
    expect(replace(suffix, emptyRoute)).toBe("conflict");
    const oversized = Array.from({ length: 7 }, (_, position) => ({
      venueId: `venue-${position}`, venueName: `Venue ${position}`,
    }));
    for (const invalidStops of [[], oversized]) {
      expect(replace(suffix, invalidStops, "null", 2)).toBe("invalid");
    }
    expect(routeRevision(suffix)).toBe("2");
    expect(db().sql(`select jsonb_agg(jsonb_build_object('venueId', venue_id,
      'position', position, 'primary', selected_drink_price_evidence, 'alternatives', alternatives)
      order by position)::text from public.plan_stops where plan_id = '${planId(suffix)}'`)).toBe(saved);
  });

  it.each([1, 2])("accepts and replays a %i-stop proposal while retaining its evidence", (count) => {
    const suffix = String(count + 5);
    const stops = routeWithEvidence.slice(0, count).map((stop, position) => ({ ...stop, position }));
    expect(create(suffix, emptyRoute)).toBe("created");
    db().sql(`insert into public.plan_route_proposals
      (id, plan_id, proposed_by_member_id, expected_route_revision, stops, reason,
       resolved_constraint_ids, unresolved_constraint_ids, status, idempotency_key, created_at)
      values ('${proposalId(suffix)}'::uuid, '${planId(suffix)}'::uuid, '${memberId(suffix)}'::uuid, 1,
        ${json(stops)}, 'Keep the shorter route', '[]'::jsonb, '[]'::jsonb, 'pending',
        'proposal-${suffix}', '2026-07-24T12:20:00Z')`);
    expect(db().sql(`select public.decide_plan_route_proposal_atomic(
      '${planId(suffix)}'::uuid, '${proposalId(suffix)}'::uuid, '${token("f")}',
      'accepted', 'decision-${suffix}', '2026-07-24T12:30:00Z')`)).toBe("forbidden");
    expect(routeRevision(suffix)).toBe("1");
    expect(decide(suffix)).toBe("decided");
    expect(decide(suffix)).toBe("already_decided");
    expect(routeRevision(suffix)).toBe("2");
    expect(JSON.parse(db().sql(`select jsonb_agg(jsonb_build_object('venueId', venue_id,
      'position', position, 'primary', selected_drink_price_evidence, 'alternatives', alternatives)
      order by position)::text from public.plan_stops where plan_id = '${planId(suffix)}'`)))
      .toEqual(stops.map((stop) => ({ venueId: stop.venueId, position: stop.position,
        primary: "selectedDrinkPriceEvidence" in stop ? stop.selectedDrinkPriceEvidence : null,
        alternatives: stop.alternatives })));
    expect(JSON.parse(db().sql(`select stops::text from public.plan_route_proposals
      where id = '${proposalId(suffix)}'`))).toEqual(stops);
  });

  it("reverses the short-stop RPC change without losing saved routes or changing permissions", () => {
    const surfaceAfterStopCountMigration = functionSurface();
    db().applyFile(rollbackPaths[0]);
    expect(functionSurface()).toBe(surfaceBeforeStopCountMigration);
    expect(replace("4", routeWithEvidence.slice(0, 1), "null", 2)).toBe("invalid");
    for (const [suffix, count] of [["4", 1], ["5", 2]] as const) {
      expect(routeRevision(suffix)).toBe("2");
      expect(db().sql(`select count(*)::text from public.plan_stops where plan_id = '${planId(suffix)}'`))
        .toBe(String(count));
      expect(storedAlternatives(suffix, 0)).toEqual([listedBackup]);
    }
    db().applyFile(forwardPaths.at(-1)!);
    expect(functionSurface()).toBe(surfaceAfterStopCountMigration);
  });

  it("stores, replays, replaces, accepts, filters, authorizes, and restores the backup RPC surface after reverse twins", () => {
    expect(alternativeColumnExists()).toBe(true);
    expect(db().sql(`select data_type || ':' || is_nullable from information_schema.columns
      where table_schema = 'public' and table_name = 'plan_stops' and column_name = 'alternatives'`))
      .toBe("jsonb:NO");
    expect(db().sql(`select pg_get_constraintdef(oid) from pg_constraint
      where conrelid = 'public.plan_stops'::regclass and conname = 'plan_stops_alternatives_bounded'`))
      .toContain("jsonb_array_length(alternatives) <= 24");
    expect(functionPrivileges("public.create_plan_idempotent_atomic(uuid,text,timestamptz,jsonb,uuid,text,text,timestamptz,text,text,text,text,text)"))
      .toBe("false:false:true");
    expect(functionPrivileges("public.replace_plan_route_atomic(uuid,text,integer,jsonb,jsonb,boolean)"))
      .toBe("false:false:true");
    expect(functionPrivileges("public.decide_plan_route_proposal_atomic(uuid,uuid,text,text,text,timestamptz)"))
      .toBe("false:false:true");
    expect(functionPrivileges("public.update_legacy_plan_status_context_atomic(uuid,text,text,jsonb)"))
      .toBe("false:false:true");
    expect(functionPrivileges("public.plan_stop_evidence_for_context(jsonb,jsonb)"))
      .toBe("false:false:true");
    expect(db().sql(`select has_column_privilege('anon','public.plan_stops','alternatives','select')::text || ':' ||
      has_column_privilege('authenticated','public.plan_stops','alternatives','select')::text || ':' ||
      has_column_privilege('authenticated','public.plan_stops','alternatives','update')::text || ':' ||
      has_column_privilege('service_role','public.plan_stops','alternatives','update')::text`)).toBe("false:true:false:true");

    expect(create("1")).toBe("created");
    expect(create("1")).toBe("replayed");
    expect(db().sql(`select count(*)::text from public.plan_stops where plan_id = '${planId("1")}'`)).toBe("3");
    expect(db().sql(`select (night_context is null)::text from public.plans where id = '${planId("1")}'`)).toBe("true");
    expect(primaryIsSqlNull("1", 0)).toBe(true);
    expect(primary("1", 1)).toEqual(listed);
    expect(storedAlternatives("1", 0)).toEqual([listedBackup]);
    expect(storedAlternatives("1", 1)).toEqual([communityBackup]);

    // This local role/JWT fixture exercises migrated SQL grants and RLS, not PostgREST.
    const linkedUser = memberId("1");
    const ownerUser = "90000000-0000-4000-8000-000000000001";
    db().sql(`insert into auth.users (id) values ('${linkedUser}'::uuid), ('${ownerUser}'::uuid);
      update public.plan_crew_members set user_id = '${linkedUser}'::uuid
      where id = '${linkedUser}'::uuid and plan_id = '${planId("1")}'::uuid;
      update public.plans set owner_user_id = '${ownerUser}'::uuid where id = '${planId("1")}'::uuid`);
    expect(JSON.parse(db().sql(authenticatedStatements(linkedUser,
      `select alternatives::text from public.plan_stops where plan_id = '${planId("1")}' and position = 0`))))
      .toEqual([listedBackup]);
    expect(JSON.parse(db().sql(authenticatedStatements(ownerUser,
      `select alternatives::text from public.plan_stops where plan_id = '${planId("1")}' and position = 0`))))
      .toEqual([listedBackup]);
    expect(db().sql(authenticatedStatements("20000000-0000-4000-8000-000000000099",
      `select count(*)::text from public.plan_stops where plan_id = '${planId("1")}'`))).toBe("0");
    expect(db().expectRefusal(`begin; set local role anon;
      select alternatives from public.plan_stops where plan_id = '${planId("1")}'; commit;`))
      .toContain("permission denied");

    expect(create("2", emptyRoute)).toBe("created");
    expect(replace("2", routeWithEvidence)).toBe("ok");
    expect(routeRevision("2")).toBe("2");
    expect(primaryIsSqlNull("2", 0)).toBe(true);
    expect(primary("2", 1)).toEqual(listed);
    expect(storedAlternatives("2", 0)).toEqual([listedBackup]);
    expect(storedAlternatives("2", 1)).toEqual([communityBackup]);
    const memberTwo = memberId("2");
    db().sql(`insert into auth.users (id) values ('${memberTwo}'::uuid);
      update public.plan_crew_members set user_id = '${memberTwo}'::uuid
      where id = '${memberTwo}'::uuid and plan_id = '${planId("2")}'::uuid`);
    expect(JSON.parse(db().sql(authenticatedStatements(memberTwo,
      `select alternatives::text from public.plan_stops where plan_id = '${planId("2")}' and position = 0`))))
      .toEqual([listedBackup]);
    expect(db().expectRefusal(authenticatedStatements(memberTwo,
      `update public.plan_stops set alternatives = '[]'::jsonb where plan_id = '${planId("2")}'`)))
      .toContain("permission denied");
    db().sql(`update public.plan_crew_members set membership_revoked_at = '2026-07-24T12:25:00Z'
      where id = '${memberTwo}'::uuid and plan_id = '${planId("2")}'::uuid`);
    expect(db().sql(authenticatedStatements(memberTwo,
      `select count(*)::text from public.plan_stops where plan_id = '${planId("2")}'`))).toBe("0");
    const replaced = db().sql(`select jsonb_agg(jsonb_build_object('venueId',venue_id,'primary',selected_drink_price_evidence,
      'alternatives',alternatives) order by position)::text from public.plan_stops where plan_id = '${planId("2")}'`);
    expect(replace("2", emptyRoute)).toBe("conflict");
    expect(db().sql(`select jsonb_agg(jsonb_build_object('venueId',venue_id,'primary',selected_drink_price_evidence,
      'alternatives',alternatives) order by position)::text from public.plan_stops where plan_id = '${planId("2")}'`))
      .toBe(replaced);
    const invalidPrimary = routeWithEvidence.map((stop, position) => position === 1
      ? { ...stop, selectedDrinkPriceEvidence: { ...listed, pence: 0 } }
      : stop);
    expect(db().expectRefusal(`select public.replace_plan_route_atomic(
      '${planId("2")}'::uuid, '${token("2")}', 2, ${json(invalidPrimary)}, null, false)`))
      .toContain("plan_stops_selected_drink_price_evidence_check");
    expect(routeRevision("2")).toBe("2");
    expect(db().sql(`select jsonb_agg(jsonb_build_object('venueId',venue_id,'primary',selected_drink_price_evidence,
      'alternatives',alternatives) order by position)::text from public.plan_stops where plan_id = '${planId("2")}'`))
      .toBe(replaced);

    expect(create("3", emptyRoute)).toBe("created");
    const proposalRoute = routeWithEvidence.map((stop, position) => ({ ...stop, position }));
    db().sql(`insert into public.plan_route_proposals
      (id, plan_id, proposed_by_member_id, expected_route_revision, stops, reason,
       resolved_constraint_ids, unresolved_constraint_ids, status, idempotency_key, created_at)
      values ('${proposalId("3")}'::uuid, '${planId("3")}'::uuid, '${memberId("3")}'::uuid, 1,
        ${json(proposalRoute)}, 'Retain verified backups', '[]'::jsonb, '[]'::jsonb, 'pending',
        'proposal-3', '2026-07-24T12:20:00Z')`);
    expect(decide("3")).toBe("decided");
    expect(decide("3")).toBe("already_decided");
    expect(routeRevision("3")).toBe("2");
    expect(storedAlternatives("3", 0)).toEqual([listedBackup]);
    expect(storedAlternatives("3", 1)).toEqual([communityBackup]);
    expect(JSON.parse(db().sql(`select stops::text from public.plan_route_proposals where id = '${proposalId("3")}'`)))
      .toEqual(proposalRoute);

    expect(updateContext("3", {})).toBe("ok");
    expect(savedContext("3")).toEqual({});
    expect(primaryIsSqlNull("3", 0)).toBe(true);
    expect(primaryIsSqlNull("3", 1)).toBe(true);
    expect(storedAlternatives("3", 0)).toEqual([{ venueId: "venue-d", venueName: "Canonical d" }]);
    expect(storedAlternatives("3", 1)).toEqual([{ venueId: "venue-e", venueName: "Canonical e" }]);
    expect(create("3", emptyRoute)).toBe("replayed");
    expect(storedAlternatives("3", 0)).toEqual([{ venueId: "venue-d", venueName: "Canonical d" }]);

    const oversized = Array.from({ length: 25 }, (_, index) => ({ venueId: `venue-${index}`, venueName: `Venue ${index}` }));
    for (const invalidAlternatives of [oversized, { venueId: "venue-d" }]) {
      expect(db().expectRefusal(`update public.plan_stops set alternatives = ${json(invalidAlternatives)}
        where plan_id = '${planId("2")}' and position = 0`)).toContain("plan_stops_alternatives_bounded");
      expect(db().sql(`select jsonb_agg(jsonb_build_object('venueId',venue_id,'primary',selected_drink_price_evidence,
        'alternatives',alternatives) order by position)::text from public.plan_stops where plan_id = '${planId("2")}'`))
        .toBe(replaced);
    }

    const listedSnapshot = primary("2", 1);
    for (const path of rollbackPaths) db().applyFile(path);
    expect(alternativeColumnExists()).toBe(false);
    expect(db().sql(`select count(*)::text from information_schema.columns
      where table_schema = 'public' and table_name = 'plan_stops' and column_name = 'selected_drink_price_evidence'`))
      .toBe("1");
    expect(db().sql(`select to_regprocedure('public.plan_stop_evidence_for_context(jsonb,jsonb)') is null`)).toBe("t");
    expect(functionSurface()).toBe(surfaceBeforeBackupMigrations);
    expect(primary("2", 1)).toEqual(listedSnapshot);
  });
});
