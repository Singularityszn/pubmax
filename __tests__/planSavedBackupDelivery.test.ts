import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const fixture = vi.hoisted(() => ({
  rows: [] as import("@/lib/ukPriceBundle").UkPriceBundleRow[],
  community: [] as Array<{ venueId: string; drinkCategory: "wine"; priceGbp: number;
    submittedAt: number; source: "community"; corroborations: number }>,
}));
vi.mock("@/lib/supabase", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/supabase")>(),
  isSupabaseConfigured: () => false,
}));
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/pintDrops", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/pintDrops")>(), isLimited: async () => false,
}));
// Canonical server venue pack is the fixture seam, never submitted display names.
vi.mock("@/lib/concierge/venues.server", () => ({
  loadConciergeVenues: async () => ["a", "b", "c", "d", "e", ...Array.from({ length: 25 }, (_, i) => `extra-${i}`)]
    .map((suffix) => ({ id: `venue-${suffix}`, name: `Canonical ${suffix}` })),
}));
// Same committed server-pack identity fixture used by existing canonical-base Plan tests.
const basePub = vi.hoisted(() => ({ id: "venue-uk-n8308248176", name: "The Sydney Arms",
  address: "70, Sydney Street, London, SW3 6NJ", lat: 51.48876, lng: -0.16951,
  curatedVenueId: "", kind: "pub" as const }));
vi.mock("@/lib/ukBaseIndex", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/ukBaseIndex")>(),
  lookupUkBasePub: async (id: string) => id === basePub.id
    ? { status: "ready", pub: basePub } : { status: "missing" },
}));
vi.mock("@/lib/ukPriceBundle.server", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/ukPriceBundle.server")>(),
  ukPriceBundleRowsFor: async (venueId: string) => ({
    status: "ready", rows: fixture.rows.filter((row) => row.venueId === venueId),
  }),
}));
vi.mock("@/lib/communityPriceStore", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/communityPriceStore")>(),
  readCommunityPriceCategoryIndex: async () => ({ prices: fixture.community, degraded: false, truncated: false }),
}));

import { POST as createPlan } from "@/app/api/plans/route";
import { GET, PATCH } from "@/app/api/plans/[id]/route";
import { POST as propose } from "@/app/api/plans/[id]/proposals/route";
import { POST as decide } from "@/app/api/plans/[id]/proposals/[proposalId]/decision/route";
import { planSummaryRouteUpdateBody } from "@/components/plan/PlanSummary";
import { inferNightContext } from "@/lib/nightPlanning";
import { seedRouteDraft } from "@/lib/planRouteEditor";
import { __resetMemoryPlans, memoryPlanStore } from "@/lib/planStore";
import type { UkPriceBundleRow } from "@/lib/ukPriceBundle";

const NOW = Date.parse("2026-09-30T19:00:00Z");
const quote = {
  category: "wine", pence: 625, serving: "125ml", source: "listed",
  sourceUrl: "https://example.org/approved-menu", observedAt: "2026-09-29T10:40:17.846Z",
} as const;
const backup = { venueId: "venue-d", venueName: "Canonical d", selectedDrinkPriceEvidence: quote };
let sequence = 0;
function row(overrides: Partial<UkPriceBundleRow> = {}): UkPriceBundleRow {
  return { venueId: "venue-d", name: "Canonical d", category: "wine", priceGbp: 6.25,
    servingSize: "125ml", drinkLabel: "House red 125ml", lane: "site-harvest", standing: "listed",
    sourceUrl: quote.sourceUrl, observedAt: quote.observedAt, publisher: "example.org", basis: null,
    sampleSize: null, ...overrides };
}
function request(path: string, method: "POST" | "PATCH", body: unknown, token?: string): Request {
  return new Request(`http://localhost/api/plans${path}`, { method,
    headers: { "content-type": "application/json", "idempotency-key": `saved-backup-${++sequence}`,
      ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
}
async function create(stops: unknown[] = [{ venueId: "venue-a" }], context?: unknown) {
  const response = await createPlan(request("", "POST", { creatorName: "Host", startTime: "2026-09-30T19:00:00Z",
    stops, ...(context === undefined ? {} : { context }) }));
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(201);
  return body as { plan: { plan: { id: string }; context?: unknown; stops: Array<Record<string, unknown>> }; memberToken: string };
}
function submitted(hint: unknown = quote) {
  return [{ venueId: "venue-a", alternatives: [
    { venueId: "venue-d", venueName: "Forged client name", selectedDrinkPriceEvidence: hint, contributor: "private-account-canary" },
    { venueId: "venue-e", venueName: "Another forged name" },
  ] }, { venueId: "venue-b" }, { venueId: "venue-c" }];
}
async function patch(id: string, token: string, body: unknown) {
  const response = await PATCH(request(`/${id}`, "PATCH", body, token), { params: Promise.resolve({ id }) });
  const result = await response.json();
  expect(response.status, JSON.stringify(result)).toBe(200);
  return result as { stops: Array<Record<string, unknown>> };
}
async function memberRead(id: string, token: string) {
  const response = await GET(new Request(`http://localhost/api/plans/${id}`, { headers: { authorization: `Bearer ${token}` } }),
    { params: Promise.resolve({ id }) });
  expect(response.status).toBe(200);
  return response.json();
}

beforeEach(() => { __resetMemoryPlans(); fixture.rows = [row()]; fixture.community = []; vi.spyOn(Date, "now").mockReturnValue(NOW); });
afterEach(() => { __resetMemoryPlans(); fixture.rows = []; fixture.community = []; vi.restoreAllMocks(); });

describe("Saved Plan backups through canonical route and approved quote doors", () => {
  it("delivers saved backups in the editor and Save route body without active-route duplicates", () => {
    const stored = [{ venueId: "venue-a", venueName: "Canonical a", position: 0, alternatives: [backup] },
      { venueId: "venue-b", venueName: "Canonical b", position: 1 }];
    expect(seedRouteDraft(stored, []).at(0)?.alternatives).toEqual([backup]);
    const wire = planSummaryRouteUpdateBody({ stops: [{ ...stored[0], alternatives: [backup,
      { venueId: "venue-b", venueName: "Canonical b" }] }, stored[1]], expectedRouteRevision: 1, authority: null });
    expect((wire.stops as Array<Record<string, unknown>>)[0].alternatives).toEqual([backup]);
  });

  it("creates and reloads approved backup names/quotes while both contexts are absent and preview stays private", async () => {
    const body = await create(submitted());
    expect(body.plan.context).toBeNull();
    expect(body.plan.stops[0].alternatives).toEqual([backup, { venueId: "venue-e", venueName: "Canonical e" }]);
    const member = await memberRead(body.plan.plan.id, body.memberToken);
    expect(member.stops[0].alternatives).toEqual(body.plan.stops[0].alternatives);
    expect(JSON.stringify(member)).not.toContain("private-account-canary");
    const anonymous = await GET(new Request(`http://localhost/api/plans/${body.plan.plan.id}`),
      { params: Promise.resolve({ id: body.plan.plan.id }) });
    expect(anonymous.status).toBe(200);
    const preview = await anonymous.text();
    for (const canary of ["alternatives", "venue-d", quote.sourceUrl, "private-account-canary"]) expect(preview).not.toContain(canary);
  });

  it("keeps a canonical UK-base pub as a backup without promoting it to the curated catalogue", async () => {
    fixture.rows = [row({ venueId: basePub.id, name: basePub.name })];
    const body = await create([{ venueId: "venue-a", alternatives: [
      { venueId: basePub.id, venueName: "Client invented name", selectedDrinkPriceEvidence: quote },
    ] }]);
    expect(body.plan.stops[0].alternatives).toEqual([
      { venueId: basePub.id, venueName: basePub.name, selectedDrinkPriceEvidence: quote },
    ]);
  });

  it.each([
    { pence: 1 }, { serving: "250ml" }, { sourceUrl: "https://forged.example/menu" },
    { observedAt: "2026-09-28T10:40:17.846Z" }, { category: "gin" },
  ])("retains canonical backup identity but rejects a mismatched quote $pence $serving $category", async (change) => {
    const body = await create(submitted({ ...quote, ...change }));
    expect(body.plan.stops[0].alternatives).toEqual([
      { venueId: "venue-d", venueName: "Canonical d" }, { venueId: "venue-e", venueName: "Canonical e" },
    ]);
  });

  it("cannot restore expired backup evidence from a saved hint", async () => {
    fixture.rows = [row({ observedAt: "2024-09-29T10:40:17.846Z" })];
    const body = await create(submitted({ ...quote, observedAt: fixture.rows[0].observedAt }));
    expect(body.plan.stops[0].alternatives).toEqual([
      { venueId: "venue-d", venueName: "Canonical d" }, { venueId: "venue-e", venueName: "Canonical e" },
    ]);
  });

  it.each([
    { alternatives: [{ venueId: "venue-d" }, { venueId: "venue-d" }] },
    { alternatives: [{ venueId: "venue-b" }] }, { alternatives: [{ venueId: "venue-unknown" }] },
    { alternatives: Array.from({ length: 25 }, (_, i) => ({ venueId: `venue-extra-${i}` })) },
  ])("refuses duplicate, selected, unknown or over-cap backups", async ({ alternatives }) => {
    const response = await createPlan(request("", "POST", { creatorName: "Host", startTime: "2026-09-30T19:00:00Z",
      stops: [{ venueId: "venue-a", alternatives }, { venueId: "venue-b" }, { venueId: "venue-c" }] }));
    expect(response.status).toBe(400);
  });

  it("accepts exactly twenty-four canonical backups without inventing quotes", async () => {
    const alternatives = Array.from({ length: 24 }, (_, i) => ({ venueId: `venue-extra-${i}`, venueName: "Client canary" }));
    const body = await create([{ venueId: "venue-a", alternatives }]);
    expect(body.plan.stops[0].alternatives).toEqual(alternatives.map(({ venueId }, i) => ({ venueId, venueName: `Canonical extra-${i}` })));
  });

  it("omits community backup evidence without context even when corroborated reader evidence is available", async () => {
    fixture.community = [{ venueId: "venue-d", drinkCategory: "wine", priceGbp: 6.25,
      submittedAt: NOW, source: "community", corroborations: 2 }];
    const hint = { category: "wine", pence: 625, serving: null, source: "community", reportedAt: new Date(NOW).toISOString() };
    const body = await create(submitted(hint));
    expect(body.plan.stops[0].alternatives).toEqual([
      { venueId: "venue-d", venueName: "Canonical d" }, { venueId: "venue-e", venueName: "Canonical e" },
    ]);
  });

  it("keeps corroborated community backup evidence with matching explicit context", async () => {
    fixture.community = [{ venueId: "venue-d", drinkCategory: "wine", priceGbp: 6.25,
      submittedAt: NOW, source: "community", corroborations: 2 }];
    const hint = { category: "wine", pence: 625, serving: null, source: "community", reportedAt: new Date(NOW).toISOString() };
    const context = { ...inferNightContext("wine").context, nightArea: "piccadilly-soho", drinkCategory: "wine" };
    const body = await create(submitted(hint), context);
    expect(body.plan.stops[0].alternatives).toEqual([
      { venueId: "venue-d", venueName: "Canonical d", selectedDrinkPriceEvidence: hint },
      { venueId: "venue-e", venueName: "Canonical e" },
    ]);
  });

  it("revalidates replacement backups with absent stored/requested context and rejects stale revision", async () => {
    const body = await create();
    const id = body.plan.plan.id;
    const result = await patch(id, body.memberToken, { expectedRouteRevision: 1, stops: submitted() });
    expect(result.stops[0].alternatives).toEqual([backup, { venueId: "venue-e", venueName: "Canonical e" }]);
    expect((await memberRead(id, body.memberToken)).stops[0].alternatives).toEqual(result.stops[0].alternatives);
    const stale = await PATCH(request(`/${id}`, "PATCH", { expectedRouteRevision: 1, stops: submitted() }, body.memberToken),
      { params: Promise.resolve({ id }) });
    expect(stale.status).toBe(409);
    expect((await memoryPlanStore.get(id))?.plan.routeRevision).toBe(2);
  });

  it.each([{ drinkCategory: "gin", zeroProof: false }, { drinkCategory: "wine", zeroProof: true }] as const)(
    "drops incompatible backup price but keeps canonical option on explicit intent $drinkCategory/$zeroProof", async (change) => {
      const body = await create(submitted());
      const context = { ...inferNightContext("wine").context, nightArea: "piccadilly-soho", ...change };
      const result = await patch(body.plan.plan.id, body.memberToken, { context });
      expect(result.stops[0].alternatives).toEqual([
        { venueId: "venue-d", venueName: "Canonical d" }, { venueId: "venue-e", venueName: "Canonical e" },
      ]);
    });

  it.each([false, true])("preserves proposal backups using locked context rather than its old price snapshot (zeroProof=%s)", async (zeroProof) => {
    const body = await create();
    const id = body.plan.plan.id;
    const response = await propose(request(`/${id}/proposals`, "POST", { expectedRouteRevision: 1,
      reason: "Keep canonical backups", stops: submitted() }, body.memberToken), { params: Promise.resolve({ id }) });
    const proposed = await response.json();
    expect(response.status, JSON.stringify(proposed)).toBe(201);
    expect(proposed.proposal.stops[0].alternatives).toEqual([backup, { venueId: "venue-e", venueName: "Canonical e" }]);
    if (zeroProof) await patch(id, body.memberToken, { context: { ...inferNightContext("wine").context,
      nightArea: "piccadilly-soho", drinkCategory: "wine", zeroProof: true } });
    const decision = await decide(request(`/${id}/proposals/${proposed.proposal.id}/decision`, "POST", { decision: "accepted" }, body.memberToken),
      { params: Promise.resolve({ id, proposalId: proposed.proposal.id }) });
    expect(decision.status).toBe(200);
    expect((await memberRead(id, body.memberToken)).stops[0].alternatives).toEqual([
      { venueId: "venue-d", venueName: "Canonical d", ...(!zeroProof ? { selectedDrinkPriceEvidence: quote } : {}) },
      { venueId: "venue-e", venueName: "Canonical e" },
    ]);
  });

  it("replays an existing create key after backup support keeps the deployed hash shape", async () => {
    const idempotencyKey = "saved-backup-historical-create";
    const startTime = "2026-09-30T19:00:00Z";
    const oldIdempotencyStops = [
      { venueId: "venue-d", venueName: "Canonical d", selectedDrinkPriceEvidence: quote },
      { venueId: "venue-b", venueName: "Canonical b" },
      { venueId: "venue-c", venueName: "Canonical c" },
    ];
    const seeded = await memoryPlanStore.create({
      creatorName: "Host",
      startTime,
      stops: oldIdempotencyStops,
    }, { idempotencyKey, idempotencyStops: oldIdempotencyStops });
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) throw new Error(`Could not seed historical Plan: ${seeded.error}`);

    const response = await createPlan(new Request("http://localhost/api/plans", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
      body: JSON.stringify({
        creatorName: "Host",
        startTime,
        stops: [
          { venueId: "venue-d", selectedDrinkPriceEvidence: quote },
          { venueId: "venue-b" },
          { venueId: "venue-c" },
        ],
      }),
    }));
    const replay = await response.json();
    expect(response.status, JSON.stringify(replay)).toBe(201);
    expect(replay).toMatchObject({ created: false, plan: { plan: { id: seeded.plan.plan.id, routeRevision: 1 } } });
    expect(replay.plan.stops).toEqual(seeded.plan.stops);
  });
});
