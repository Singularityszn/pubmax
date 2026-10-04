import { readdirSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const skipReason = postgresSkipReason();
const migrations = join(process.cwd(), "supabase/migrations");
const name = "20260929130000_0162_plan_create_selected_drink_evidence.sql";
const forward = join(migrations, name);
const rollback = join(migrations, "rollback/20260929130000_0162_plan_create_selected_drink_evidence_rollback.sql");
const prerequisites = readdirSync(migrations)
  .filter((entry) => entry.endsWith(".sql") && entry < name)
  .sort()
  .map((entry) => join(migrations, entry));
const wine = { category: "wine", pence: 550, serving: null, source: "community", reportedAt: "2026-09-25T12:00:00.000Z" };
const cocktail = { category: "cocktail", pence: 850, serving: null, source: "community", reportedAt: "2026-09-26T12:00:00.000Z" };
const stops = JSON.stringify([
  { venueId: "venue-a", venueName: "A", selectedDrinkPriceEvidence: wine },
  { venueId: "venue-b", venueName: "B", selectedDrinkPriceEvidence: cocktail },
  { venueId: "venue-c", venueName: "C" },
]);

let session: PostgresSession | null = null;
let executeGrantsBefore = "";

function db(): PostgresSession {
  if (!session) throw new Error("PostgreSQL session unavailable");
  return session;
}

function create(suffix: string): string {
  return db().sql(`select public.create_plan_idempotent_atomic(
    '10000000-0000-4000-8000-00000000000${suffix}'::uuid,
    'Wine and cocktails', '2026-09-30T19:00:00Z', '${stops}'::jsonb,
    '20000000-0000-4000-8000-00000000000${suffix}'::uuid,
    'Host', '${suffix.repeat(64)}', '2026-09-29T12:00:00Z',
    '${suffix.repeat(64)}', '${suffix.repeat(64)}', null, null, null)`);
}

function createWithContext(suffix: string): string {
  return db().sql(`select public.create_plan_with_context_idempotent_atomic(
    '10000000-0000-4000-8000-00000000000${suffix}'::uuid,
    'Wine and cocktails', '2026-09-30T19:00:00Z', '${stops}'::jsonb,
    '20000000-0000-4000-8000-00000000000${suffix}'::uuid,
    'Host', '${suffix.repeat(64)}', '2026-09-29T12:00:00Z',
    '${suffix.repeat(64)}', '${suffix.repeat(64)}', null, null, null,
    '{"drinkCategory":"wine"}'::jsonb)`);
}

function saved(suffix: string): Array<unknown> {
  return JSON.parse(db().sql(`select jsonb_agg(selected_drink_price_evidence order by position)::text
    from public.plan_stops where plan_id = '10000000-0000-4000-8000-00000000000${suffix}'`));
}

function executeGrants(): string {
  return db().sql(`select has_function_privilege('anon',
    'public.create_plan_idempotent_atomic(uuid,text,timestamptz,jsonb,uuid,text,text,timestamptz,text,text,text,text,text)',
    'execute')::text || ':' || has_function_privilege('authenticated',
    'public.create_plan_idempotent_atomic(uuid,text,timestamptz,jsonb,uuid,text,text,timestamptz,text,text,text,text,text)',
    'execute')::text || ':' || has_function_privilege('service_role',
    'public.create_plan_idempotent_atomic(uuid,text,timestamptz,jsonb,uuid,text,text,timestamptz,text,text,text,text,text)',
    'execute')::text`);
}

beforeAll(async () => {
  if (skipReason) return;
  session = await startPostgres({ label: "plan-evidence-create-0162", database: "pubmax_plan_evidence_create" });
  try {
    db().applyFile(join(process.cwd(), "scripts/rls/session-fixture.sql"));
    for (const path of prerequisites) db().applyFile(path);
    executeGrantsBefore = executeGrants();
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

describe.skipIf(skipReason !== null)("0162 Plan creation evidence", () => {
  it("reproduces the pre-migration create RPC discarding selected evidence", () => {
    expect(executeGrantsBefore).toBe("false:false:true");
    expect(create("1")).toBe("created");
    expect(saved("1")).toEqual([null, null, null]);
  });

  it("persists wine and cocktail evidence through creation and idempotent replay", () => {
    db().applyFile(forward);
    expect(executeGrants()).toBe(executeGrantsBefore);
    expect(create("2")).toBe("created");
    expect(saved("2")).toEqual([wine, cocktail, null]);
    expect(create("2")).toBe("replayed");
    expect(saved("2")).toEqual([wine, cocktail, null]);
    expect(createWithContext("4")).toBe("created");
    expect(saved("4")).toEqual([wine, cocktail, null]);
    expect(db().sql("select night_context->>'drinkCategory' from public.plans where id = '10000000-0000-4000-8000-000000000004'"))
      .toBe("wine");
  });

  it("rollback restores old writes without removing previously saved evidence", () => {
    db().applyFile(rollback);
    expect(executeGrants()).toBe(executeGrantsBefore);
    expect(create("3")).toBe("created");
    expect(saved("3")).toEqual([null, null, null]);
    expect(saved("2")).toEqual([wine, cocktail, null]);
  });
});

describe.skipIf(skipReason !== null)("Current migration Plan listed-price creation", () => {
  const listed = {
    category: "wine", pence: 525, serving: "125ml", source: "listed",
    sourceUrl: "https://example.org/menu", observedAt: "2026-09-29T10:40:17.846Z",
  };
  const fullContext = {
    nightArea: "piccadilly-soho", daypart: "evening", partyType: "friends",
    groupSize: 2, stopCount: 3, budget: "standard", budgetLimitPence: null,
    zeroProof: false, drinkCategory: "wine", wetherspoonsPreferred: false,
    atmosphere: [], foodNeeds: [], accessibility: [], transportConstraints: [],
  };
  const literal = (value: unknown): string => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
  const listedStops = [
    { venueId: "venue-a", venueName: "A", selectedDrinkPriceEvidence: listed },
    { venueId: "venue-b", venueName: "B", selectedDrinkPriceEvidence: wine },
    { venueId: "venue-c", venueName: "C" },
  ];
  const contextCreate = (suffix: "5" | "6" | "7", context: typeof fullContext | null, route = listedStops): string =>
    db().sql(`select public.create_plan_with_context_idempotent_atomic(
      '10000000-0000-4000-8000-00000000000${suffix}'::uuid,
      'Listed wine', '2026-09-30T19:00:00Z', ${literal(route)},
      '20000000-0000-4000-8000-00000000000${suffix}'::uuid,
      'Host', '${suffix.repeat(64)}', '2026-09-29T12:00:00Z',
      '${suffix.repeat(64)}', '${suffix.repeat(64)}', null, null, null,
      ${context === null ? "null" : literal(context)})`);
  const storedContext = (suffix: string): unknown => JSON.parse(db().sql(
    `select coalesce(night_context, 'null'::jsonb)::text from public.plans
     where id = '10000000-0000-4000-8000-00000000000${suffix}'`,
  ));
  const saveControl = (evidence: unknown): string =>
    `update public.plan_stops set selected_drink_price_evidence = ${evidence === null ? "null" : literal(evidence)}
     where plan_id = '10000000-0000-4000-8000-000000000007' and position = 0`;
  const constraintDefinition = (): string => db().sql(`select pg_get_constraintdef(oid)
    from pg_constraint where conrelid = 'public.plan_stops'::regclass
    and conname = 'plan_stops_selected_drink_price_evidence_check'`);
  let communityConstraintBefore = "";

  beforeAll(() => {
    communityConstraintBefore = constraintDefinition();
    // The earlier historical proof ends by undoing 0162. Restore it, then
    // apply every remaining forward migration in timestamp order so these
    // calls exercise the current schema rather than an isolated old CHECK.
    for (const entry of readdirSync(migrations)
      .filter((entry) => entry.endsWith(".sql") && entry >= name).sort()) {
      db().applyFile(join(migrations, entry));
    }
    expect(contextCreate("7", null, [
      { venueId: "venue-a", venueName: "A", selectedDrinkPriceEvidence: wine },
      { venueId: "venue-b", venueName: "B", selectedDrinkPriceEvidence: wine },
      { venueId: "venue-c", venueName: "C" },
    ])).toBe("created");
  }, 600_000);

  it.each([
    ["full NightContext", "5", fullContext],
    ["SQL NULL NightContext", "6", null],
  ] as const)("persists and replays listed citations with %s", (_label, suffix, context) => {
    expect(contextCreate(suffix, context)).toBe("created");
    expect(saved(suffix)).toEqual([listed, wine, null]);
    expect(storedContext(suffix)).toEqual(context);
    expect(contextCreate(suffix, context)).toBe("replayed");
    expect(saved(suffix)).toEqual([listed, wine, null]);
    expect(storedContext(suffix)).toEqual(context);
  });

  it("keeps community and nullable evidence without changing RPC or column grants", () => {
    expect(saved("7")).toEqual([wine, wine, null]);
    expect(storedContext("7")).toBeNull();
    expect(executeGrants()).toBe(executeGrantsBefore);
    expect(db().sql(`select has_function_privilege('anon',
      'public.create_plan_with_context_idempotent_atomic(uuid,text,timestamptz,jsonb,uuid,text,text,timestamptz,text,text,text,text,text,jsonb)', 'execute')::text
      || ':' || has_function_privilege('authenticated',
      'public.create_plan_with_context_idempotent_atomic(uuid,text,timestamptz,jsonb,uuid,text,text,timestamptz,text,text,text,text,text,jsonb)', 'execute')::text
      || ':' || has_function_privilege('service_role',
      'public.create_plan_with_context_idempotent_atomic(uuid,text,timestamptz,jsonb,uuid,text,text,timestamptz,text,text,text,text,text,jsonb)', 'execute')::text`))
      .toBe("false:false:true");
    expect(db().sql("select has_column_privilege('authenticated','public.plan_stops','selected_drink_price_evidence','update')"))
      .toBe("f");
    db().sql(saveControl(null));
    expect(saved("7")).toEqual([null, wine, null]);
    db().sql(saveControl(wine));
    expect(saved("7")).toEqual([wine, wine, null]);
  });

  it.each([
    ["extra private field", { ...listed, contributor: "private" }],
    ["missing citation", { category: "wine", pence: 525, serving: "125ml", source: "listed", observedAt: listed.observedAt }],
    ["beer category", { ...listed, category: "beer" }],
    ["zero amount", { ...listed, pence: 0 }],
    ["credential URL", { ...listed, sourceUrl: "https://person:secret@example.org/menu" }],
    ["unsafe URL", { ...listed, sourceUrl: "javascript:alert(1)" }],
    ["oversize URL", { ...listed, sourceUrl: "https://example.org/" + "x".repeat(2048) }],
    ["noncanonical date", { ...listed, observedAt: "2026-09-29" }],
    ["long serving", { ...listed, serving: "x".repeat(49) }],
    ["untrimmed serving", { ...listed, serving: " 125ml" }],
    ["control character serving", { ...listed, serving: "125\nml" }],
    ["community citation crossing", { ...wine, sourceUrl: listed.sourceUrl }],
    ["community serving crossing", { ...wine, serving: "125ml" }],
  ])("refuses %s and preserves the existing community value", (_label, evidence) => {
    expect(db().expectRefusal(saveControl(evidence))).toContain("plan_stops_selected_drink_price_evidence_check");
    expect(saved("7")).toEqual([wine, wine, null]);
  });

  it("rollback removes listed values and pending citations while retaining community, NULL and grants", () => {
    const pendingStops = listedStops.map((stop, position) => ({ ...stop, position }));
    const communityStops = pendingStops.map((stop) => ({
      ...stop,
      ...(stop.selectedDrinkPriceEvidence ? { selectedDrinkPriceEvidence: wine } : {}),
    }));
    const proposalStops = (suffix: "5" | "7"): unknown => JSON.parse(db().sql(
      `select stops::text from public.plan_route_proposals
       where id = '30000000-0000-4000-8000-00000000000${suffix}'`,
    ));
    for (const [suffix, route] of [["5", pendingStops], ["7", communityStops]] as const) {
      db().sql(`insert into public.plan_route_proposals
        (id, plan_id, proposed_by_member_id, expected_route_revision, stops, reason, idempotency_key, created_at)
        values ('30000000-0000-4000-8000-00000000000${suffix}',
          '10000000-0000-4000-8000-00000000000${suffix}',
          '20000000-0000-4000-8000-00000000000${suffix}',
          1, ${literal(route)}, 'Route', 'listed-rollback-${suffix}', now())`);
    }
    expect(proposalStops("5")).toEqual(pendingStops);
    expect(proposalStops("7")).toEqual(communityStops);
    db().applyFile(join(migrations, "rollback/20261001073000_0176_plan_listed_drink_evidence_rollback.sql"));
    expect(saved("5")).toEqual([null, wine, null]);
    expect(saved("6")).toEqual([null, wine, null]);
    expect(saved("7")).toEqual([wine, wine, null]);
    expect(proposalStops("5")).toEqual([
      { venueId: "venue-a", venueName: "A", position: 0 },
      pendingStops[1], pendingStops[2],
    ]);
    expect(proposalStops("7")).toEqual(communityStops);
    expect(constraintDefinition()).toBe(communityConstraintBefore);
    expect(executeGrants()).toBe(executeGrantsBefore);
    expect(db().sql("select has_column_privilege('authenticated','public.plan_stops','selected_drink_price_evidence','update')"))
      .toBe("f");
    expect(db().expectRefusal(saveControl(listed))).toContain("plan_stops_selected_drink_price_evidence_check");
    db().sql(saveControl(null));
    expect(saved("7")).toEqual([null, wine, null]);
    db().sql(saveControl(wine));
    expect(saved("7")).toEqual([wine, wine, null]);
  });
});
