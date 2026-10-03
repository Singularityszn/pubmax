import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const fixtures = vi.hoisted(() => ({
  rows: [] as import("@/lib/ukPriceBundle").UkPriceBundleRow[],
  status: "ready" as "ready" | "empty" | "unavailable",
  venues: [] as import("@/lib/concierge/rank").ConciergeVenue[],
  community: [] as import("@/lib/communityPrice").CommunityPrice[],
  anchor: vi.fn(),
}));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/authServer", () => ({ callerUserId: async () => null }));
// Synthetic signing prerequisite only. No environment or live credentials.
vi.mock("@/lib/trustedSigningKey.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/trustedSigningKey.server")>();
  return { ...actual, trustedSigningKey: () => Buffer.alloc(32, 7) };
});
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: async () => false };
});
vi.mock("@/lib/concierge/venues.server", () => ({ loadConciergeVenues: async () => fixtures.venues }));
vi.mock("@/lib/planningAnchor.server", () => ({ resolvePlanningAnchor: fixtures.anchor }));
vi.mock("@/lib/ukBaseIndex", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ukBaseIndex")>();
  return { ...actual, lookupUkBasePub: async (id: string) => id === "venue-uk-n8308248176"
    ? { status: "ready" as const, pub: { id, name: "The Sydney Arms", kind: "pub" as const,
      address: "70, Sydney Street, London, SW3 6NJ", lat: 51.48876, lng: -0.16951, curatedVenueId: "" } }
    : { status: "missing" as const } };
});
vi.mock("@/lib/ukPriceBundle.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ukPriceBundle.server")>();
  const { listedCategoryPrices } = await import("@/lib/listedCategoryPrices");
  return {
    ...actual,
    ukPriceBundleRowsFor: async (id: string) => ({ status: fixtures.status,
      rows: fixtures.rows.filter((row) => row.venueId === id) }),
    ukPriceBundleCategoryIndex: async (category: import("@/lib/drinks").DrinkCategory,
      now: number, serving?: string | null, drinkSubtype?: string | null) => ({
      prices: [...new Set(fixtures.rows.map((row) => row.venueId))].flatMap((venueId) =>
        listedCategoryPrices(fixtures.rows.filter((row) => row.venueId === venueId), now,
          { serving, drinkSubtype }).filter((quote) => quote.category === category)
          .map((quote) => ({ venueId, ...quote }))),
      degraded: fixtures.status === "unavailable", truncated: false,
    }),
  };
});
vi.mock("@/lib/communityPriceStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/communityPriceStore")>();
  return { ...actual, readCommunityPriceCategoryIndex: async () => ({
    prices: fixtures.community, degraded: false, truncated: false,
  }) };
});
vi.mock("@/public/data/weather/latest.json", () => ({
  default: { version: 1, generatedAt: "2026-01-01T00:00:00.000Z", observations: [] },
}));

import { POST as CREATE } from "@/app/api/plans/route";
import { GET as READ, PATCH as REPLACE } from "@/app/api/plans/[id]/route";
import { composerCreatePayload } from "@/components/plan/PlanComposer";
import { listedCategoryPrices } from "@/lib/listedCategoryPrices";
import { readListedDrinkIndex, type MapLensPrice } from "@/lib/mapExperienceLens";
import { inferNightContext } from "@/lib/nightPlanning";
import { readPlanningIntent, writePlanningIntent, type PlanningIntentStorage } from "@/lib/planningIntent";
import { readPlanDraftEnvelope, writePlanDraftEnvelope } from "@/lib/planDraft";
import { buildPlanGenerationStops } from "@/lib/planGenerationDto";
import { preparePlanGeneration } from "@/lib/planGeneration.server";
import { planStopEvidenceForContext, selectedDrinkPriceEvidenceForPrice } from "@/lib/planSelectedDrinkPriceEvidence";
import { __resetMemoryPlans, memoryPlanStore } from "@/lib/planStore";
import { __resetPlanCollaboration, planCollaborationStore } from "@/lib/planCollaborationStore";
import type { PlanState } from "@/lib/plan";
import type { ConciergeVenue } from "@/lib/concierge/rank";
import type { UkPriceBundleRow } from "@/lib/ukPriceBundle";

const NOW = Date.parse("2026-10-03T12:00:00.000Z");
const OBSERVED = "2026-09-29T10:40:17.846Z";
const SYDNEY = "venue-uk-n8308248176";
const MENU = "https://www.sydneyarmschelsea.com/menu/";
// These three labels, prices, measure, source and observation are recorded
// Sydney menu rows. Other venues below are controlled business fixtures.
const WHITE = { category: "wine" as const, pence: 550, serving: "125ml", source: "listed" as const,
  sourceUrl: MENU, observedAt: OBSERVED, drinkLabel: "Chardonnay, Pays D’oc, France", drinkSubtype: "wine-white" as const };
const MERLOT = { ...WHITE, drinkLabel: "Merlot, Pays D’Oc, France", drinkSubtype: "wine-red" as const };
const LEGACY = { category: "wine" as const, pence: 525, serving: "125ml", source: "listed" as const,
  sourceUrl: MENU, observedAt: OBSERVED };
const NEXT = { ...WHITE, pence: 625, sourceUrl: "https://next.example/menu",
  drinkLabel: "Sauvignon Blanc", drinkSubtype: "wine-white" as const };
const ENDING = { kind: "get_home" as const, optionId: "walk",
  evidenceSnapshot: { label: "Walk home", confidence: "unknown" as const } };

function wineContext() {
  return { ...inferNightContext("wine").context, nightArea: "clapham" as const,
    drinkCategory: "wine" as const, budget: "value" as const };
}

function menuRow(venueId: string, label: string, priceGbp: number, sourceUrl = MENU): UkPriceBundleRow {
  return { venueId, name: venueId === SYDNEY ? "The Sydney Arms" : "Controlled next pub", category: "wine",
    priceGbp, lane: "site-harvest", standing: "listed", sourceUrl,
    publisher: new URL(sourceUrl).hostname, observedAt: OBSERVED, basis: null, sampleSize: null,
    servingSize: "125ml", drinkLabel: label };
}

function venue(id: string, index: number): ConciergeVenue {
  // Synthetic Clapham coordinates isolate scoring. Not evidence that Sydney
  // lies within Clapham or that an actual Sydney crawl is route-ready.
  return { id, name: id === SYDNEY ? "The Sydney Arms" : `Controlled pub ${id}`, area: "Clapham",
    lat: 51.462 + index * 0.001, lng: -0.138 + index * 0.001, cheapestPrice: 1,
    amenities: { beerGarden: false, cocktails: false, food: false, liveSports: false, liveMusic: false },
    nearWater: false, hasStory: false, canonical: true };
}

function storage(): PlanningIntentStorage {
  const values = new Map<string, string>();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); } };
}

function mapWhite(): MapLensPrice {
  const prices = listedCategoryPrices(fixtures.rows.filter((row) => row.venueId === SYDNEY), NOW,
    { drinkSubtype: "wine-white", serving: "125ml" });
  const quote = readListedDrinkIndex(prices.map((price) => ({ venueId: SYDNEY, ...price })), "wine", "wine-white")[0];
  if (!quote) throw new Error("Controlled Map input has no White wine quote");
  return quote;
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const submittedStops = (hint: unknown) => [
  { venueId: SYDNEY, venueName: "Untrusted caller name", selectedDrinkPriceEvidence: hint },
  { venueId: "next-pub", selectedDrinkPriceEvidence: NEXT },
  { venueId: "third-pub" },
];

async function create(hint: unknown = WHITE, key = "named-delivery-create", context: unknown = wineContext()) {
  const response = await CREATE(new Request("http://localhost/api/plans", { method: "POST",
    headers: { "idempotency-key": key, "content-type": "application/json" },
    body: JSON.stringify({ creatorName: "Host", startTime: "2026-10-03T19:00:00.000Z",
      context, stops: submittedStops(hint) }) }));
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(201);
  return body as { plan: PlanState; memberToken: string };
}

function replace(id: string, token: string, revision: number, hint: unknown) {
  return REPLACE(new Request(`http://localhost/api/plans/${id}`, { method: "PATCH",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ expectedRouteRevision: revision, stops: submittedStops(hint) }) }), ctx(id));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  __resetMemoryPlans();
  __resetPlanCollaboration();
  fixtures.status = "ready";
  fixtures.community = [];
  fixtures.venues = [venue(SYDNEY, 0), venue("next-pub", 1), venue("third-pub", 2), venue("red-only", 3)];
  fixtures.rows = [menuRow(SYDNEY, WHITE.drinkLabel, 5.5), menuRow(SYDNEY, MERLOT.drinkLabel, 5.5),
    menuRow(SYDNEY, "Rioja, Spain", 5.25), menuRow("next-pub", NEXT.drinkLabel, 6.25, NEXT.sourceUrl),
    menuRow("next-pub", "Rioja", 1, NEXT.sourceUrl), menuRow("red-only", "Rioja", 0.5)];
  fixtures.anchor.mockReset();
  fixtures.anchor.mockResolvedValue({ status: "resolved", display: { venueId: SYDNEY,
    venueName: "The Sydney Arms", areaName: "Clapham", startLabel: null, priceEvidence: null,
    routeWindowOk: true, budgetCompatible: true, accessibilityCompatible: true },
    canonical: { cityId: "london", venueId: SYDNEY, nightAreaSlug: "clapham-high-street",
      acceptedArea: { kind: "night-patch", id: "clapham" }, coordinates: { lat: 51.462, lng: -0.138 },
      startsAt: null, priceObservedAt: null, priceFreshnessKind: "unknown" } });
});
afterEach(() => { __resetMemoryPlans(); __resetPlanCollaboration(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("named listed drink delivery", () => {
  it("carries actual selected Map quote through intent, reloaded draft and Composer save", async () => {
    const selected = selectedDrinkPriceEvidenceForPrice(mapWhite(), wineContext());
    expect(selected).toEqual(WHITE);
    const local = storage();
    const written = writePlanningIntent({ source: "map-search", cityId: "london", acceptedVenueId: SYDNEY,
      acceptedArea: null, startsAt: null, displayEvidence: { kind: "price", observedAt: OBSERVED },
      selectedDrinkPriceEvidence: selected! }, { storage: local, now: NOW });
    expect(written).not.toBeNull();
    const intent = readPlanningIntent({ storage: local, now: NOW + 1 });
    expect(intent?.selectedDrinkPriceEvidence).toEqual(WHITE);
    if (!intent) throw new Error("Named Map intent was lost before draft creation");
    const result = writePlanDraftEnvelope({ title: "White wine", creatorName: "Host", startTime: "",
      conciergeQuery: "", stops: [{ key: 1, venueId: SYDNEY, venueName: "The Sydney Arms" }],
      acceptedAnchor: { venueId: intent.acceptedVenueId, source: intent.source, cityId: intent.cityId,
        acceptedArea: intent.acceptedArea, startsAt: intent.startsAt, expiresAt: intent.expiresAt,
        selectedDrinkPriceEvidence: intent.selectedDrinkPriceEvidence } }, "planning-intent", local, NOW + 1);
    expect(result.v2).toBe(true);
    const reloaded = readPlanDraftEnvelope(local, NOW + 2);
    expect(reloaded?.draft.acceptedAnchor?.selectedDrinkPriceEvidence).toEqual(WHITE);
    const payload = composerCreatePayload({ title: "White wine", creatorName: "Host",
      startTime: "2026-10-03T19:00:00.000Z", context: wineContext(),
      stops: [
        { venueId: SYDNEY, venueName: "The Sydney Arms", selectedDrinkPriceEvidence: reloaded?.draft.acceptedAnchor?.selectedDrinkPriceEvidence },
        { venueId: "next-pub", venueName: "Controlled pub next-pub", selectedDrinkPriceEvidence: NEXT },
        { venueId: "third-pub", venueName: "Controlled pub third-pub" },
      ] });
    const response = await CREATE(new Request("http://localhost/api/plans", { method: "POST",
      headers: { "idempotency-key": "named-map-draft-save", "content-type": "application/json" }, body: JSON.stringify(payload) }));
    expect(response.status).toBe(201);
    const saved = await response.json();
    expect((await memoryPlanStore.get(saved.plan.plan.id))?.stops[0]?.selectedDrinkPriceEvidence).toEqual(WHITE);
  });

  it("admits exact named wire intent without allowing private fields or extending its expiry", () => {
    const local = storage();
    const input = { source: "map-search" as const, cityId: "london" as const, acceptedVenueId: SYDNEY,
      acceptedArea: null, startsAt: null, displayEvidence: { kind: "price" as const, observedAt: OBSERVED },
      selectedDrinkPriceEvidence: WHITE };
    const intent = writePlanningIntent(input, { storage: local, now: NOW });
    expect(intent?.selectedDrinkPriceEvidence).toEqual(WHITE);
    expect(readPlanningIntent({ storage: local, now: NOW + 2 * 60 * 60 * 1000 })).toBeNull();
    const extraField = { ...WHITE, privateGps: [51, -0.1] };
    expect(writePlanningIntent({ ...input, selectedDrinkPriceEvidence: extraField },
      { storage: local, now: NOW })).toBeNull();
  });

  it("saves verified White instead of cheaper Red, reloads exact identity only for members", async () => {
    const saved = await create();
    const id = saved.plan.plan.id;
    expect(saved.plan.stops[0]).toMatchObject({ venueId: SYDNEY, venueName: "The Sydney Arms" });
    expect(saved.plan.stops[0]?.selectedDrinkPriceEvidence).toEqual(WHITE);
    expect(saved.plan.stops[1]?.selectedDrinkPriceEvidence).toEqual(NEXT);
    const member = await READ(new Request(`http://localhost/api/plans/${id}`,
      { headers: { authorization: `Bearer ${saved.memberToken}` } }), ctx(id));
    expect(member.status).toBe(200);
    expect((await member.json()).stops[0]?.selectedDrinkPriceEvidence).toEqual(WHITE);
    for (const token of [undefined, "wrong-member-capability"]) {
      const preview = await READ(new Request(`http://localhost/api/plans/${id}`,
        { headers: token ? { authorization: `Bearer ${token}` } : {} }), ctx(id));
      const body = await preview.json();
      expect(body.visibility).toBe("preview");
      expect(body).not.toHaveProperty("stops");
      expect(JSON.stringify(body)).not.toContain(WHITE.drinkLabel);
      expect(JSON.stringify(body)).not.toContain(MENU);
      expect(JSON.stringify(body)).not.toContain(SYDNEY);
    }
  });

  it.each([
    ["same-price Red label falsely tagged White", { ...MERLOT, drinkSubtype: "wine-white" }],
    ["incomplete named identity", { ...LEGACY, drinkLabel: WHITE.drinkLabel }],
    ["changed observation", { ...WHITE, observedAt: "2026-09-28T10:40:17.846Z" }],
  ])("does not store %s", async (_description, hint) => {
    const saved = await create(hint);
    expect(saved.plan.stops[0]?.selectedDrinkPriceEvidence).toBeUndefined();
    expect((await memoryPlanStore.get(saved.plan.plan.id))?.stops[0]?.selectedDrinkPriceEvidence).toBeUndefined();
  });

  it("replays original named authority without recapture and detects same-price identity changes", async () => {
    const original = await create();
    fixtures.status = "unavailable";
    const replay = await create();
    expect(replay.plan.plan.id).toBe(original.plan.plan.id);
    expect(replay.plan.stops[0]?.selectedDrinkPriceEvidence).toEqual(WHITE);
    const changed = await CREATE(new Request("http://localhost/api/plans", { method: "POST",
      headers: { "idempotency-key": "named-delivery-create", "content-type": "application/json" },
      body: JSON.stringify({ creatorName: "Host", startTime: "2026-10-03T19:00:00.000Z",
        context: wineContext(), stops: submittedStops(MERLOT) }) }));
    expect(changed.status).toBe(409);
    expect((await memoryPlanStore.get(original.plan.plan.id))?.stops[0]?.selectedDrinkPriceEvidence).toEqual(WHITE);
  });

  it("verifies exact White label independently of a cheaper same-subtype White", async () => {
    fixtures.rows = [menuRow(SYDNEY, "Sauvignon Blanc", 5.25), menuRow(SYDNEY, WHITE.drinkLabel, 5.5)];
    const saved = await create();
    expect(saved.plan.stops[0]?.selectedDrinkPriceEvidence).toEqual(WHITE);
  });

  it("distinguishes two White labels sharing every legacy field and refuses absent equal-price labels", async () => {
    fixtures.rows = [menuRow(SYDNEY, "Sauvignon Blanc", 5.5), menuRow(SYDNEY, WHITE.drinkLabel, 5.5)];
    const sauvignon = { ...WHITE, drinkLabel: "Sauvignon Blanc" };
    expect((await create(WHITE, "equal-white-chardonnay")).plan.stops[0]?.selectedDrinkPriceEvidence).toEqual(WHITE);
    expect((await create(sauvignon, "equal-white-sauvignon")).plan.stops[0]?.selectedDrinkPriceEvidence).toEqual(sauvignon);
    const absent = { ...WHITE, drinkLabel: "Chenin Blanc" };
    expect((await create(absent, "equal-white-absent")).plan.stops[0]?.selectedDrinkPriceEvidence).toBeUndefined();
  });

  it("does not borrow anchor's White label for another pub with an otherwise identical White quote", async () => {
    fixtures.rows = [menuRow(SYDNEY, WHITE.drinkLabel, 5.5), menuRow("next-pub", "Sauvignon Blanc", 5.5)];
    const response = await CREATE(new Request("http://localhost/api/plans", { method: "POST",
      headers: { "idempotency-key": "named-per-venue-label", "content-type": "application/json" },
      body: JSON.stringify({ creatorName: "Host", startTime: "2026-10-03T19:00:00.000Z", context: wineContext(),
        stops: [{ venueId: SYDNEY, selectedDrinkPriceEvidence: WHITE },
          { venueId: "next-pub", selectedDrinkPriceEvidence: WHITE }, { venueId: "third-pub" }] }) }));
    expect(response.status).toBe(201);
    const saved = await response.json();
    expect(saved.plan.stops[0]?.selectedDrinkPriceEvidence).toEqual(WHITE);
    expect(saved.plan.stops[1]?.selectedDrinkPriceEvidence).toBeUndefined();
  });

  it("does not revive an old exact label before case-insensitive same-drink supersession", async () => {
    fixtures.rows = [menuRow(SYDNEY, WHITE.drinkLabel, 5.5),
      { ...menuRow(SYDNEY, WHITE.drinkLabel.toUpperCase(), 6), observedAt: "2026-10-02T10:40:17.846Z" }];
    expect((await create()).plan.stops[0]?.selectedDrinkPriceEvidence).toBeUndefined();
  });

  it("verifies an exact White label beyond four same-subtype unknown-measure rows without broadening generic cap", async () => {
    fixtures.rows = ["Sauvignon Blanc", "Pinot Grigio", "Riesling", "Albarino", "Chenin Blanc", WHITE.drinkLabel]
      .map((label) => ({ ...menuRow(SYDNEY, label, 5.5), servingSize: undefined }));
    const generic = listedCategoryPrices(fixtures.rows, NOW, { drinkSubtype: "wine-white" });
    expect(generic).toHaveLength(4);
    expect(generic.some((quote) => quote.drinkLabel === WHITE.drinkLabel)).toBe(false);
    const selected = { ...WHITE, serving: null };
    expect((await create(selected)).plan.stops[0]?.selectedDrinkPriceEvidence).toEqual(selected);
  });

  it("replaces with actual same-price Merlot while enforcing host capability and revision", async () => {
    const saved = await create();
    const id = saved.plan.plan.id;
    expect((await replace(id, "wrong-member-capability", 1, MERLOT)).status).toBe(403);
    const replaced = await replace(id, saved.memberToken, 1, MERLOT);
    expect(replaced.status).toBe(200);
    expect((await replaced.json()).stops[0]?.selectedDrinkPriceEvidence).toEqual(MERLOT);
    expect((await replace(id, saved.memberToken, 1, WHITE)).status).toBe(409);
    const reloaded = await memoryPlanStore.get(id);
    expect(reloaded?.plan.routeRevision).toBe(2);
    expect(reloaded?.stops[0]?.selectedDrinkPriceEvidence).toEqual(MERLOT);
    expect(reloaded?.stops[1]?.selectedDrinkPriceEvidence).toEqual(NEXT);
  });

  it.each(["zero-proof", "changed category"] as const)("clears incompatible named quotes on %s context", async (kind) => {
    const saved = await create();
    expect(saved.plan.stops[0]?.selectedDrinkPriceEvidence).toEqual(WHITE);
    const context = { ...wineContext(), ...(kind === "zero-proof" ? { zeroProof: true } : { drinkCategory: "gin" }) };
    const response = await REPLACE(new Request(`http://localhost/api/plans/${saved.plan.plan.id}`, { method: "PATCH",
      headers: { authorization: `Bearer ${saved.memberToken}`, "content-type": "application/json" },
      body: JSON.stringify({ context }) }), ctx(saved.plan.plan.id));
    expect(response.status).toBe(200);
    expect((await memoryPlanStore.get(saved.plan.plan.id))?.stops.every((stop) => !stop.selectedDrinkPriceEvidence)).toBe(true);
  });

  it("delivers verified guest proposal once through host acceptance without label borrowing", async () => {
    const saved = await create(null);
    const id = saved.plan.plan.id;
    const joined = await memoryPlanStore.join(id, "Guest", { collaborationAuthorized: true });
    if (!joined.ok) throw new Error("Controlled guest join failed");
    const collaboration = planCollaborationStore();
    const input = { reason: "Keep selected White", expectedRouteRevision: 1,
      stops: saved.plan.stops.map((stop, position) => ({ ...stop,
        ...(position === 0 ? { selectedDrinkPriceEvidence: WHITE } : position === 1 ? { selectedDrinkPriceEvidence: NEXT } : {}) })),
      resolvedConstraintIds: [], idempotencyKey: "named-proposal" };
    expect(await collaboration.createProposal(id, "wrong-member-capability", input)).toMatchObject({ ok: false, error: "forbidden" });
    const proposed = await collaboration.createProposal(id, joined.memberToken, input);
    if (!proposed.ok) throw new Error(`Controlled proposal failed: ${proposed.error}`);
    expect(proposed.proposal.stops[0]?.selectedDrinkPriceEvidence).toEqual(WHITE);
    expect(proposed.proposal.stops[1]?.selectedDrinkPriceEvidence).toEqual(NEXT);
    fixtures.status = "unavailable";
    const replay = await collaboration.createProposal(id, joined.memberToken, input);
    expect(replay).toEqual(proposed);
    const apply = vi.fn(async (proposal: typeof proposed.proposal) =>
      (await memoryPlanStore.update(id, saved.memberToken, { stops: proposal.stops,
        expectedRouteRevision: proposal.expectedRouteRevision })).ok);
    expect(await collaboration.decideProposal(id, joined.memberToken, proposed.proposal.id,
      "accepted", "named-guest-decision", apply)).toMatchObject({ ok: false, error: "forbidden" });
    expect(await collaboration.decideProposal(id, saved.memberToken, proposed.proposal.id,
      "accepted", "named-host-decision", apply)).toMatchObject({ ok: true });
    expect(await collaboration.decideProposal(id, saved.memberToken, proposed.proposal.id,
      "accepted", "named-host-decision", apply)).toMatchObject({ ok: true });
    expect(apply).toHaveBeenCalledTimes(1);
    const state = await memoryPlanStore.get(id);
    expect(state?.plan.routeRevision).toBe(2);
    expect(state?.stops[0]?.selectedDrinkPriceEvidence).toEqual(WHITE);
    expect(state?.stops[1]?.selectedDrinkPriceEvidence).toEqual(NEXT);
  });

  it("snapshots saved named quotes only after qualifying arrival and preserves completed revision", async () => {
    const saved = await create();
    const id = saved.plan.plan.id;
    const input = { expectedRouteRevision: 1, ending: "get_home" as const, endingSelection: ENDING };
    expect(await memoryPlanStore.complete(id, "wrong-member-capability", input)).toMatchObject({ ok: false, error: "forbidden" });
    expect(await memoryPlanStore.complete(id, saved.memberToken, input)).toMatchObject({ ok: false, error: "arrival_required" });
    expect((await memoryPlanStore.addAction(id, saved.memberToken, { type: "arrived", stopPosition: 0,
      idempotencyKey: "named-arrival" })).ok).toBe(true);
    expect(await memoryPlanStore.complete(id, saved.memberToken, { ...input, expectedRouteRevision: 2 }))
      .toMatchObject({ ok: false, error: "conflict" });
    const completed = await memoryPlanStore.complete(id, saved.memberToken, input);
    if (!completed.ok) throw new Error(`Controlled completion failed: ${completed.error}`);
    expect(completed.completion.routeSnapshot[0]?.selectedDrinkPriceEvidence).toEqual(WHITE);
    expect(completed.completion.routeSnapshot[1]?.selectedDrinkPriceEvidence).toEqual(NEXT);
    expect(completed.completion.routeRevision).toBe(1);
    fixtures.rows = [];
    expect(await memoryPlanStore.update(id, saved.memberToken, { stops: saved.plan.stops.map((stop) =>
      ({ ...stop, selectedDrinkPriceEvidence: MERLOT })), expectedRouteRevision: 1 })).toMatchObject({ ok: false });
    const replay = await memoryPlanStore.complete(id, saved.memberToken, input);
    expect(replay).toMatchObject({ ok: true, created: false, completion: completed.completion });
    expect((await memoryPlanStore.getCompletion(id))?.routeSnapshot[0]?.selectedDrinkPriceEvidence).toEqual(WHITE);
  });

  it("preserves legacy six-field and community five-field delivery", async () => {
    const legacy = await create(LEGACY, "legacy-delivery");
    expect(legacy.plan.stops[0]?.selectedDrinkPriceEvidence).toEqual(LEGACY);
    const community = { category: "wine" as const, pence: 700, serving: null,
      source: "community" as const, reportedAt: new Date(NOW).toISOString() };
    fixtures.community = [{ venueId: SYDNEY, drinkCategory: "wine", priceGbp: 7,
      submittedAt: NOW, source: "community", corroborations: 2 }];
    const saved = await create(community, "community-delivery");
    expect(saved.plan.stops[0]?.selectedDrinkPriceEvidence).toEqual(community);
    const unnamedMapQuote = { ...mapWhite(), drinkLabel: null };
    expect(selectedDrinkPriceEvidenceForPrice(unnamedMapQuote, wineContext())).toEqual({
      ...LEGACY, pence: 550,
    });
  });

  it("keeps verified accepted White in actual generation scoring and stop DTO, with each other pub's own quote", async () => {
    fixtures.rows.push(menuRow(SYDNEY, "Sauvignon Blanc", 5.25));
    const result = await preparePlanGeneration(new Request("http://localhost/api/plans/generate", { method: "POST",
      body: JSON.stringify({ context: wineContext(), operationKey: "named-generation",
        anchor: { venueId: SYDNEY, source: "map-search", acceptedArea: { kind: "night-patch", id: "clapham" },
          startsAt: null, selectedDrinkPriceEvidence: WHITE } }) }), NOW);
    expect("prepared" in result).toBe(true);
    if (!("prepared" in result)) throw new Error(`Named generation refused: ${await result.response.text()}`);
    const { prepared } = result;
    const anchor = prepared.candidates.find((candidate) => candidate.venue.id === SYDNEY);
    const next = prepared.candidates.find((candidate) => candidate.venue.id === "next-pub");
    const third = prepared.candidates.find((candidate) => candidate.venue.id === "third-pub");
    const redOnly = prepared.candidates.find((candidate) => candidate.venue.id === "red-only");
    expect(anchor?.selectedDrinkPrice).toMatchObject({ priceGbp: 5.5, drinkLabel: WHITE.drinkLabel, servingSize: "125ml" });
    expect(anchor?.reasons).toContain("listed 125ml wine price £5.50");
    expect(anchor?.reasons).not.toContain("listed 125ml wine price £5.25");
    expect(next?.selectedDrinkPrice).toMatchObject({ priceGbp: 6.25, drinkLabel: NEXT.drinkLabel });
    expect(next?.reasons).toContain("listed 125ml wine price £6.25");
    expect(redOnly?.selectedDrinkPrice).toBeNull();
    expect(redOnly?.reasons.some((reason) => reason.includes("wine price"))).toBe(false);
    if (!anchor || !next || !third) throw new Error("Controlled named candidates missing");
    const stops = buildPlanGenerationStops({ chosen: [anchor, next, third], candidates: prepared.candidates,
      groundedStops: null, groundedAlternatives: null, walkingEstimate: { legs: [], walkingMinutesFromPrevious: [null, 4, 4] },
      area: prepared.area, planningWeather: prepared.planningWeather, priceContext: prepared.context });
    expect(stops[0]?.selectedDrinkPriceEvidence).toEqual(WHITE);
    expect(stops[1]?.selectedDrinkPriceEvidence).toEqual(NEXT);
    expect(stops.every((stop) => stop.estimatedPintPricePence === null && stop.priceEvidence === null)).toBe(true);
    const response = await CREATE(new Request("http://localhost/api/plans", { method: "POST",
      headers: { "idempotency-key": "named-generated-save", "content-type": "application/json" },
      body: JSON.stringify({ title: "Generated White", creatorName: "Host",
        startTime: "2026-10-03T19:00:00.000Z", stops, context: prepared.context }) }));
    expect(response.status).toBe(201);
    const saved = await response.json();
    const reloaded = await memoryPlanStore.get(saved.plan.plan.id);
    expect(reloaded?.stops[0]?.selectedDrinkPriceEvidence).toEqual(WHITE);
    expect(reloaded?.stops[1]?.selectedDrinkPriceEvidence).toEqual(NEXT);
  });

  it("prices each pub only with its own quote for the requested White subtype and measure", async () => {
    const generate = async (operationKey: string, choice: Record<string, unknown>) => {
      const result = await preparePlanGeneration(new Request("http://localhost/api/plans/generate", { method: "POST",
        body: JSON.stringify({ context: { ...wineContext(), ...choice }, operationKey }) }), NOW);
      if (!("prepared" in result)) throw new Error(`Generation refused: ${await result.response.text()}`);
      const byVenue = new Map(result.prepared.candidates.map((candidate) => [candidate.venue.id, candidate]));
      return (venueId: string) => {
        const candidate = byVenue.get(venueId);
        return candidate ? selectedDrinkPriceEvidenceForPrice(candidate.selectedDrinkPrice, result.prepared.context) : undefined;
      };
    };
    const white = await generate("white-125", { drinkSubtype: "wine-white", drinkServing: "125ml" });
    expect(white(SYDNEY)).toEqual(WHITE);
    expect(white("next-pub")).toEqual(NEXT);
    expect(white("red-only")).toBeNull();
    const otherMeasure = await generate("wine-175", { drinkServing: "175ml" });
    for (const venueId of [SYDNEY, "next-pub", "red-only"]) expect(otherMeasure(venueId)).toBeNull();
    const saved = { venueId: SYDNEY, venueName: "The Sydney Arms", position: 0, selectedDrinkPriceEvidence: WHITE,
      alternatives: [{ venueId: "next-pub", venueName: "Controlled next pub", selectedDrinkPriceEvidence: NEXT }] };
    expect(planStopEvidenceForContext(saved, { ...wineContext(), drinkSubtype: "wine-red" })).toEqual({
      venueId: SYDNEY, venueName: "The Sydney Arms", position: 0,
      alternatives: [{ venueId: "next-pub", venueName: "Controlled next pub" }],
    });
    expect(planStopEvidenceForContext(saved, { ...wineContext(), drinkServing: "175ml" })).not.toHaveProperty("selectedDrinkPriceEvidence");
  });
});
