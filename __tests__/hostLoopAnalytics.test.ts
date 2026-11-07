// Launch plan P0 item 7: the host loop on an open crawl can be measured.
//
// Three browser events mark the loop's steps (opened, asked, let in), and one
// server-minted receipt carries the night's arrived count as a band. The band
// is the launch metric: hosted nights where 4 or more guests arrived.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tracked = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/analytics", () => ({ trackEvent: tracked }));
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});
vi.mock("@/lib/authServer", () => ({ callerUserId: async () => null }));
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: async () => false };
});

import { POST as EVENTS } from "@/app/api/events/route";
import { POST as JOIN } from "@/app/api/plans/[id]/join/route";
import { POST as PRESENCE } from "@/app/api/plans/[id]/presence/route";
import { ANALYTICS_EVENTS, sanitizeEvent } from "@/lib/analyticsEvents";
import { __resetMemoryAnalyticsReceipts } from "@/lib/analyticsReceiptStore";
import {
  CREW_ARRIVED_BANDS,
  crewArrivedBandsReached,
  guestsArrived,
  parseCrewArrivedReceipts,
  type CrewPresenceStatus,
} from "@/lib/crew";
import { trackCrewArrivedReceipts, trackHostLoopStep } from "@/lib/hostLoopAnalytics";
import { __resetPlanCollaboration } from "@/lib/planCollaborationStore";
import { planCrewArrivedReceipts } from "@/lib/planCrewArrived.server";
import { __resetMemoryPlans, memoryPlanStore, planInviteToken } from "@/lib/planStore";
import { parseCrewRead } from "@/lib/socialCrewsUi";
import { crewArrivedEventToken, verifyAnalyticsDeliveryToken } from "@/lib/verifiedAnalytics.server";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

type Receipt = { deliveryToken: string; guestsArrived: string };

function eventIdOf(token: string): string {
  return (JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString("utf8")) as { eventId: string }).eventId;
}

const crewOf = (...statuses: CrewPresenceStatus[]) => statuses.map((status) => ({ status }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-12T18:00:00.000Z"));
  vi.stubEnv("POSTHOG_PROJECT_API_KEY", "");
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "");
  __resetMemoryPlans();
  __resetPlanCollaboration();
  __resetMemoryAnalyticsReceipts();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function hostedPlan(guests: number) {
  const created = await memoryPlanStore.create({
    title: "Thursday in Soho",
    creatorName: "Host",
    startTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    stops: [
      { venueId: "venue-1f5ygjb", venueName: "The Crown" },
      { venueId: "venue-xjf3n0", venueName: "The Railway" },
      { venueId: "venue-3h52h", venueName: "The George" },
    ],
  }, { idempotencyKey: `host-loop-${crypto.randomUUID()}` });
  if (!created.ok) throw new Error(created.error);
  const planId = created.plan.plan.id;
  const invite = await planInviteToken(planId);
  if (!invite.ok || !invite.inviteToken) throw new Error("missing invite");
  const guestTokens: string[] = [];
  for (let index = 0; index < guests; index += 1) {
    const response = await JOIN(new Request(`http://localhost/api/plans/${planId}/join`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": `${planId}:guest-${index}` },
      body: JSON.stringify({ name: `Guest ${index + 1}`, inviteToken: invite.inviteToken }),
    }), ctx(planId));
    const body = await response.json() as { memberToken: string };
    guestTokens.push(body.memberToken);
  }
  return { planId, hostToken: created.memberToken, guestTokens };
}

async function setStatus(planId: string, memberToken: string, status: CrewPresenceStatus): Promise<Receipt[]> {
  const response = await PRESENCE(new Request(`http://localhost/api/plans/${planId}/presence`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ memberToken, status }),
  }), ctx(planId));
  expect(response.status).toBe(200);
  const body = await response.json() as { crew: unknown[]; crewArrived?: Receipt[] };
  expect(Array.isArray(body.crew)).toBe(true);
  return body.crewArrived ?? [];
}

async function ingest(receipt: Receipt, anonymousId = "anon_8d8f4a52-8a1d-4a49-9b3a-2a0f9a3d6c11"): Promise<string | null> {
  const response = await EVENTS(new Request("http://localhost/api/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "crew_arrived",
      props: { guestsArrived: receipt.guestsArrived },
      anonymousId,
      analyticsConsent: true,
      deliveryToken: receipt.deliveryToken,
    }),
  }));
  return response.headers.get("x-analytics-delivery");
}

describe("the host-loop events are registered with no identifying props", () => {
  it("registers the three step events with no props, and the arrival band alone", () => {
    expect(ANALYTICS_EVENTS.open_crawl_opened).toEqual([]);
    expect(ANALYTICS_EVENTS.crew_join_requested).toEqual([]);
    expect(ANALYTICS_EVENTS.crew_join_accepted).toEqual([]);
    expect(ANALYTICS_EVENTS.crew_arrived).toEqual(["guestsArrived"]);
  });

  it("drops a crew id, a handle or a capacity from the step events", () => {
    for (const name of ["open_crawl_opened", "crew_join_requested", "crew_join_accepted"] as const) {
      expect(sanitizeEvent(name, { crewId: "crew-1", handle: "night_owl", capacity: 8 }))
        .toEqual({ name, props: {} });
    }
  });

  it("keeps each band and fails closed on a missing, raw or invented one", () => {
    for (const band of CREW_ARRIVED_BANDS) {
      expect(sanitizeEvent("crew_arrived", { guestsArrived: band, planId: "plan-1" }))
        .toEqual({ name: "crew_arrived", props: { guestsArrived: band } });
    }
    expect(sanitizeEvent("crew_arrived", {})).toBeNull();
    expect(sanitizeEvent("crew_arrived", { guestsArrived: 5 })).toBeNull();
    expect(sanitizeEvent("crew_arrived", { guestsArrived: "1-3" })).toBeNull();
  });
});

describe("guests arrived", () => {
  it("never counts the host, who holds the first seat", () => {
    expect(guestsArrived(crewOf("here"))).toBe(0);
    expect(guestsArrived(crewOf("here", "here", "on_the_way"))).toBe(1);
    expect(crewArrivedBandsReached(crewOf("here", "in", "running_late"))).toEqual([]);
  });

  it("reaches every band up to the count, smallest first", () => {
    expect(crewArrivedBandsReached(crewOf("in", "here"))).toEqual(["1"]);
    expect(crewArrivedBandsReached(crewOf("in", "here", "here", "here"))).toEqual(["1", "2-3"]);
    expect(crewArrivedBandsReached(crewOf("in", "here", "here", "here", "here"))).toEqual(["1", "2-3", "4+"]);
  });

  it("reads only well-formed receipts back off a response", () => {
    expect(parseCrewArrivedReceipts(undefined)).toEqual([]);
    expect(parseCrewArrivedReceipts([
      { deliveryToken: "token", guestsArrived: "4+" },
      { deliveryToken: "", guestsArrived: "1" },
      { deliveryToken: "token", guestsArrived: "5" },
      "nonsense",
    ])).toEqual([{ deliveryToken: "token", guestsArrived: "4+" }]);
  });
});

describe("crew_arrived receipts on a status write", () => {
  it("sends nothing until a guest is Here, and the host alone is not enough", async () => {
    const { planId, hostToken, guestTokens } = await hostedPlan(1);
    expect(await setStatus(planId, guestTokens[0]!, "on_the_way")).toEqual([]);
    expect(await setStatus(planId, hostToken, "here")).toEqual([]);
  });

  it("hands every member the bands reached, and each verifies for its exact prop", async () => {
    const { planId, hostToken, guestTokens } = await hostedPlan(4);
    for (const token of guestTokens) await setStatus(planId, token, "here");
    const fromHost = await setStatus(planId, hostToken, "in");
    expect(fromHost.map((receipt) => receipt.guestsArrived)).toEqual(["1", "2-3", "4+"]);
    for (const receipt of fromHost) {
      expect(verifyAnalyticsDeliveryToken(receipt.deliveryToken, {
        name: "crew_arrived",
        props: { guestsArrived: receipt.guestsArrived },
      })).toMatchObject({ name: "crew_arrived" });
    }
  });

  it("counts a band once a night, whichever device sends it first", async () => {
    const { planId, hostToken, guestTokens } = await hostedPlan(1);
    const [fromGuest] = await setStatus(planId, guestTokens[0]!, "here");
    const [fromHost] = await setStatus(planId, hostToken, "here");
    expect(fromGuest && fromHost).toBeTruthy();
    expect(eventIdOf(fromGuest!.deliveryToken)).toBe(eventIdOf(fromHost!.deliveryToken));

    const forwarded = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(await ingest(fromGuest!)).toBe("delivered");
      expect(await ingest(fromGuest!)).toBe("delivered");
      expect(await ingest(fromHost!)).toBe("delivered");
      const lines = forwarded.mock.calls.filter(([line]) => String(line).startsWith("[pubmax-analytics]"));
      expect(lines).toHaveLength(1);
    } finally {
      forwarded.mockRestore();
    }
  });

  it("recovers failed delivery through another member's later byte-identical receipts", async () => {
    const { planId, hostToken, guestTokens } = await hostedPlan(4);
    for (const token of guestTokens) await setStatus(planId, token, "here");
    const fromGuest = await setStatus(planId, guestTokens[0]!, "here");
    expect(fromGuest.map((receipt) => receipt.guestsArrived)).toEqual(["1", "2-3", "4+"]);

    vi.stubEnv("POSTHOG_PROJECT_API_KEY", "phc_test_project");
    const forward = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", forward);
    vi.spyOn(console, "log").mockImplementation(() => {});
    for (const receipt of fromGuest) expect(await ingest(receipt)).toBe("retry");
    expect(forward).toHaveBeenCalledTimes(3);

    vi.setSystemTime(new Date("2026-11-12T18:10:00.000Z"));
    const fromHost = await setStatus(planId, hostToken, "here");
    forward.mockResolvedValue(new Response(null, { status: 200 }));
    for (const receipt of fromHost) {
      expect(await ingest(receipt, "anon_0123456789abcdef")).toBe("delivered");
      expect(await ingest(receipt, "anon_0123456789abcdef")).toBe("delivered");
    }
    expect(fromHost).toEqual(fromGuest);
    expect(forward).toHaveBeenCalledTimes(6);
    const forwarded = forward.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)) as {
      properties: { $insert_id: string };
    });
    expect(forwarded.slice(3).map((body) => body.properties.$insert_id))
      .toEqual(fromGuest.map((receipt) => eventIdOf(receipt.deliveryToken)));
  });

  it("gives two nights and two bands their own receipts", async () => {
    const plan = (await memoryPlanStore.get((await hostedPlan(1)).planId))!;
    const nextWeek = { ...plan, plan: { ...plan.plan, startTime: new Date(Date.now() + 7 * 864e5).toISOString() } };
    const subject = { planId: plan.plan.id, nightKey: "2026-11-12" };
    expect(eventIdOf(crewArrivedEventToken({ ...subject, band: "1" })))
      .not.toBe(eventIdOf(crewArrivedEventToken({ ...subject, band: "2-3" })));
    const here = (state: typeof plan) => ({ ...state, crew: state.crew.map((member) => ({ ...member, status: "here" as const })) });
    const [tonight] = planCrewArrivedReceipts(here(plan));
    const [later] = planCrewArrivedReceipts(here(nextWeek), new Date(nextWeek.plan.startTime));
    expect(eventIdOf(tonight!.deliveryToken)).not.toBe(eventIdOf(later!.deliveryToken));
  });

  it.each([
    ["2026-11-12", "2026-11-12T00:00:00.000Z"],
    ["2026-07-12", "2026-07-11T23:00:00.000Z"],
    ["2026-03-29", "2026-03-29T00:00:00.000Z"],
    ["2026-10-25", "2026-10-24T23:00:00.000Z"],
  ])("anchors %s to London midnight within the delivery window", (nightKey, midnight) => {
    const subject = { planId: "plan-night", nightKey, band: "4+" as const };
    const event = { name: "crew_arrived" as const, props: { guestsArrived: "4+" } };
    const start = Date.parse(midnight);
    const expiry = start + 30 * 24 * 60 * 60 * 1000;
    const token = crewArrivedEventToken(subject, start);
    expect(verifyAnalyticsDeliveryToken(token, event, start)).toMatchObject({ issuedAt: start, expiresAt: expiry });
    expect(crewArrivedEventToken(subject, expiry - 1)).toBe(token);
    expect(verifyAnalyticsDeliveryToken(token, event, expiry - 1)).not.toBeNull();
    expect(() => crewArrivedEventToken(subject, start - 1)).toThrow();
    expect(() => crewArrivedEventToken(subject, expiry)).toThrow();
    expect(verifyAnalyticsDeliveryToken(token, event, expiry)).toBeNull();
  });

  it("leaves presence successful when its scheduled night is future or expired", async () => {
    const { planId, guestTokens } = await hostedPlan(1);
    vi.setSystemTime(new Date("2026-11-11T18:00:00.000Z"));
    expect(await setStatus(planId, guestTokens[0]!, "here")).toEqual([]);
    vi.setSystemTime(new Date("2026-12-12T00:00:00.000Z"));
    expect(await setStatus(planId, guestTokens[0]!, "here")).toEqual([]);
  });

  it("is refused at ingest without a server receipt", async () => {
    expect(await ingest({ deliveryToken: "forged.token", guestsArrived: "4+" })).toBe("discard");
  });
});

describe("each step event fires on the server's first answer only", () => {
  beforeEach(() => tracked.mockClear());

  const outcome = (code: string, replayed = false) => ({ code, replayed, crewId: "4f6b0c1e-2a7d-4c55-9a3e-1b2c3d4e5f60" });
  const friendsPreview = {
    kind: "preview",
    title: "Thursday in Soho",
    phase: "planning",
    nightArea: null,
    startsAt: "2026-11-12T18:30:00.000Z",
    joinRequestState: "none",
  };
  const openPreview = parseCrewRead({ ...friendsPreview, hostHandle: "host" });

  it("counts an opened crawl once, and never a replay of it", () => {
    trackHostLoopStep("open", outcome("created"));
    trackHostLoopStep("open", outcome("replayed", true));
    trackHostLoopStep("open", null);
    expect(tracked.mock.calls).toEqual([["open_crawl_opened"]]);
  });

  it("counts a request, but not a cancel or a replayed request", () => {
    expect(openPreview).not.toBeNull();
    trackHostLoopStep("request", outcome("requested"), openPreview);
    trackHostLoopStep("request", outcome("cancelled"), openPreview);
    trackHostLoopStep("request", outcome("requested", true), openPreview);
    trackHostLoopStep("request", null, openPreview);
    expect(tracked.mock.calls).toEqual([["crew_join_requested"]]);
  });

  it("does not count friends-crew requests or requests without crew data", () => {
    const crew = parseCrewRead(friendsPreview);
    expect(crew).not.toBeNull();
    trackHostLoopStep("request", outcome("requested"), crew);
    trackHostLoopStep("request", outcome("requested"), null);
    trackHostLoopStep("request", outcome("requested"));
    expect(tracked).not.toHaveBeenCalled();
  });

  it("counts an accept, but not a decline", () => {
    trackHostLoopStep("decide", outcome("accepted"));
    trackHostLoopStep("decide", outcome("declined"));
    expect(tracked.mock.calls).toEqual([["crew_join_accepted"]]);
  });

  it("sends each arrival receipt with its delivery token, and drops a malformed one", () => {
    trackCrewArrivedReceipts([
      { deliveryToken: "token-1", guestsArrived: "1" },
      { deliveryToken: "token-4", guestsArrived: "4+" },
      { deliveryToken: "token-x", guestsArrived: "9" },
    ]);
    trackCrewArrivedReceipts(undefined);
    expect(tracked.mock.calls).toEqual([
      ["crew_arrived", { guestsArrived: "1" }, { deliveryToken: "token-1" }],
      ["crew_arrived", { guestsArrived: "4+" }, { deliveryToken: "token-4" }],
    ]);
  });
});
