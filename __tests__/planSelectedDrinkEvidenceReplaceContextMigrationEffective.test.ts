import { readdirSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const skipReason = postgresSkipReason();
const migrations = join(process.cwd(), "supabase/migrations");
const name = "20260929180000_0167_plan_replace_context_evidence.sql";
const prerequisites = readdirSync(migrations)
  .filter((entry) => entry.endsWith(".sql") && entry < name)
  .sort()
  .map((entry) => join(migrations, entry));
const wine = { category: "wine", pence: 550, serving: null, source: "community", reportedAt: "2026-09-25T12:00:00.000Z" };
const stops = JSON.stringify([
  { venueId: "venue-a", venueName: "A" },
  { venueId: "venue-b", venueName: "B", selectedDrinkPriceEvidence: wine },
  { venueId: "venue-c", venueName: "C" },
]);

let session: PostgresSession | null = null;
function db(): PostgresSession {
  if (!session) throw new Error("PostgreSQL session unavailable");
  return session;
}
function planId(suffix: string): string {
  return `10000000-0000-4000-8000-00000000000${suffix}`;
}
function create(suffix: string, context: object | null = { drinkCategory: "wine", zeroProof: false }): void {
  const contextSql = context === null ? "null" : `'${JSON.stringify(context)}'::jsonb`;
  expect(db().sql(`select public.create_plan_with_context_idempotent_atomic(
    '${planId(suffix)}'::uuid, 'Wine', '2026-09-30T19:00:00Z',
    '[{"venueId":"venue-x","venueName":"X"},{"venueId":"venue-y","venueName":"Y"},{"venueId":"venue-z","venueName":"Z"}]'::jsonb,
    '20000000-0000-4000-8000-00000000000${suffix}'::uuid, 'Host', '${suffix.repeat(64)}',
    '2026-09-29T12:00:00Z', '${suffix.repeat(64)}', '${suffix.repeat(64)}', null, null, null,
    ${contextSql})`)).toBe("created");
}
function changeToBeer(suffix: string): void {
  expect(db().sql(`select public.update_legacy_plan_status_context_atomic(
    '${planId(suffix)}'::uuid, '${suffix.repeat(64)}', null,
    '{"drinkCategory":"beer","zeroProof":false}'::jsonb)`)).toBe("ok");
}
function replace(suffix: string, context = "null"): void {
  expect(db().sql(`select public.replace_plan_route_atomic(
    '${planId(suffix)}'::uuid, '${suffix.repeat(64)}', 1, '${stops}'::jsonb,
    ${context}, false)`)).toBe("ok");
}
function saved(suffix: string): unknown {
  return JSON.parse(db().sql(`select coalesce(selected_drink_price_evidence::text, 'null')
    from public.plan_stops where plan_id = '${planId(suffix)}' and position = 1`));
}

beforeAll(async () => {
  if (skipReason) return;
  session = await startPostgres({ label: "plan-evidence-replace-context-0167", database: "pubmax_plan_evidence_replace_context" });
  try {
    db().applyFile(join(process.cwd(), "scripts/rls/session-fixture.sql"));
    for (const path of prerequisites) db().applyFile(path);
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

describe.skipIf(skipReason !== null)("0167 replacement uses locked drink intent", () => {
  it("reproduces a stale wine replacement after a context-only beer edit", () => {
    create("1");
    changeToBeer("1");
    replace("1");
    expect(saved("1")).toEqual(wine);
  });

  it("drops stale evidence and retains matching evidence under effective context", () => {
    db().applyFile(join(migrations, name));
    expect(db().sql(`select has_function_privilege('anon',
      'public.replace_plan_route_atomic(uuid,text,integer,jsonb,jsonb,boolean)', 'execute')::text || ':' ||
      has_function_privilege('authenticated',
      'public.replace_plan_route_atomic(uuid,text,integer,jsonb,jsonb,boolean)', 'execute')::text || ':' ||
      has_function_privilege('service_role',
      'public.replace_plan_route_atomic(uuid,text,integer,jsonb,jsonb,boolean)', 'execute')::text`)).toBe("false:false:true");
    create("2");
    changeToBeer("2");
    replace("2");
    expect(saved("2")).toBeNull();

    create("3");
    replace("3");
    expect(saved("3")).toEqual(wine);

    create("4");
    replace("4", "'{\"drinkCategory\":\"beer\",\"zeroProof\":false}'::jsonb");
    expect(saved("4")).toBeNull();

    create("6");
    replace("6", "'{\"drinkCategory\":\"wine\",\"zeroProof\":true}'::jsonb");
    expect(saved("6")).toBeNull();
  });

  it("rollback restores prior writes without changing already saved evidence", () => {
    db().applyFile(join(migrations, "rollback/20260929180000_0167_plan_replace_context_evidence_rollback.sql"));
    create("5");
    changeToBeer("5");
    replace("5");
    expect(saved("5")).toEqual(wine);
    expect(saved("3")).toEqual(wine);
  });
});


describe.skipIf(skipReason !== null)("manual route replacement without a drink context", () => {
  beforeAll(() => {
    for (const entry of readdirSync(migrations).filter((entry) => entry.endsWith(".sql") && entry >= name).sort()) {
      db().applyFile(join(migrations, entry));
    }
  });

  function manualReplace(suffix: string, token = suffix.repeat(64), revision = 1, payload = stops, context = "null"): string {
    return db().sql(`select public.replace_plan_route_atomic(
      '${planId(suffix)}'::uuid, '${token}', ${revision}, '${payload}'::jsonb, ${context}, false)`);
  }
  function snapshot(suffix: string): string {
    return db().sql(`select jsonb_build_object('revision', route_revision, 'context', night_context,
      'stops', (select jsonb_agg(jsonb_build_object('venueId', venue_id, 'position', position,
        'evidence', selected_drink_price_evidence) order by position) from public.plan_stops
        where plan_id = '${planId(suffix)}'))::text from public.plans where id = '${planId(suffix)}'`);
  }

  it("retains a validated manual wine price when stored and requested contexts are SQL NULL", () => {
    create("9", null);
    expect(db().sql(`select (night_context is null)::text from public.plans where id = '${planId("9")}'`)).toBe("true");
    expect(manualReplace("9")).toBe("ok");
    expect(saved("9")).toEqual(wine);
    expect(db().sql(`select route_revision::text || ':' || (night_context is null)::text
      from public.plans where id = '${planId("9")}'`)).toBe("2:true");
    const after = snapshot("9");
    expect(manualReplace("9")).toBe("conflict");
    expect(snapshot("9")).toBe(after);
  });

  it.each([
    ["a", { drinkCategory: "beer", zeroProof: false }],
    ["b", { drinkCategory: "wine", zeroProof: true }],
    ["c", {}],
  ] as const)("still drops incompatible evidence when explicit context is supplied for %s", (suffix, context) => {
    create(suffix, null);
    expect(manualReplace(suffix, suffix.repeat(64), 1, stops, `'${JSON.stringify(context)}'::jsonb`)).toBe("ok");
    expect(saved(suffix)).toBeNull();
    expect(JSON.parse(db().sql(`select night_context::text from public.plans where id = '${planId(suffix)}'`))).toEqual(context);
  });

  it("refuses a real non-host member without changing route, evidence or revision", () => {
    create("d", null);
    const memberToken = "01".repeat(32);
    db().sql(`insert into public.plan_crew_members (id, plan_id, name, token_hash, joined_at, updated_at, can_collaborate)
      values ('40000000-0000-4000-8000-00000000000d','${planId("d")}','Guest','${memberToken}',
        '2026-09-30T12:00:00Z','2026-09-30T12:00:00Z',true)`);
    const before = snapshot("d");
    expect(manualReplace("d", memberToken)).toBe("forbidden");
    expect(snapshot("d")).toBe(before);
  });

  it("refuses a stale route revision before any manual evidence write", () => {
    create("e", null);
    const before = snapshot("e");
    expect(manualReplace("e", "e".repeat(64), 2)).toBe("conflict");
    expect(snapshot("e")).toBe(before);
  });

  it("rolls back the whole replacement when absent-context evidence fails the existing storage CHECK", () => {
    create("f", null);
    const before = snapshot("f");
    const invalid = JSON.stringify([
      { venueId: "venue-a", venueName: "A" },
      { venueId: "venue-b", venueName: "B", selectedDrinkPriceEvidence: { ...wine, pence: 0 } },
      { venueId: "venue-c", venueName: "C" },
    ]);
    expect(db().expectRefusal(`select public.replace_plan_route_atomic(
      '${planId("f")}'::uuid, '${"f".repeat(64)}', 1, '${invalid}'::jsonb, null, false)`))
      .toContain("plan_stops_selected_drink_price_evidence_check");
    expect(snapshot("f")).toBe(before);
  });

  it("keeps replacement execution service-only", () => {
    expect(db().sql(`select has_function_privilege('anon',
      'public.replace_plan_route_atomic(uuid,text,integer,jsonb,jsonb,boolean)', 'execute')::text || ':' ||
      has_function_privilege('authenticated',
      'public.replace_plan_route_atomic(uuid,text,integer,jsonb,jsonb,boolean)', 'execute')::text || ':' ||
      has_function_privilege('service_role',
      'public.replace_plan_route_atomic(uuid,text,integer,jsonb,jsonb,boolean)', 'execute')::text`)).toBe("false:false:true");
  });

  it("keeps an exact listed citation and community quote in a NULL-context manual replacement", () => {
    create("0", null);
    const listed = { category: "wine", pence: 525, serving: "125ml", source: "listed",
      sourceUrl: "https://example.org/menu", observedAt: "2026-09-29T10:40:17.846Z" };
    const payload = JSON.stringify([
      { venueId: "venue-a", venueName: "A", selectedDrinkPriceEvidence: listed },
      { venueId: "venue-b", venueName: "B", selectedDrinkPriceEvidence: wine },
      { venueId: "venue-c", venueName: "C" },
    ]);
    expect(manualReplace("0", "0".repeat(64), 1, payload)).toBe("ok");
    expect(JSON.parse(snapshot("0"))).toEqual({ revision: 2, context: null, stops: [
      { venueId: "venue-a", position: 0, evidence: listed },
      { venueId: "venue-b", position: 1, evidence: wine },
      { venueId: "venue-c", position: 2, evidence: null },
    ] });
  });

  it("0177 rollback restores exact predecessor RPCs and old NULL behavior without erasing saved quotes", () => {
    const definitions = (): string => db().sql(`select jsonb_build_array(
      pg_get_functiondef('public.replace_plan_route_atomic(uuid,text,integer,jsonb,jsonb,boolean)'::regprocedure),
      pg_get_functiondef('public.decide_plan_route_proposal_atomic(uuid,uuid,text,text,text,timestamptz)'::regprocedure),
      (select proacl::text from pg_proc where oid = 'public.replace_plan_route_atomic(uuid,text,integer,jsonb,jsonb,boolean)'::regprocedure),
      (select proacl::text from pg_proc where oid = 'public.decide_plan_route_proposal_atomic(uuid,uuid,text,text,text,timestamptz)'::regprocedure)
    )::text`);
    const retained = [snapshot("0"), snapshot("9")];
    db().applyFile(join(migrations, name));
    db().applyFile(join(migrations, "20260930120000_0168_plan_proposal_context_evidence.sql"));
    const predecessor = definitions();
    db().applyFile(join(migrations, "20261001073100_0177_plan_manual_selected_evidence.sql"));
    const forwardDefinition = definitions();
    expect(forwardDefinition).not.toBe(predecessor);
    db().applyFile(join(migrations, "rollback/20261001073100_0177_plan_manual_selected_evidence_rollback.sql"));
    expect(definitions()).toBe(predecessor);
    create("7", null);
    expect(manualReplace("7")).toBe("ok");
    expect(saved("7")).toBeNull();
    expect([snapshot("0"), snapshot("9")]).toEqual(retained);
    db().applyFile(join(migrations, "20261001073100_0177_plan_manual_selected_evidence.sql"));
    expect(definitions()).toBe(forwardDefinition);
    create("8", null);
    expect(manualReplace("8")).toBe("ok");
    expect(saved("8")).toEqual(wine);
  });

});
