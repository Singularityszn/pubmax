import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { SocialCrewPageDTO } from "@/lib/socialCrew";
import type { PlanCompletionDTO } from "@/lib/plan";

const accountId = "10000000-0000-4000-8000-000000000001";
const crewId = "50000000-0000-4000-8000-000000000001";
const planId = "60000000-0000-4000-8000-000000000001";

const crew: SocialCrewPageDTO = {
  kind: "member",
  crewId,
  title: "Social night",
  visibility: "private",
  phase: "planning",
  nightArea: null,
  startsAt: "2030-03-06T20:00:00.000Z",
  authorityRevision: 1,
  viewer: { memberId: "30000000-0000-4000-8000-000000000001", role: "owner" },
  owner: { memberId: "30000000-0000-4000-8000-000000000001", handle: "host" },
  members: [],
  plan: {
    plan: {
      id: planId,
      title: "Social night",
      startTime: "2030-03-06T20:00:00.000Z",
      createdAt: "2030-03-01T20:00:00.000Z",
      routeRevision: 1,
      status: "active",
    },
    stops: [{ venueId: "social-pub", venueName: "Social Pub", position: 0 }],
    context: null,
    actions: [],
    ending: null,
  },
};

const completion: PlanCompletionDTO = {
  id: "70000000-0000-4000-8000-000000000001",
  planId,
  ending: "get_home",
  terminalVenueId: null,
  endingSelection: {
    kind: "get_home",
    optionId: "transport:home",
    evidenceSnapshot: { label: "Home", confidence: "unknown", source: "PUBMAXX transport choice", warnings: [] },
  },
  finalPintDropId: null,
  routeRevision: 1,
  routeSnapshot: [{ venueId: "social-pub", venueName: "Social Pub", position: 0 }],
  qualifyingArrival: null,
  completedAt: "2030-03-06T21:00:00.000Z",
};

const state = vi.hoisted(() => ({ access: null as unknown }));
const read = vi.hoisted(() => vi.fn());
const write = vi.hoisted(() => vi.fn());

vi.mock("@/lib/socialAccessServer", () => ({ requireVerifiedSocialActor: vi.fn(async () => state.access) }));
vi.mock("@/lib/socialCrewStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/socialCrewStore")>()),
  createSocialCrewStore: () => ({ read }),
}));
vi.mock("@/lib/socialCrewCompletionStore", () => ({ completeSocialCrewPlan: write }));
vi.mock("@/lib/pintDrops", () => ({ isLimited: vi.fn(async () => false) }));
vi.mock("@/lib/supabase", () => ({ hashActor: (value: string) => value }));

import { POST } from "@/app/api/social/crews/[crewId]/complete/route";
import { completeSocialCrewPlan } from "@/lib/socialCrewCompletionStore";
import { SocialCrewStoreError } from "@/lib/socialCrewStore";

function request(): Request {
  return new Request(`https://example.test/api/social/crews/${crewId}/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      expectedRouteRevision: 1,
      arrivedStopPosition: 0,
      ending: "get_home",
      endingSelection: { kind: "get_home", optionId: "transport:home", evidenceSnapshot: {
        label: "Home", confidence: "high", source: "client claim", warnings: [],
      } },
    }),
  });
}

const context = { params: Promise.resolve({ crewId }) };

beforeEach(() => {
  vi.clearAllMocks();
  state.access = { ok: true, actor: { accountId, profileId: accountId, handle: "host" } };
  read.mockResolvedValue(crew);
  write.mockResolvedValue({ completion, created: true });
});

describe("Social Crew completion product path", () => {
  it("uses verified account authority and server-owned ending evidence", async () => {
    const response = await POST(request(), context);
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(completeSocialCrewPlan).toHaveBeenCalledWith(expect.objectContaining({
      actorAccountId: accountId,
      crewId,
      planId,
      arrivedStopPosition: 0,
      endingSelection: expect.objectContaining({ evidenceSnapshot: expect.objectContaining({
        confidence: "unknown", source: "PUBMAXX transport choice",
      }) }),
    }));
    expect((await response.json()).completion.planId).toBe(planId);
  });

  it("refuses a nonowner or removed member without invoking completion", async () => {
    read.mockResolvedValueOnce({ ...crew, viewer: { ...crew.viewer, role: "member" } });
    expect((await POST(request(), context)).status).toBe(404);
    read.mockRejectedValueOnce(new SocialCrewStoreError("NOT_FOUND", 404, "Social Crew not found."));
    expect((await POST(request(), context)).status).toBe(404);
    expect(write).not.toHaveBeenCalled();
  });

  it("maps an RPC authority refusal to a private 404", async () => {
    write.mockRejectedValueOnce(new SocialCrewStoreError("NOT_FOUND", 404, "Social Crew not found."));
    const response = await POST(request(), context);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
