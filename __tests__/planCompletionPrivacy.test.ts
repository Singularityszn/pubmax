import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const store = vi.hoisted(() => ({
  state: vi.fn(),
  identity: vi.fn(),
  completion: vi.fn(),
}));

// Only the persistence/authority results are controlled. GET, capability
// extraction (including its cookie/sentinel rules), and response helpers run.
vi.mock("@/lib/planStore", () => ({
  planStateResult: store.state,
  planMemberIdentityResult: store.identity,
  planCompletionResult: store.completion,
  planStore: () => ({}),
}));

// POST-only dependencies must not initialise provider/data reads in this GET
// suite. These doubles do not decide GET authority or serialize its response.
vi.mock("@/lib/supabase", () => ({ clientIp: vi.fn(), hashIp: vi.fn() }));
vi.mock("@/lib/pintDrops", () => ({ isLimited: vi.fn() }));
vi.mock("@/lib/planEndingSelection.server", () => ({ canonicalEndingSelection: vi.fn() }));
vi.mock("@/lib/planSigningHttp.server", () => ({
  planSigningPreflightResponse: vi.fn(),
  planSigningUnavailableResponse: vi.fn(),
}));
vi.mock("@/lib/verifiedAnalytics.server", () => ({ completionLoopEventTokens: vi.fn() }));

import { GET } from "@/app/api/plans/[id]/complete/route";
import { planMemberCookieName } from "@/lib/planMemberCapability";
import { PLAN_HTTP_ONLY_SESSION } from "@/lib/planSessionCapability";

const ID = "6ab5ca40-836b-4970-9477-d1779fdd31ab";
const OTHER_ID = "2ab5ca40-836b-4970-9477-d1779fdd31ab";
const HOST = "host-capability-fixture";
const GUEST = "guest-capability-fixture";
const PRIVATE_VENUE = "venue-private-completion-one";
const PRIVATE_NAME = "Private completion pub";
const PRIVATE_LABEL = "Chardonnay, Pays D’oc, France";

// Unknown store-response fixture deliberately carries the proposed additive
// named identity. This checks lossless authorized transport, not acceptance by
// today's cleaner, SQL CHECK, publisher, or named-quote corroboration.
const completion = {
  id: "8ab5ca40-836b-4970-9477-d1779fdd31ab",
  planId: ID,
  ending: "get_home",
  terminalVenueId: null,
  endingSelection: {
    kind: "get_home",
    optionId: "transport:nearest-station",
    evidenceSnapshot: { label: "Private route station", confidence: "unknown" },
  },
  finalPintDropId: null,
  routeRevision: 3,
  routeSnapshot: [
    {
      venueId: PRIVATE_VENUE,
      venueName: PRIVATE_NAME,
      position: 0,
      selectedDrinkPriceEvidence: {
        category: "wine",
        pence: 550,
        serving: "125ml",
        source: "listed",
        sourceUrl: "https://www.sydneyarmschelsea.com/menu/",
        observedAt: "2026-09-29T10:40:17.846Z",
        drinkLabel: PRIVATE_LABEL,
        drinkSubtype: "wine-white",
      },
    },
    { venueId: "venue-private-completion-two", venueName: "Private second pub", position: 1 },
  ],
  qualifyingArrival: {
    actionId: "private-arrival-action",
    stopPosition: 0,
    arrivedAt: "2026-10-02T19:00:00.000Z",
  },
  completedAt: "2026-10-02T22:00:00.000Z",
};

function request(headers: HeadersInit = {}, id = ID): Request {
  return new Request(`http://localhost/api/plans/${id}/complete`, { headers });
}

function context(id = ID) {
  return { params: Promise.resolve({ id }) };
}

function cookie(token: string, id = ID): string {
  return `${planMemberCookieName(id)}=${encodeURIComponent(token)}`;
}

function expectNoStore(response: Response): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
}

async function expectWithheld(response: Response): Promise<void> {
  expect(response.status).toBe(200);
  expectNoStore(response);
  const raw = await response.text();
  expect(JSON.parse(raw)).toEqual({ completion: null });
  for (const privateValue of [PRIVATE_VENUE, PRIVATE_NAME, PRIVATE_LABEL,
    "venue-private-completion-two", "routeSnapshot", "qualifyingArrival", "wine-white"]) {
    expect(raw).not.toContain(privateValue);
  }
  expect(store.completion).not.toHaveBeenCalled();
}

async function expectUnavailable(response: Response): Promise<void> {
  expect(response.status).toBe(503);
  expectNoStore(response);
  expect(await response.json()).toEqual({
    error: "Plan completion data is temporarily unavailable.",
    code: "PLAN_COMPLETION_UNAVAILABLE",
    retryable: true,
  });
}

beforeEach(() => {
  store.state.mockReset();
  store.identity.mockReset();
  store.completion.mockReset();
  store.state.mockResolvedValue({ ok: true, plan: {
    plan: { id: ID, title: "Private completion night", status: "completed" },
    stops: completion.routeSnapshot,
    crew: [],
  } });
  store.completion.mockResolvedValue({ ok: true, completion });
  store.identity.mockImplementation(async (id: string, token: unknown) => ({
    ok: true,
    identity: id === ID && (token === HOST || token === GUEST)
      ? { memberId: token === HOST ? "host-seat" : "guest-seat",
        role: token === HOST ? "host" : "guest", collaborationAuthorized: token === HOST }
      : null,
  }));
});

describe("Plan completion GET capability privacy", () => {
  it.each([
    ["missing", {}],
    ["invalid bearer (lookup null)", { authorization: "Bearer invalid-capability" }],
    ["wrong-plan bearer (lookup null)", { authorization: "Bearer other-plan-capability" }],
    ["revoked bearer (lookup null)", { authorization: "Bearer revoked-capability" }],
    ["cookie for another Plan", { cookie: cookie(HOST, OTHER_ID) }],
    ["malformed encoded cookie", { cookie: `${planMemberCookieName(ID)}=%FF` }],
    ["empty cookie", { cookie: `${planMemberCookieName(ID)}=` }],
  ] as const)("withholds completed private snapshot for %s", async (_, headers) => {
    await expectWithheld(await GET(request(headers), context()));
  });

  it("does not treat the HttpOnly-session sentinel alone as authority", async () => {
    await expectWithheld(await GET(request({ authorization: `Bearer ${PLAN_HTTP_ONLY_SESSION}` }), context()));
    expect(store.identity).not.toHaveBeenCalledWith(ID, PLAN_HTTP_ONLY_SESSION);
  });

  it.each([HOST, GUEST])("returns original full completion for verified bearer %s", async (token) => {
    const response = await GET(request({ authorization: `Bearer ${token}` }), context());
    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(await response.json()).toEqual({ completion });
    expect(store.identity).toHaveBeenCalledOnce();
    expect(store.identity).toHaveBeenCalledWith(ID, token);
    expect(store.completion).toHaveBeenCalledOnce();
    expect(store.completion).toHaveBeenCalledWith(ID);
  });

  it.each([HOST, GUEST])("preserves ordinary cookie-backed recap for verified %s", async (token) => {
    const response = await GET(request({ cookie: cookie(token) }), context());
    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(await response.json()).toEqual({ completion });
    expect(store.identity).toHaveBeenCalledOnce();
    expect(store.identity).toHaveBeenCalledWith(ID, token);
  });

  it("decodes the cookie and allows sentinel bearer to use that real cookie authority", async () => {
    const response = await GET(request({
      authorization: `Bearer ${PLAN_HTTP_ONLY_SESSION}`,
      cookie: `${planMemberCookieName(ID)}=%68${HOST.slice(1)}`,
    }), context());
    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(await response.json()).toEqual({ completion });
    expect(store.identity).toHaveBeenCalledWith(ID, HOST);
    expect(store.identity).not.toHaveBeenCalledWith(ID, PLAN_HTTP_ONLY_SESSION);
  });

  it("uses canonical bearer ahead of a different cookie capability", async () => {
    const response = await GET(request({ authorization: `Bearer ${GUEST}`, cookie: cookie(HOST) }), context());
    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(await response.json()).toEqual({ completion });
    expect(store.identity).toHaveBeenCalledOnce();
    expect(store.identity).toHaveBeenCalledWith(ID, GUEST);
  });

  it("does not recover an invalid bearer by borrowing valid cookie authority", async () => {
    await expectWithheld(await GET(request({ authorization: "Bearer invalid-capability", cookie: cookie(HOST) }), context()));
    expect(store.identity).toHaveBeenCalledOnce();
    expect(store.identity).toHaveBeenCalledWith(ID, "invalid-capability");
  });

  it("refuses malformed Plan id before any store read", async () => {
    const response = await GET(request({ authorization: `Bearer ${HOST}` }, "not-a-plan"), context("not-a-plan"));
    expect(response.status).toBe(404);
    expectNoStore(response);
    expect(await response.json()).toEqual({ error: "That Plan doesn't exist.", code: "PLAN_NOT_FOUND", retryable: false });
    expect(store.state).not.toHaveBeenCalled();
    expect(store.identity).not.toHaveBeenCalled();
    expect(store.completion).not.toHaveBeenCalled();
  });

  it("keeps an absent Plan distinct from an authorized empty completion", async () => {
    store.state.mockResolvedValue({ ok: true, plan: null });
    const response = await GET(request({ authorization: `Bearer ${HOST}` }), context());
    expect(response.status).toBe(404);
    expectNoStore(response);
    expect(await response.json()).toEqual({ error: "That Plan doesn't exist.", code: "PLAN_NOT_FOUND", retryable: false });
    expect(store.completion).not.toHaveBeenCalled();
  });

  it("keeps state outage retryable and does not read private completion", async () => {
    store.state.mockResolvedValue({ ok: false, error: "error" });
    await expectUnavailable(await GET(request({ authorization: `Bearer ${HOST}` }), context()));
    expect(store.completion).not.toHaveBeenCalled();
  });

  it("keeps identity outage retryable and does not read private completion", async () => {
    store.identity.mockResolvedValue({ ok: false, error: "error" });
    await expectUnavailable(await GET(request({ authorization: `Bearer ${HOST}` }), context()));
    expect(store.completion).not.toHaveBeenCalled();
  });

  it("handles a thrown identity lookup without publishing error details or completion", async () => {
    store.identity.mockRejectedValue(new Error(`private transport detail ${PRIVATE_VENUE}`));
    await expectUnavailable(await GET(request({ authorization: `Bearer ${HOST}` }), context()));
    expect(store.completion).not.toHaveBeenCalled();
  });

  it("keeps completion outage retryable after successful member verification", async () => {
    store.completion.mockResolvedValue({ ok: false, error: "error" });
    await expectUnavailable(await GET(request({ authorization: `Bearer ${GUEST}` }), context()));
    expect(store.identity).toHaveBeenCalledWith(ID, GUEST);
  });

  it("returns null for a verified member when no completion exists", async () => {
    store.completion.mockResolvedValue({ ok: true, completion: null });
    const response = await GET(request({ authorization: `Bearer ${HOST}` }), context());
    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(await response.json()).toEqual({ completion: null });
    expect(store.identity).toHaveBeenCalledWith(ID, HOST);
    expect(store.completion).toHaveBeenCalledOnce();
  });
});

// v2 adds lookup-path assertions without rewriting the frozen v1 suite.
describe("Plan completion GET lookup-null denial", () => {
  it.each([
    ["invalid", "invalid-capability"],
    ["wrong-Plan", "other-plan-capability"],
    ["revoked", "revoked-capability"],
  ] as const)("withholds completion after %s bearer resolves to no member", async (_, token) => {
    const response = await GET(request({ authorization: `Bearer ${token}` }), context());
    await expectWithheld(response);
    expect(store.identity).toHaveBeenCalledOnce();
    expect(store.identity).toHaveBeenCalledWith(ID, token);
  });
});
