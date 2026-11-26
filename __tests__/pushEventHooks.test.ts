import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Neither a public feed read nor a Plan decision should start these pushes.
const { notifyPlanUpdateMock, maybeBroadcastMock, neverResolves } = vi.hoisted(() => ({
  notifyPlanUpdateMock: vi.fn(),
  maybeBroadcastMock: vi.fn(),
  // A promise that never settles — if a route awaited it, the test would hang.
  neverResolves: new Promise<never>(() => {}),
}));

vi.mock("@/lib/pushSender", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pushSender")>();
  return {
    ...actual,
    notifyPlanUpdate: notifyPlanUpdateMock,
    maybeBroadcastNightSignalLive: maybeBroadcastMock,
  };
});

// Keep the decision route's collaboration + plan stores off the network: a
// successful decision so the fire-and-forget hook is reached.
const PROPOSAL = {
  id: "prop-1",
  planId: "11111111-1111-4111-8111-111111111111",
  stops: [],
  expectedRouteRevision: 3,
};
vi.mock("@/lib/planCollaborationStore", () => ({
  planCollaborationStore: () => ({
    decideProposal: vi.fn(async () => ({ ok: true, proposal: PROPOSAL })),
  }),
}));
vi.mock("@/lib/planStore", () => ({
  planStore: () => ({ update: vi.fn(async () => ({ ok: true })) }),
}));

import { POST as decisionPOST } from "@/app/api/plans/[id]/proposals/[proposalId]/decision/route";
import { GET as nightSignalsGET } from "@/app/api/night-signals/route";

const PLAN_ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  notifyPlanUpdateMock.mockReset();
  maybeBroadcastMock.mockReset();
  notifyPlanUpdateMock.mockReturnValue(neverResolves);
  maybeBroadcastMock.mockReturnValue(neverResolves);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("plan proposal decision hook", () => {
  it("accepts a proposal without scheduling a dormant push", async () => {
    const res = await decisionPOST(
      new Request(`http://localhost/api/plans/${PLAN_ID}/proposals/prop-1/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "accepted", memberToken: "member-abc" }),
      }),
      { params: Promise.resolve({ id: PLAN_ID, proposalId: "prop-1" }) },
    );
    expect(res.status).toBe(200);
    expect(notifyPlanUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects a proposal without scheduling a dormant push", async () => {
    const res = await decisionPOST(
      new Request(`http://localhost/api/plans/${PLAN_ID}/proposals/prop-1/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "rejected", memberToken: "member-abc" }),
      }),
      { params: Promise.resolve({ id: PLAN_ID, proposalId: "prop-1" }) },
    );
    expect(res.status).toBe(200);
    expect(notifyPlanUpdateMock).not.toHaveBeenCalled();
  });
});

describe("night-signals broadcast hook", () => {
  it("returns the signals without starting a broadcast", async () => {
    const res = await nightSignalsGET(new Request("http://localhost/api/night-signals"));
    expect(res.status).toBe(200);
    expect(maybeBroadcastMock).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body).toHaveProperty("claims");
  });
});
