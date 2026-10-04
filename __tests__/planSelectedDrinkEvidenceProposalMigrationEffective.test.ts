import { readdirSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const skipReason = postgresSkipReason();
const migrations = join(process.cwd(), "supabase/migrations");
const name = "20260929150000_0164_plan_proposal_selected_drink_evidence.sql";
const forward = join(migrations, name);
const rollback = join(migrations, "rollback/20260929150000_0164_plan_proposal_selected_drink_evidence_rollback.sql");
const prerequisites = readdirSync(migrations).filter((entry) => entry.endsWith(".sql") && entry < name).sort().map((entry) => join(migrations, entry));
const wine = { category: "wine", pence: 550, serving: null, source: "community", reportedAt: "2026-09-25T12:00:00.000Z" };
const cocktail = { category: "cocktail", pence: 950, serving: null, source: "community", reportedAt: "2026-09-25T12:00:00.000Z" };
function hostHash(suffix: string): string { return suffix.repeat(64); }
let session: PostgresSession | null = null;
function db(): PostgresSession {
  if (!session) throw new Error("PostgreSQL session unavailable");
  return session;
}
function id(suffix: string): string { return `10000000-0000-4000-8000-00000000000${suffix}`; }
function memberId(suffix: string): string { return `20000000-0000-4000-8000-00000000000${suffix}`; }
function proposalId(suffix: string): string { return `30000000-0000-4000-8000-00000000000${suffix}`; }
function create(suffix: string, evidence: typeof wine): void {
  expect(db().sql(`select public.create_plan_idempotent_atomic(
    '${id(suffix)}'::uuid, 'Route', '2026-09-30T19:00:00Z',
    '[{"venueId":"venue-x","venueName":"X"},{"venueId":"venue-y","venueName":"Y"},{"venueId":"venue-z","venueName":"Z"}]'::jsonb,
    '${memberId(suffix)}'::uuid, 'Host', '${hostHash(suffix)}',
    '2026-09-29T12:00:00Z', '${suffix.repeat(64)}', '${suffix.repeat(64)}', null, null, null)`)).toBe("created");
  const stops = JSON.stringify([
    { venueId: "venue-a", venueName: "A", position: 0 },
    { venueId: "venue-b", venueName: "B", position: 1, selectedDrinkPriceEvidence: evidence },
    { venueId: "venue-c", venueName: "C", position: 2 },
  ]);
  db().sql(`insert into public.plan_route_proposals
    (id,plan_id,proposed_by_member_id,expected_route_revision,stops,reason,resolved_constraint_ids,unresolved_constraint_ids,status,idempotency_key,created_at)
    values ('${proposalId(suffix)}','${id(suffix)}','${memberId(suffix)}',1,'${stops}'::jsonb,'Route','[]'::jsonb,'[]'::jsonb,'pending','proposal-${suffix}',now())`);
}
function decide(suffix: string): string {
  return db().sql(`select public.decide_plan_route_proposal_atomic('${id(suffix)}'::uuid,'${proposalId(suffix)}'::uuid,
    '${hostHash(suffix)}','accepted','decision-${suffix}',now())`);
}
function saved(suffix: string): Array<unknown> {
  return JSON.parse(db().sql(`select jsonb_agg(selected_drink_price_evidence order by position)::text from public.plan_stops where plan_id='${id(suffix)}'`));
}

beforeAll(async () => {
  if (skipReason) return;
  session = await startPostgres({ label: "plan-evidence-proposal-0164", database: "pubmax_plan_evidence_proposal" });
  try {
    db().applyFile(join(process.cwd(), "scripts/rls/session-fixture.sql"));
    for (const path of prerequisites) db().applyFile(path);
  } catch (error) {
    await session.stop(); session = null; throw error;
  }
}, 600_000);
afterAll(async () => { await session?.stop(); session = null; });

describe.skipIf(skipReason !== null)("0164 Plan proposal acceptance evidence", () => {
  it("reproduces atomic acceptance discarding a verified proposal snapshot", () => {
    create("1", wine);
    expect(decide("1")).toBe("decided");
    expect(saved("1")).toEqual([null, null, null]);
  });
  it("saves wine and cocktail evidence with service-only execution", () => {
    db().applyFile(forward);
    expect(db().sql(`select has_function_privilege('anon','public.decide_plan_route_proposal_atomic(uuid,uuid,text,text,text,timestamptz)','execute')::text || ':' || has_function_privilege('authenticated','public.decide_plan_route_proposal_atomic(uuid,uuid,text,text,text,timestamptz)','execute')::text || ':' || has_function_privilege('service_role','public.decide_plan_route_proposal_atomic(uuid,uuid,text,text,text,timestamptz)','execute')::text`)).toBe("false:false:true");
    create("2", wine); create("3", cocktail);
    expect(decide("2")).toBe("decided");
    expect(decide("3")).toBe("decided");
    expect(saved("2")).toEqual([null, wine, null]);
    expect(saved("3")).toEqual([null, cocktail, null]);
    expect(decide("2")).toBe("already_decided");
    expect(saved("2")).toEqual([null, wine, null]);
  });
  it("rollback restores old acceptance writes without erasing existing evidence", () => {
    db().applyFile(rollback);
    create("4", wine);
    expect(decide("4")).toBe("decided");
    expect(saved("4")).toEqual([null, null, null]);
    expect(saved("2")).toEqual([null, wine, null]);
  });
});


describe.skipIf(skipReason !== null)("0168 accepted proposals follow current drink context", () => {
  beforeAll(() => {
    const tail = readdirSync(migrations).filter((entry) => entry.endsWith(".sql") && entry >= name).sort();
    for (const entry of tail) db().applyFile(join(migrations, entry));
  });

  it.each([
    ["5", { drinkCategory: "beer", zeroProof: false }, null],
    ["6", { drinkCategory: "wine", zeroProof: true }, null],
    ["7", { drinkCategory: "wine", zeroProof: false }, wine],
  ] as const)("accepts proposal %s without restoring incompatible price evidence", (suffix, context, expected) => {
    create(suffix, wine);
    expect(db().sql(`select public.update_legacy_plan_status_context_atomic(
      '${id(suffix)}'::uuid, '${hostHash(suffix)}', null, '${JSON.stringify(context)}'::jsonb)`)).toBe("ok");
    expect(decide(suffix)).toBe("decided");
    expect(saved(suffix)).toEqual([null, expected, null]);
    expect(decide(suffix)).toBe("already_decided");
    expect(saved(suffix)).toEqual([null, expected, null]);
  });
  it("rollback restores previous acceptance behavior without erasing matching evidence", () => {
    db().applyFile(join(migrations, "rollback/20260930120000_0168_plan_proposal_context_evidence_rollback.sql"));
    create("8", wine);
    expect(db().sql(`select public.update_legacy_plan_status_context_atomic(
      '${id("8")}'::uuid, '${hostHash("8")}', null, '{"drinkCategory":"beer","zeroProof":false}'::jsonb)`)).toBe("ok");
    expect(decide("8")).toBe("decided");
    expect(saved("8")).toEqual([null, wine, null]);
    expect(saved("7")).toEqual([null, wine, null]);
    db().applyFile(join(migrations, "20260930120000_0168_plan_proposal_context_evidence.sql"));
  });

});


describe.skipIf(skipReason !== null)("manual proposal acceptance without a drink context", () => {
  beforeAll(() => {
    const rpcMigrations = [
      "20260929180000_0167_plan_replace_context_evidence.sql",
      "20260930120000_0168_plan_proposal_context_evidence.sql",
    ];
    for (const entry of readdirSync(migrations).filter((entry) => rpcMigrations.includes(entry)
      || entry.endsWith("_0177_plan_manual_selected_evidence.sql")).sort()) {
      db().applyFile(join(migrations, entry));
    }
  });

  function proposalRead(suffix: string): { status: string; decision: string | null; stops: Array<{ selectedDrinkPriceEvidence?: unknown }> } {
    return JSON.parse(db().sql(`select jsonb_build_object('status', status, 'decision', decision_idempotency_key,
      'stops', stops)::text from public.plan_route_proposals where id = '${proposalId(suffix)}'`));
  }
  function snapshot(suffix: string): string {
    return db().sql(`select jsonb_build_object('revision', route_revision, 'context', night_context,
      'stops', (select jsonb_agg(jsonb_build_object('venueId', venue_id, 'position', position,
        'evidence', selected_drink_price_evidence) order by position) from public.plan_stops
        where plan_id = '${id(suffix)}'))::text from public.plans where id = '${id(suffix)}'`);
  }

  it("retains a validated manual quote under SQL NULL context and keeps proposal snapshot readable on replay", () => {
    create("9", wine);
    expect(db().sql(`select (night_context is null)::text from public.plans where id = '${id("9")}'`)).toBe("true");
    expect(proposalRead("9").stops[1].selectedDrinkPriceEvidence).toEqual(wine);
    expect(decide("9")).toBe("decided");
    expect(saved("9")).toEqual([null, wine, null]);
    expect(db().sql(`select route_revision::text || ':' || (night_context is null)::text
      from public.plans where id = '${id("9")}'`)).toBe("2:true");
    const after = snapshot("9");
    expect(decide("9")).toBe("already_decided");
    expect(snapshot("9")).toBe(after);
    expect(proposalRead("9")).toMatchObject({ status: "accepted", decision: "decision-9" });
    expect(proposalRead("9").stops[1].selectedDrinkPriceEvidence).toEqual(wine);
  });

  it.each([
    ["a", { drinkCategory: "beer", zeroProof: false }],
    ["b", { drinkCategory: "wine", zeroProof: true }],
    ["c", {}],
  ] as const)("drops incompatible evidence on acceptance while preserving original proposal for %s", (suffix, context) => {
    create(suffix, wine);
    expect(db().sql(`select public.update_legacy_plan_status_context_atomic(
      '${id(suffix)}'::uuid, '${hostHash(suffix)}', null, '${JSON.stringify(context)}'::jsonb)`)).toBe("ok");
    expect(decide(suffix)).toBe("decided");
    expect(saved(suffix)).toEqual([null, null, null]);
    expect(proposalRead(suffix).stops[1].selectedDrinkPriceEvidence).toEqual(wine);
  });

  it("refuses a real non-host member without altering proposal, route, evidence or revision", () => {
    create("d", wine);
    const memberToken = "01".repeat(32);
    db().sql(`insert into public.plan_crew_members (id, plan_id, name, token_hash, joined_at, updated_at, can_collaborate)
      values ('40000000-0000-4000-8000-00000000000d','${id("d")}','Guest','${memberToken}',
        '2026-09-30T12:00:00Z','2026-09-30T12:00:00Z',true)`);
    const before = snapshot("d");
    const proposalBefore = proposalRead("d");
    expect(db().sql(`select public.decide_plan_route_proposal_atomic('${id("d")}'::uuid,'${proposalId("d")}'::uuid,
      '${memberToken}','accepted','member-decision',now())`)).toBe("forbidden");
    expect(snapshot("d")).toBe(before);
    expect(proposalRead("d")).toEqual(proposalBefore);
  });

  it("refuses a stale proposal revision before changing the route or decision", () => {
    create("e", wine);
    db().sql(`update public.plan_route_proposals set expected_route_revision = 2 where id = '${proposalId("e")}'`);
    const before = snapshot("e");
    const proposalBefore = proposalRead("e");
    expect(decide("e")).toBe("conflict");
    expect(snapshot("e")).toBe(before);
    expect(proposalRead("e")).toEqual(proposalBefore);
  });

  it("rolls back route and decision when absent-context evidence fails the storage CHECK", () => {
    create("f", { ...wine, pence: 0 });
    const before = snapshot("f");
    const proposalBefore = proposalRead("f");
    expect(db().expectRefusal(`select public.decide_plan_route_proposal_atomic('${id("f")}'::uuid,'${proposalId("f")}'::uuid,
      '${hostHash("f")}','accepted','invalid-decision',now())`)).toContain("plan_stops_selected_drink_price_evidence_check");
    expect(snapshot("f")).toBe(before);
    expect(proposalRead("f")).toEqual(proposalBefore);
  });

  it("keeps acceptance execution and private proposal reads service-only", () => {
    expect(db().sql(`select has_function_privilege('anon',
      'public.decide_plan_route_proposal_atomic(uuid,uuid,text,text,text,timestamptz)', 'execute')::text || ':' ||
      has_function_privilege('authenticated',
      'public.decide_plan_route_proposal_atomic(uuid,uuid,text,text,text,timestamptz)', 'execute')::text || ':' ||
      has_function_privilege('service_role',
      'public.decide_plan_route_proposal_atomic(uuid,uuid,text,text,text,timestamptz)', 'execute')::text`)).toBe("false:false:true");
    for (const role of ["anon", "authenticated"]) {
      expect(db().expectRefusal(`set role ${role}; select stops from public.plan_route_proposals where id = '${proposalId("9")}'`))
        .toContain("permission denied");
    }
    expect(proposalRead("9").stops[1].selectedDrinkPriceEvidence).toEqual(wine);
  });

  it("keeps exact listed and community quotes when accepting a proposal with NULL context", () => {
    const plan = "10000000-0000-4000-8000-000000000010";
    const member = "20000000-0000-4000-8000-000000000010";
    const proposal = "30000000-0000-4000-8000-000000000010";
    const token = "02".repeat(32);
    const listed = { category: "wine", pence: 525, serving: "125ml", source: "listed",
      sourceUrl: "https://example.org/menu", observedAt: "2026-09-29T10:40:17.846Z" };
    const route = [
      { venueId: "venue-a", venueName: "A", position: 0, selectedDrinkPriceEvidence: listed },
      { venueId: "venue-b", venueName: "B", position: 1, selectedDrinkPriceEvidence: wine },
      { venueId: "venue-c", venueName: "C", position: 2 },
    ];
    expect(db().sql(`select public.create_plan_idempotent_atomic('${plan}'::uuid,'Listed route','2026-09-30T19:00:00Z',
      '[{"venueId":"venue-x","venueName":"X"},{"venueId":"venue-y","venueName":"Y"},{"venueId":"venue-z","venueName":"Z"}]'::jsonb,
      '${member}'::uuid,'Host','${token}','2026-09-29T12:00:00Z','${token}','${token}',null,null,null)`)).toBe("created");
    db().sql(`insert into public.plan_route_proposals
      (id,plan_id,proposed_by_member_id,expected_route_revision,stops,reason,idempotency_key,created_at)
      values ('${proposal}','${plan}','${member}',1,'${JSON.stringify(route)}'::jsonb,'Listed route','listed-manual',now())`);
    expect(db().sql(`select (night_context is null)::text from public.plans where id = '${plan}'`)).toBe("true");
    expect(db().sql(`select public.decide_plan_route_proposal_atomic('${plan}'::uuid,'${proposal}'::uuid,
      '${token}','accepted','listed-accept',now())`)).toBe("decided");
    expect(JSON.parse(db().sql(`select jsonb_agg(selected_drink_price_evidence order by position)::text
      from public.plan_stops where plan_id = '${plan}'`))).toEqual([listed, wine, null]);
    expect(db().sql(`select route_revision::text || ':' || (night_context is null)::text
      from public.plans where id = '${plan}'`)).toBe("2:true");
    expect(JSON.parse(db().sql(`select stops::text from public.plan_route_proposals where id = '${proposal}'`))).toEqual(route);
  });

  it("0177 rollback restores predecessor acceptance and old NULL behavior while retaining saved proposal evidence", () => {
    const definitions = (): string => db().sql(`select jsonb_build_array(
      pg_get_functiondef('public.replace_plan_route_atomic(uuid,text,integer,jsonb,jsonb,boolean)'::regprocedure),
      pg_get_functiondef('public.decide_plan_route_proposal_atomic(uuid,uuid,text,text,text,timestamptz)'::regprocedure),
      (select proacl::text from pg_proc where oid = 'public.replace_plan_route_atomic(uuid,text,integer,jsonb,jsonb,boolean)'::regprocedure),
      (select proacl::text from pg_proc where oid = 'public.decide_plan_route_proposal_atomic(uuid,uuid,text,text,text,timestamptz)'::regprocedure)
    )::text`);
    const retained = snapshot("9");
    const retainedProposal = proposalRead("9");
    db().applyFile(join(migrations, "20260929180000_0167_plan_replace_context_evidence.sql"));
    db().applyFile(join(migrations, "20260930120000_0168_plan_proposal_context_evidence.sql"));
    const predecessor = definitions();
    db().applyFile(join(migrations, "20261001073100_0177_plan_manual_selected_evidence.sql"));
    const forwardDefinition = definitions();
    expect(forwardDefinition).not.toBe(predecessor);
    db().applyFile(join(migrations, "rollback/20261001073100_0177_plan_manual_selected_evidence_rollback.sql"));
    expect(definitions()).toBe(predecessor);
    create("0", wine);
    expect(decide("0")).toBe("decided");
    expect(saved("0")).toEqual([null, null, null]);
    expect(snapshot("9")).toBe(retained);
    expect(proposalRead("9")).toEqual(retainedProposal);
    expect(JSON.parse(db().sql(`select jsonb_agg(selected_drink_price_evidence order by position)::text
      from public.plan_stops where plan_id = '10000000-0000-4000-8000-000000000010'`)))
      .toEqual([{ category: "wine", pence: 525, serving: "125ml", source: "listed",
        sourceUrl: "https://example.org/menu", observedAt: "2026-09-29T10:40:17.846Z" }, wine, null]);
    db().applyFile(join(migrations, "20261001073100_0177_plan_manual_selected_evidence.sql"));
    expect(definitions()).toBe(forwardDefinition);
  });

});
