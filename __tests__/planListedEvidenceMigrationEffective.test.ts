import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  postgresSkipReason,
  startPostgres,
  type PostgresSession,
} from "./helpers/postgres";
import { listedCategoryPrices } from "@/lib/listedCategoryPrices";
import { parseUkPriceBundleRows } from "@/lib/ukPriceBundle";

const skipReason = postgresSkipReason();
const migrations = join(process.cwd(), "supabase/migrations");
const name = "20260929190000_0168_plan_listed_drink_evidence.sql";
const forward = join(migrations, name);
const rollback = join(
  migrations,
  "rollback/20260929190000_0168_plan_listed_drink_evidence_rollback.sql",
);
const prerequisites = readdirSync(migrations)
  .filter((entry) => entry.endsWith(".sql") && entry < name)
  .sort()
  .map((entry) => join(migrations, entry));
const planId = "10000000-0000-4000-8000-000000000168";
const listed = {
  category: "wine",
  pence: 525,
  serving: "125ml",
  source: "listed",
  sourceUrl: "https://example.org/menu",
  observedAt: "2026-09-29T10:40:17.846Z",
};
const community = {
  category: "wine",
  pence: 550,
  serving: null,
  source: "community",
  reportedAt: "2026-09-25T12:00:00.000Z",
};
let session: PostgresSession | null = null;
function db(): PostgresSession {
  if (!session) throw new Error("PostgreSQL session unavailable");
  return session;
}
function save(evidence: unknown): string {
  return `update public.plan_stops set selected_drink_price_evidence = '${JSON.stringify(evidence)}'::jsonb where plan_id = '${planId}' and position = 0`;
}
function saved(): unknown {
  const value = db().sql(
    `select selected_drink_price_evidence::text from public.plan_stops where plan_id = '${planId}' and position = 0`,
  );
  return value ? JSON.parse(value) : null;
}
function createFromCurrentBundle(category: "wine" | "cocktail", suffix: "5" | "6") {
  const rows = parseUkPriceBundleRows(JSON.parse(readFileSync(
    join(process.cwd(), "public/data/uk_prices/rows.json"), "utf8",
  ))).filter((row) => row.venueId === "venue-11bllvc");
  const quote = listedCategoryPrices(rows).find((candidate) => candidate.category === category);
  expect(quote).toBeDefined();
  if (!quote) throw new Error(`No current listed ${category} quote for Punch & Judy`);
  const evidence = {
    category,
    pence: Math.round(quote.priceGbp * 100),
    serving: quote.servingSize,
    source: "listed",
    sourceUrl: quote.sourceUrl,
    observedAt: new Date(quote.observedAt).toISOString(),
  };
  const id = proposalPlanId(suffix);
  const member = `20000000-0000-4000-8000-00000000016${suffix}`;
  const stops = JSON.stringify([{ venueId: "venue-11bllvc", venueName: "Punch & Judy", selectedDrinkPriceEvidence: evidence }]).replaceAll("'", "''");
  expect(db().sql(`select public.create_plan_with_context_idempotent_atomic(
    '${id}'::uuid, 'Listed ${category}', '2026-09-30T19:00:00Z', '${stops}'::jsonb,
    '${member}'::uuid, 'Host', '${suffix.repeat(64)}', now(),
    '${suffix.repeat(64)}', '${suffix.repeat(64)}', null, null, null,
    '{"drinkCategory":"${category}","zeroProof":false}'::jsonb)`)).toBe("created");
  const stored = db().sql(`select selected_drink_price_evidence::text from public.plan_stops where plan_id = '${id}' and position = 0`);
  expect(JSON.parse(stored)).toEqual(evidence);
  return evidence;
}
function communitySaved(): unknown {
  const value = db().sql(
    `select selected_drink_price_evidence::text from public.plan_stops where plan_id = '${planId}' and position = 1`,
  );
  return value ? JSON.parse(value) : null;
}
function proposalPlanId(suffix: string): string {
  return `10000000-0000-4000-8000-00000000016${suffix}`;
}
function proposalId(suffix: string): string {
  return `30000000-0000-4000-8000-00000000016${suffix}`;
}
function pendingProposal(
  suffix: string,
  evidence: unknown,
): Array<Record<string, unknown>> {
  const plan = proposalPlanId(suffix);
  const member = `20000000-0000-4000-8000-00000000016${suffix}`;
  const stops = [
    { venueId: "venue-a", venueName: "A", position: 0 },
    {
      venueId: "venue-b",
      venueName: "B",
      position: 1,
      selectedDrinkPriceEvidence: evidence,
    },
    { venueId: "venue-c", venueName: "C", position: 2 },
  ];
  db()
    .sql(`insert into public.plans (id, title, start_time) values ('${plan}', 'Proposal night', '2026-09-30T19:00:00Z');
    insert into public.plan_crew_members (id, plan_id, name, token_hash) values ('${member}', '${plan}', 'Host', '${suffix.repeat(64)}');
    insert into public.plan_route_proposals
      (id, plan_id, proposed_by_member_id, expected_route_revision, stops, reason, idempotency_key, created_at)
    values ('${proposalId(suffix)}', '${plan}', '${member}', 1, '${JSON.stringify(stops)}'::jsonb, 'Route', 'proposal-${suffix}', now());`);
  return stops;
}
function proposalStops(suffix: string): unknown {
  return JSON.parse(
    db().sql(
      `select stops::text from public.plan_route_proposals where id = '${proposalId(suffix)}'`,
    ),
  );
}
function acceptProposal(suffix: string): string {
  return db().sql(
    `select public.decide_plan_route_proposal_atomic('${proposalPlanId(suffix)}', '${proposalId(suffix)}', '${suffix.repeat(64)}', 'accepted', 'decision-${suffix}', now())`,
  );
}

beforeAll(async () => {
  if (skipReason) return;
  session = await startPostgres({
    label: "plan-listed-evidence-0168",
    database: "pubmax_plan_listed_evidence",
  });
  try {
    db().applyFile(join(process.cwd(), "scripts/rls/session-fixture.sql"));
    for (const path of prerequisites) db().applyFile(path);
    db()
      .sql(`insert into public.plans (id, title, start_time) values ('${planId}', 'Wine night', '2026-09-30T19:00:00Z');
      insert into public.plan_stops (plan_id, venue_id, venue_name, position) values ('${planId}', 'venue-a', 'A', 0);
      insert into public.plan_stops (plan_id, venue_id, venue_name, position, selected_drink_price_evidence)
      values ('${planId}', 'venue-b', 'B', 1, '${JSON.stringify(community)}'::jsonb);`);
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

describe.skipIf(skipReason !== null)(
  "0168 listed Plan evidence storage",
  () => {
    it("reproduces listed evidence refusal before migration", () => {
      expect(db().expectRefusal(save(listed))).toContain(
        "plan_stops_selected_drink_price_evidence_check",
      );
      db().sql(save(community));
      expect(saved()).toEqual(community);
    });

    it("round trips listed citation and explicit or unknown serving without widening community", () => {
      db().applyFile(forward);
      for (const evidence of [
        listed,
        { ...listed, serving: null },
        community,
      ]) {
        db().sql(save(evidence));
        expect(saved()).toEqual(evidence);
      }
      expect(
        db().sql(
          "select has_column_privilege('authenticated','public.plan_stops','selected_drink_price_evidence','update')",
        ),
      ).toBe("f");
    });

    it("rejects fabricated fields, unsafe citation, bad date, and source-shape crossing", () => {
      for (const invalid of [
        { ...listed, contributor: "private" },
        { ...listed, sourceUrl: "https://person:secret@example.org/menu" },
        { ...listed, sourceUrl: "javascript:alert(1)" },
        { ...listed, sourceUrl: "https://example.org/" + "x".repeat(2048) },
        { ...listed, observedAt: "2026-09-29" },
        { ...listed, serving: "x".repeat(49) },
        { ...community, sourceUrl: listed.sourceUrl },
        { ...community, serving: "125ml" },
      ]) {
        expect(db().expectRefusal(save(invalid))).toContain(
          "plan_stops_selected_drink_price_evidence_check",
        );
      }
    });

    it("persists current approved bundle wine and cocktail citations through atomic Plan creation", () => {
      const wine = createFromCurrentBundle("wine", "5");
      const cocktail = createFromCurrentBundle("cocktail", "6");
      expect(wine.sourceUrl).toMatch(/^https:\/\//);
      expect(cocktail.sourceUrl).toMatch(/^https:\/\//);
      expect(communitySaved()).toEqual(community);
    });

    it("rollback clears only listed evidence and restores community-only constraint", () => {
      db().sql(save(listed));
      const listedStops = pendingProposal("7", listed);
      const communityStops = pendingProposal("9", community);
      db().applyFile(rollback);
      expect(saved()).toBeNull();
      expect(communitySaved()).toEqual(community);
      expect(proposalStops("7")).toEqual([
        listedStops[0],
        { venueId: "venue-b", venueName: "B", position: 1 },
        listedStops[2],
      ]);
      expect(proposalStops("9")).toEqual(communityStops);
      expect(acceptProposal("7")).toBe("decided");
      expect(acceptProposal("9")).toBe("decided");
      expect(
        db().sql(
          `select selected_drink_price_evidence::text from public.plan_stops where plan_id = '${proposalPlanId("7")}' and position = 1`,
        ),
      ).toBe("");
      expect(
        JSON.parse(
          db().sql(
            `select selected_drink_price_evidence::text from public.plan_stops where plan_id = '${proposalPlanId("9")}' and position = 1`,
          ),
        ),
      ).toEqual(community);
      expect(db().expectRefusal(save(listed))).toContain(
        "plan_stops_selected_drink_price_evidence_check",
      );
      db().sql(save(community));
      expect(saved()).toEqual(community);
    });
  },
);

describe("0174 backup persistence and locked context", () => {
  const migration = join(migrations, "20260929230000_0174_plan_backup_context_evidence.sql");
  const undo = join(migrations, "rollback/20260929230000_0174_plan_backup_context_evidence_rollback.sql");
  const id = "10000000-0000-4000-8000-000000000174";
  const member = "20000000-0000-4000-8000-000000000174";
  const proposal = "30000000-0000-4000-8000-000000000174";
  const quote = { ...listed, serving: null };
  const stops = [
    { venueId: "venue-a", venueName: "A", position: 0, selectedDrinkPriceEvidence: quote,
      alternatives: [{ venueId: "venue-backup", venueName: "Backup", selectedDrinkPriceEvidence: quote }] },
    { venueId: "venue-b", venueName: "B", position: 1 },
    { venueId: "venue-c", venueName: "C", position: 2 },
  ];
  const literal = (value: unknown) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
  const context = (category: string, zeroProof = false) => literal({ drinkCategory: category, zeroProof });
  const read = () => JSON.parse(db().sql(`select jsonb_build_object('price', selected_drink_price_evidence, 'backups', alternatives)::text from public.plan_stops where plan_id='${id}' and position=0`));
  const reset = (category = "wine", zeroProof = false) => {
    db().sql(`delete from public.plans where id='${id}';
      insert into public.plans(id,title,start_time,night_context) values('${id}','Backups',now(),${context(category, zeroProof)});
      insert into public.plan_crew_members(id,plan_id,name,token_hash) values('${member}','${id}','Host','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      insert into public.plan_route_proposals(id,plan_id,proposed_by_member_id,expected_route_revision,stops,reason,idempotency_key,created_at)
      values('${proposal}','${id}','${member}',1,${literal(stops)},'Backup route','backup-proposal',now());`);
  };
  const accept = () => db().sql(`select public.decide_plan_route_proposal_atomic('${id}','${proposal}','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','accepted','backup-decision',now())`);
  const replace = (category: string | null) => db().sql(`select public.replace_plan_route_atomic('${id}','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',1,${literal(stops)},${category ? context(category) : "null"},false)`);
  const definitions = () => db().sql(`select string_agg(pg_get_functiondef(oid), E'\n' order by proname) from pg_proc where pronamespace='public'::regnamespace and proname in ('decide_plan_route_proposal_atomic','replace_plan_route_atomic','update_legacy_plan_status_context_atomic')`);

  it("reproduces stale proposal evidence and lost backups, then fixes every write and rolls back", () => {
    db().applyFile(forward);
    db().applyFile(join(migrations, "20260929200000_0171_plan_route_alternatives.sql"));
    const before = definitions();
    reset("cocktail");
    expect(accept()).toBe("decided");
    expect(read()).toEqual({ price: quote, backups: [] });
    reset();
    expect(replace(null)).toBe("ok");
    expect(read()).toEqual({ price: quote, backups: [] });
    db().applyFile(migration);
    for (const [category, zeroProof] of [["wine", false], ["cocktail", false], ["wine", true]] as const) {
      reset();
      expect(db().sql(`select public.update_legacy_plan_status_context_atomic('${id}','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',null,${context(category, zeroProof)})`)).toBe("ok");
      expect(accept()).toBe("decided");
      const retained = category === "wine" && !zeroProof;
      expect(read()).toEqual({ price: retained ? quote : null, backups: [{ venueId: "venue-backup", venueName: "Backup", ...(retained ? { selectedDrinkPriceEvidence: quote } : {}) }] });
      expect(accept()).toBe("already_decided");
    }
    for (const category of ["wine", "cocktail"]) {
      reset();
      expect(replace(category)).toBe("ok");
      const retained = category === "wine";
      expect(read()).toEqual({ price: retained ? quote : null, backups: [{ venueId: "venue-backup", venueName: "Backup", ...(retained ? { selectedDrinkPriceEvidence: quote } : {}) }] });
    }
    reset();
    expect(replace(null)).toBe("ok");
    expect(db().sql(`select public.update_legacy_plan_status_context_atomic('${id}','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',null,${context("cocktail")})`)).toBe("ok");
    expect(read()).toEqual({ price: null, backups: [{ venueId: "venue-backup", venueName: "Backup" }] });
    expect(db().sql(`select has_function_privilege('authenticated','public.plan_stop_evidence_for_context(jsonb,jsonb)','execute')`)).toBe("f");
    db().applyFile(undo);
    expect(definitions()).toBe(before);
  });
});
