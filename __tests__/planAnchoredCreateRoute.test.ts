import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const committedPacks = vi.hoisted(() => ({ enabled: false }));

// Server pack fixture copied exactly from committed
// public/data/uk_base/packs/a917f46cc28c0e9e/51.25_-0.25.json.
// Only the existing UK identity reader is doubled; this pub is NEVER added to
// the curated venue/candidate catalogue and has no invented price or amenity.
const basePlanPack = vi.hoisted(() => ({
  result: { status: "missing" } as import("@/lib/ukBaseIndex").UkBasePubLookupResult,
  pub: { id: "venue-uk-n8308248176", name: "The Sydney Arms",
    address: "70, Sydney Street, London, SW3 6NJ", lat: 51.48876, lng: -0.16951,
    curatedVenueId: "", kind: "pub" as const },
}));
vi.mock("@/lib/ukBaseIndex", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ukBaseIndex")>();
  return { ...actual, lookupUkBasePub: async (id: string) =>
    committedPacks.enabled ? actual.lookupUkBasePub(id)
      : id === basePlanPack.pub.id ? basePlanPack.result : { status: "missing" as const } };
});

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: async () => false };
});
vi.mock("@/lib/concierge/venues.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/concierge/venues.server")>();
  return { loadConciergeVenues: async (cityId: import("@/lib/cities").CityId) =>
    committedPacks.enabled ? actual.loadConciergeVenues(cityId) : [
      { id: "venue-a", name: "Venue A" },
      { id: "venue-b", name: "Venue B" },
      { id: "venue-c", name: "Venue C" },
    ] };
});

import { composerCreatePayload } from "@/components/plan/PlanComposer";
import { POST as CREATE } from "@/app/api/plans/route";
import { GET, PATCH } from "@/app/api/plans/[id]/route";
import {
  PLAN_GROUNDING_PROOF_TTL_MS,
  mintPlanGroundingProof,
  mintPlanGroundingProofV2,
} from "@/lib/planGrounding.server";
import { __resetMemoryPlans } from "@/lib/planStore";

const URL = "http://localhost/api/plans";
const OP = "op-anchor-lock-01";

function anchorOnlyProof(operationKey = OP): string {
  return mintPlanGroundingProofV2({
    routeVenueIds: ["venue-a"],
    allowedVenueIds: ["venue-a"],
    anchorVenueId: "venue-a",
    anchorSource: "near",
    outcome: "anchor-only",
    operationKey,
  });
}

function create(body: Record<string, unknown>, idempotencyKey = OP): Promise<Response> {
  return CREATE(new Request(URL, {
    method: "POST",
    headers: { "idempotency-key": idempotencyKey, "content-type": "application/json" },
    body: JSON.stringify({
      title: "Tonight",
      startTime: "2026-07-24T19:00:00.000Z",
      creatorName: "Host",
      ...body,
    }),
  }));
}

const ANCHOR = { venueId: "venue-a", source: "near", outcome: "anchor-only" };

describe("POST /api/plans — anchored lock", () => {
  beforeEach(() => { __resetMemoryPlans(); });
  afterEach(() => { __resetMemoryPlans(); });

  it("persists a one-Stop draft and emits plan_draft_saved, never plan_accepted", async () => {
    const context = {
      nightArea: "piccadilly-soho", daypart: "evening", partyType: "friends", groupSize: 2,
      stopCount: 3, budget: "value", budgetLimitPence: null, zeroProof: false,
      drinkCategory: null,
      wetherspoonsPreferred: false, atmosphere: [], foodNeeds: [], accessibility: [], transportConstraints: [],
    };
    const response = await create({
      stops: [{ venueId: "venue-a", venueName: "A" }],
      groundingProof: anchorOnlyProof(),
      anchor: ANCHOR,
      context,
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.plan.plan).toMatchObject({ outcome: "anchor-only", routeReadyAt: null });
    expect(body.plan.stops).toHaveLength(1);
    expect(body.plan.context).toEqual(context);
    expect(body.eventTokens.planDraftSaved).toEqual(expect.any(String));
    expect(body.eventTokens.planDraftSaved.length).toBeGreaterThan(0);
    expect(body.eventTokens.planAccepted).toBe("");
    expect(body.grounded).toBe(true);
  });

  it("maps each proof failure to an explicit 422", async () => {
    const [encoded, signature] = anchorOnlyProof().split(".");

    const missing = await create({ stops: [{ venueId: "venue-a", venueName: "A" }], anchor: ANCHOR });
    expect(missing.status).toBe(422);
    expect((await missing.json()).code).toBe("PLAN_ANCHOR_PROOF_MISSING");

    const tampered = await create({
      stops: [{ venueId: "venue-a", venueName: "A" }],
      groundingProof: `${encoded}.${signature}x`,
      anchor: ANCHOR,
    });
    expect(tampered.status).toBe(422);
    expect((await tampered.json()).code).toBe("PLAN_ANCHOR_PROOF_INVALID");

    // A proof minted for a different operation key cannot lock this Plan.
    const wrongOp = await create({
      stops: [{ venueId: "venue-a", venueName: "A" }],
      groundingProof: anchorOnlyProof("op-other-99"),
      anchor: ANCHOR,
    });
    expect(wrongOp.status).toBe(422);
    expect((await wrongOp.json()).code).toBe("PLAN_ANCHOR_PROOF_OPERATION_MISMATCH");

    // Route-order mismatch: proof covers only venue-a, Plan submits a different set.
    const mismatch = await create({
      stops: [{ venueId: "venue-b", venueName: "B" }],
      groundingProof: anchorOnlyProof(),
      anchor: { venueId: "venue-b", source: "near", outcome: "anchor-only" },
    });
    expect(mismatch.status).toBe(422);
    expect((await mismatch.json()).code).toBe("PLAN_ANCHOR_PROOF_ROUTE_MISMATCH");
  });

  it("rejects malformed submitted anchor metadata instead of creating a generic Plan", async () => {
    const response = await create({
      stops: [{ venueId: "venue-a", venueName: "A" }],
      groundingProof: anchorOnlyProof(),
      anchor: { venueId: "venue-a", source: "near" },
    });

    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe("PLAN_ANCHOR_INVALID");
  });

  it("rejects a signed V2 proof when anchor metadata is missing", async () => {
    const response = await create({
      stops: [{ venueId: "venue-a", venueName: "A" }],
      groundingProof: anchorOnlyProof(),
    });

    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe("PLAN_ANCHOR_REQUIRED");
  });

  it("locks a released night as an ordinary plan, keeping every stop", async () => {
    // Releasing a held pub drops the anchor AND its V2 proof, because the pair
    // is validated as one unit here: a kept proof with no anchor is refused,
    // which would leave a released night unlockable.
    const stops = [
      { venueId: "venue-a", venueName: "Venue A" },
      { venueId: "venue-b", venueName: "Venue B" },
      { venueId: "venue-c", venueName: "Venue C" },
    ];
    const released = composerCreatePayload({
      title: "Tonight",
      creatorName: "Host",
      startTime: "2026-07-24T19:00:00.000Z",
      stops,
      groundingProof: null,
      planAnchor: null,
    });
    expect(released).not.toHaveProperty("anchor");
    expect(released).not.toHaveProperty("groundingProof");

    const response = await create(released, "op-released-01");
    expect(response.status).toBe(201);
    expect((await response.json()).plan.stops).toHaveLength(3);

    const keptProof = await create(composerCreatePayload({
      title: "Tonight",
      creatorName: "Host",
      startTime: "2026-07-24T19:00:00.000Z",
      stops,
      groundingProof: anchorOnlyProof("op-released-02"),
      planAnchor: null,
    }), "op-released-02");
    expect(keptProof.status).toBe(422);
    expect((await keptProof.json()).code).toBe("PLAN_ANCHOR_REQUIRED");
  });

  it("rejects a submitted anchor Venue that differs from the signed proof", async () => {
    const response = await create({
      stops: [{ venueId: "venue-a", venueName: "A" }],
      groundingProof: anchorOnlyProof(),
      anchor: { venueId: "venue-b", source: "near", outcome: "anchor-only" },
    });

    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe("PLAN_ANCHOR_VENUE_MISMATCH");
  });

  it("rejects a submitted anchor source that differs from the signed proof", async () => {
    const response = await create({
      stops: [{ venueId: "venue-a", venueName: "A" }],
      groundingProof: anchorOnlyProof(),
      anchor: { venueId: "venue-a", source: "tonight", outcome: "anchor-only" },
    });

    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe("PLAN_ANCHOR_SOURCE_MISMATCH");
  });

  it("conflicts (409) when the same operation key relocks with a changed anchor", async () => {
    const first = await create({ stops: [{ venueId: "venue-a", venueName: "A" }], groundingProof: anchorOnlyProof(), anchor: ANCHOR });
    expect(first.status).toBe(201);
    // Same idempotency key, different anchor/proof → the store's request hash conflicts.
    const relock = await create({
      stops: [{ venueId: "venue-b", venueName: "B" }],
      groundingProof: mintPlanGroundingProofV2({
        routeVenueIds: ["venue-b"], allowedVenueIds: ["venue-b"], anchorVenueId: "venue-b",
        anchorSource: "near", outcome: "anchor-only", operationKey: OP,
      }),
      anchor: { venueId: "venue-b", source: "near", outcome: "anchor-only" },
    });
    expect(relock.status).toBe(409);
  });

  async function createDraft(): Promise<{ planId: string; memberToken: string }> {
    const response = await create({ stops: [{ venueId: "venue-a", venueName: "A" }], groundingProof: anchorOnlyProof(), anchor: ANCHOR });
    const body = await response.json();
    return { planId: body.plan.plan.id, memberToken: body.memberToken };
  }

  function routeProof(operationKey: string): string {
    return mintPlanGroundingProofV2({
      routeVenueIds: ["venue-a", "venue-b", "venue-c"],
      allowedVenueIds: ["venue-a", "venue-b", "venue-c"],
      anchorVenueId: "venue-a",
      anchorSource: "near",
      outcome: "route",
      operationKey,
    });
  }

  function patchUpgrade(planId: string, body: Record<string, unknown>): Promise<Response> {
    return PATCH(new Request(`http://localhost/api/plans/${planId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }), { params: Promise.resolve({ id: planId }) });
  }

  it("upgrades a one-Stop draft to a grounded route and emits plan_accepted once", async () => {
    const { planId, memberToken } = await createDraft();
    const upgraded = await patchUpgrade(planId, {
      memberToken,
      stops: [{ venueId: "venue-a", venueName: "A" }, { venueId: "venue-b", venueName: "B" }, { venueId: "venue-c", venueName: "C" }],
      expectedRouteRevision: 1,
      groundingProof: routeProof("op-upgrade-01"),
      operationKey: "op-upgrade-01",
    });
    expect(upgraded.status).toBe(200);
    const body = await upgraded.json();
    expect(body.plan.id).toBe(planId);
    expect(body.plan.outcome).toBe("route");
    expect(body.plan.routeReadyAt).toEqual(expect.any(String));
    expect(body.stops).toHaveLength(3);
    expect(body.eventTokens.planAccepted.length).toBeGreaterThan(0);
    expect(body.eventTokens.meaningfulCoreAction.length).toBeGreaterThan(0);
  });

  it("refuses an upgrade without a valid proof and maps proof failures to 422", async () => {
    const { planId, memberToken } = await createDraft();
    const stops = [{ venueId: "venue-a", venueName: "A" }, { venueId: "venue-b", venueName: "B" }, { venueId: "venue-c", venueName: "C" }];

    // No proof: the anchored draft cannot upgrade and never becomes route-ready.
    const noProof = await patchUpgrade(planId, { memberToken, stops, expectedRouteRevision: 1 });
    expect(noProof.status).toBe(403);

    // A proof for a different operation is a 422.
    const wrongOp = await patchUpgrade(planId, {
      memberToken, stops, expectedRouteRevision: 1,
      groundingProof: routeProof("op-upgrade-real"), operationKey: "op-upgrade-other",
    });
    expect(wrongOp.status).toBe(422);
    expect((await wrongOp.json()).code).toBe("PLAN_ANCHOR_PROOF_OPERATION_MISMATCH");
  });

  it("treats a legacy V1 creation proof as no upgrade claim, not a malformed one", async () => {
    // V1 was only ever minted for unanchored creation. Once the anchored gate
    // lost its rollout flag, a caller replaying its own create proof onto a
    // route replacement started meeting the V2 "malformed proof" 422 for a
    // claim it never made, refusing a save that used to go through.
    const { planId, memberToken } = await createDraft();
    const stops = [
      { venueId: "venue-a", venueName: "A" },
      { venueId: "venue-b", venueName: "B" },
      { venueId: "venue-c", venueName: "C" },
    ];
    const legacy = await patchUpgrade(planId, {
      memberToken,
      stops,
      expectedRouteRevision: 1,
      groundingProof: mintPlanGroundingProof(
        stops.map((stop) => stop.venueId),
        "op-legacy-v1-create",
      ),
      operationKey: "op-legacy-v1-create",
    });

    // The same answer a caller sending no proof at all gets: the V1 proof is
    // not read as a broken anchored claim, so the store decides the request on
    // its own terms rather than the route refusing it with a proof 422.
    expect(legacy.status).toBe(403);
    expect((await legacy.json()).code).toBe("PLAN_UPDATE_FORBIDDEN");
  });

  it("classifies an expired signed V1 proof as a legacy creation proof", async () => {
    const { planId, memberToken } = await createDraft();
    const stops = [
      { venueId: "venue-a", venueName: "A" },
      { venueId: "venue-b", venueName: "B" },
      { venueId: "venue-c", venueName: "C" },
    ];
    const operationKey = "op-expired-v1-create";
    const response = await patchUpgrade(planId, {
      memberToken,
      stops,
      expectedRouteRevision: 1,
      groundingProof: mintPlanGroundingProof(
        stops.map((stop) => stop.venueId),
        operationKey,
        Date.now() - PLAN_GROUNDING_PROOF_TTL_MS - 1,
      ),
      operationKey,
    });

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("PLAN_UPDATE_FORBIDDEN");
  });

  it("still refuses a forged proof that is neither a real V1 nor a real V2", async () => {
    const { planId, memberToken } = await createDraft();
    const stops = [
      { venueId: "venue-a", venueName: "A" },
      { venueId: "venue-b", venueName: "B" },
      { venueId: "venue-c", venueName: "C" },
    ];
    const forged = await patchUpgrade(planId, {
      memberToken,
      stops,
      expectedRouteRevision: 1,
      groundingProof: `${routeProof("op-upgrade-forge")}x`,
      operationKey: "op-upgrade-forge",
    });

    expect(forged.status).toBe(422);
  });

  it("accepts an anchor by default and preserves generic creation without one", async () => {
    const response = await create({
      stops: [{ venueId: "venue-a", venueName: "A" }],
      groundingProof: anchorOnlyProof(),
      anchor: ANCHOR,
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.plan.plan).toMatchObject({
      anchorVenueId: "venue-a",
      anchorSource: "near",
      outcome: "anchor-only",
    });
    expect(body.plan.plan.routeReadyAt).toBeNull();
    expect(body.eventTokens.planDraftSaved).toEqual(expect.any(String));

    const generic = await create({
      stops: [{ venueId: "venue-a", venueName: "A" }],
    }, "op-generic-plan-01");
    expect(generic.status).toBe(201);
    const genericBody = await generic.json();
    expect(genericBody.plan.plan).toMatchObject({
      anchorVenueId: null,
      anchorSource: null,
      outcome: null,
    });
    expect(genericBody.eventTokens).not.toHaveProperty("planDraftSaved");
  });
});

describe("locking a committed base pub whose curated alias exists", () => {
  const baseId = "venue-uk-w545664029";
  const curatedId = "venue-u5unwx";
  const routeIds = [baseId, "venue-eltcmh", "venue-1iyj2h1"];

  beforeEach(() => { __resetMemoryPlans(); committedPacks.enabled = true; });
  afterEach(() => { __resetMemoryPlans(); committedPacks.enabled = false; });

  it("locks and reloads the exact signed base anchor without trusting submitted price or name", async () => {
    const operation = "base-alias-first-lock-01";
    const body = {
      cityId: "london",
      stops: [{ venueId: baseId, venueName: "Client name", selectedDrinkPriceEvidence: {
        category: "wine", pence: 99_999, serving: "125ml", source: "listed",
        sourceUrl: "https://example.invalid/client-price", observedAt: new Date().toISOString(),
      } }],
      anchor: { venueId: baseId, source: "near", outcome: "anchor-only" },
      groundingProof: mintPlanGroundingProofV2({ routeVenueIds: [baseId], allowedVenueIds: [baseId],
        anchorVenueId: baseId, anchorSource: "near", outcome: "anchor-only", operationKey: operation }),
    };
    const response = await create(body, operation);
    expect(response.status).toBe(201);
    const saved = await response.json();
    expect(saved.plan.stops).toEqual([{ venueId: baseId, venueName: "Westminster Arms", position: 0 }]);
    expect(saved.plan.plan).toMatchObject({ anchorVenueId: baseId, outcome: "anchor-only", routeReadyAt: null });
    expect(saved.grounded).toBe(true);
    expect(saved.eventTokens.planDraftSaved).toEqual(expect.any(String));
    expect(saved.eventTokens.planAccepted).toBe("");
    const loaded = await GET(new Request(`${URL}/${saved.plan.plan.id}`, {
      headers: { authorization: `Bearer ${saved.memberToken}` },
    }), { params: Promise.resolve({ id: saved.plan.plan.id }) });
    expect(loaded.status).toBe(200);
    expect((await loaded.json()).stops).toEqual(saved.plan.stops);
    const replay = await create(body, operation);
    expect(replay.status).toBe(201);
    const replayed = await replay.json();
    expect(replayed.created).toBe(false);
    expect(replayed.plan.plan.id).toBe(saved.plan.plan.id);
    expect(replayed.plan.stops).toEqual(saved.plan.stops);
  });

  it("keeps a signed route's base identity and order alongside curated pubs", async () => {
    const operation = "base-alias-route-lock-01";
    const response = await create({ cityId: "london",
      stops: routeIds.map((venueId) => ({ venueId, venueName: "Client name" })),
      anchor: { venueId: baseId, source: "near", outcome: "route" },
      groundingProof: mintPlanGroundingProofV2({ routeVenueIds: routeIds, allowedVenueIds: routeIds,
        anchorVenueId: baseId, anchorSource: "near", outcome: "route", operationKey: operation }),
    }, operation);
    expect(response.status).toBe(201);
    const saved = await response.json();
    expect(saved.plan.stops.map((stop: { venueId: string }) => stop.venueId)).toEqual(routeIds);
    expect(saved.plan.stops.map((stop: { venueName: string }) => stop.venueName))
      .toEqual(["Westminster Arms", "The Blackfriar", "The Red Lion"]);
    expect(saved.plan.plan).toMatchObject({ anchorVenueId: baseId, outcome: "route" });
    expect(saved.plan.plan.routeReadyAt).toEqual(expect.any(String));
    expect(saved.grounded).toBe(true);
  });

  it.each([
    { label: "substituted curated alias", ids: [curatedId, "venue-eltcmh", "venue-1iyj2h1"] },
    { label: "permuted later stops", ids: [baseId, "venue-1iyj2h1", "venue-eltcmh"] },
  ])("still refuses $label against the exact signed base route", async ({ label, ids }) => {
    const operation = `base-alias-mismatch-${label}`;
    const response = await create({ cityId: "london",
      stops: ids.map((venueId) => ({ venueId, venueName: "Client name" })),
      anchor: { venueId: baseId, source: "near", outcome: "route" },
      groundingProof: mintPlanGroundingProofV2({ routeVenueIds: routeIds, allowedVenueIds: routeIds,
        anchorVenueId: baseId, anchorSource: "near", outcome: "route", operationKey: operation }),
    }, operation);
    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe("PLAN_ANCHOR_PROOF_ROUTE_MISMATCH");
  });
});


describe("canonical base pub anchored create, replacement and reload", () => {
  beforeEach(() => { __resetMemoryPlans(); basePlanPack.result = { status: "ready", pub: basePlanPack.pub }; });
  afterEach(() => { __resetMemoryPlans(); basePlanPack.result = { status: "missing" }; });

  it("ignores submitted names while preserving base Stop 1 through a grounded upgrade and member reload", async () => {
    const id = basePlanPack.pub.id;
    const operation = "base-canonical-create-01";
    const proof = mintPlanGroundingProofV2({ routeVenueIds: [id], allowedVenueIds: [id],
      anchorVenueId: id, anchorSource: "near", outcome: "anchor-only", operationKey: operation });
    const response = await create({ cityId: "london", stops: [{ venueId: id, venueName: "Forged curated Sydney" }],
      groundingProof: proof, anchor: { venueId: id, source: "near", outcome: "anchor-only" } }, operation);
    expect(response.status).toBe(201);
    const created = await response.json();
    expect(created.plan.stops[0]).toMatchObject({ venueId: id, venueName: basePlanPack.pub.name });
    expect(created.plan.plan).toMatchObject({ anchorVenueId: id, outcome: "anchor-only", routeReadyAt: null });
    const planId = created.plan.plan.id;
    const upgradeOperation = "base-canonical-upgrade-01";
    const ids = [id, "venue-a", "venue-b"];
    const upgraded = await PATCH(new Request(`${URL}/${planId}`, { method: "PATCH",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ memberToken: created.memberToken,
        stops: ids.map((venueId) => ({ venueId, venueName: "Client replacement name" })), expectedRouteRevision: 1,
        operationKey: upgradeOperation, groundingProof: mintPlanGroundingProofV2({ routeVenueIds: ids,
          allowedVenueIds: ids, anchorVenueId: id, anchorSource: "near", outcome: "route", operationKey: upgradeOperation }) }) }),
      { params: Promise.resolve({ id: planId }) });
    expect(upgraded.status).toBe(200);
    const update = await upgraded.json();
    expect(update.stops.map((stop: { venueId: string }) => stop.venueId)).toEqual(ids);
    expect(update.stops[0]).toMatchObject({ venueId: id, venueName: basePlanPack.pub.name });
    expect(update.stops.map((stop: { venueName: string }) => stop.venueName)).not.toContain("Client replacement name");
    const loaded = await GET(new Request(`${URL}/${planId}`, { headers: { authorization: `Bearer ${created.memberToken}` } }),
      { params: Promise.resolve({ id: planId }) });
    expect(loaded.status).toBe(200);
    expect((await loaded.json()).stops[0]).toMatchObject({ venueId: id, venueName: basePlanPack.pub.name });
    const anonymous = await GET(new Request(`${URL}/${planId}`), { params: Promise.resolve({ id: planId }) });
    const preview = await anonymous.json();
    expect(preview.visibility).toBe("preview");
    expect(preview).not.toHaveProperty("stops");
    expect(JSON.stringify(preview)).not.toContain(id);
  });

  it("does not use a London default to admit Sydney into a different city's create", async () => {
    const response = await create({ cityId: "manchester", stops: [{ venueId: basePlanPack.pub.id, venueName: "Forged Manchester" }] }, "base-wrong-city-01");
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("PLAN_VENUES_INVALID");
  });
});
