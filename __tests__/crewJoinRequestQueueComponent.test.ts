// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const CREW_ID = "50000000-0000-4000-8000-000000000001";
const REQUEST_ID = "80000000-0000-4000-8000-000000000001";

const responseBody = vi.hoisted(() => ({
  discardBody: vi.fn(),
}));

const state = vi.hoisted(() => ({
  queue: [
    {
      requestId: "80000000-0000-4000-8000-000000000001",
      requesterHandle: "bob",
    },
  ],
  decisions: [] as string[],
  visibility: "open" as "open" | "friends",
  identityResolved: true,
  provider: "supabase" as "clerk" | "supabase" | "signed-out",
  providerUserId: "supabase-actor-a" as string | null,
  accountRevision: 1,
  decisionFails: false,
  queueMissing: false,
  crewMissing: false,
  accessStatus: 403,
  deferQueueForRevision: 0,
  deferredQueueResponses: [] as Array<() => void>,
  deferLotForRevision: 0,
  deferredLotResponses: [] as Array<() => void>,
  crewReadCount: 0,
  crewUnavailableAfterFirst: false,
  viewerRole: "owner" as "owner" | "member",
  planStatus: "ready" as "ready" | "completed" | "abandoned",
  planStops: [] as Array<{ venueId: string; venueName: string; position: number }>,
  completionBodies: [] as Array<Record<string, unknown>>,
  completionMode: "ok" as "ok" | "conflict" | "deferred",
  deferredCompletionResponses: [] as Array<() => void>,
}));

function crewPayload() {
  return {
    kind: "member",
    crewId: CREW_ID,
    title: "Open Friday",
    visibility: state.visibility,
    phase: "planning",
    nightArea: "camden",
    startsAt: "2026-08-24T18:30:00.000Z",
    authorityRevision: 1,
    viewer: {
      memberId: "30000000-0000-4000-8000-000000000001",
      role: state.viewerRole,
    },
    owner: {
      memberId: "30000000-0000-4000-8000-000000000001",
      handle: "alice",
    },
    members: [
      {
        memberId: "30000000-0000-4000-8000-000000000001",
        handle: "alice",
        role: "owner",
        joinedAt: "2026-08-22T18:30:00.000Z",
      },
    ],
    plan: {
      plan: {
        id: "60000000-0000-4000-8000-000000000001",
        title: "Open Friday",
        startTime: "2026-08-24T18:30:00.000Z",
        createdAt: "2026-08-22T18:30:00.000Z",
        routeRevision: 1,
        status: state.planStatus,
      },
      stops: state.planStops,
      context: null,
      actions: [],
      ending: null,
    },
  };
}

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    createElement("a", { href: String(href), ...props }, children),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    identityResolved: state.identityResolved,
    accountRevision: state.accountRevision,
    providerAuthState:
      state.provider === "signed-out" ? "signed-out" : "authenticated",
    session:
      state.provider === "supabase" && state.providerUserId
        ? { user: { id: state.providerUserId } }
        : null,
    user:
      state.provider === "supabase" && state.providerUserId
        ? { id: state.providerUserId }
        : null,
  }),
}));

vi.mock("@/lib/responseBody", () => responseBody);

vi.mock("@/components/nav/SiteNav", () => ({
  default: () => createElement("nav", null, "Navigation"),
}));

vi.mock("@/lib/authedFetch", () => ({
  authedActionFetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === `/api/social/crews/${CREW_ID}/complete` && init?.method === "POST") {
      state.completionBodies.push(JSON.parse(String(init.body)));
      if (state.completionMode === "conflict") {
        return Response.json({ error: "Social Crew changed before this request." }, { status: 409 });
      }
      const crew = crewPayload();
      crew.plan.plan.status = "completed";
      const response = Response.json({ crew, created: true }, { status: 201 });
      if (state.completionMode === "deferred") {
        return new Promise<Response>((resolve) => {
          state.deferredCompletionResponses.push(() => resolve(response));
        });
      }
      return response;
    }
    if (url === `/api/social/crews/${CREW_ID}`) {
      state.crewReadCount += 1;
      if (state.crewMissing) return Response.json({}, { status: 404 });
      if (state.crewUnavailableAfterFirst && state.crewReadCount > 1) {
        return Response.json({}, { status: 503 });
      }
      return Response.json(crewPayload());
    }
    if (url === `/api/social/crews/${CREW_ID}/join-requests` && !init?.method) {
      if (state.queueMissing) {
        return Response.json({}, { status: 404 });
      }
      const payload = {
        items: state.queue.slice(0, 50).map((request) =>
          state.accountRevision === 2
            ? { ...request, requesterHandle: "carol" }
            : request,
        ),
        hasMore: state.queue.length > 50,
      };
      if (state.deferQueueForRevision === state.accountRevision) {
        return new Promise<Response>((resolve) => {
          state.deferredQueueResponses.push(() => resolve(Response.json(payload)));
        });
      }
      return Response.json(payload);
    }
    if (url.includes("/join-requests/") && init?.method === "PATCH") {
      state.decisions.push(String(init.body));
      const requestId = decodeURIComponent(url.split("/").at(-1) ?? "");
      state.queue = state.queue.filter((request) => request.requestId !== requestId);
      if (state.decisionFails) {
        return Response.json(
          { error: "Social Crew changed before this request." },
          { status: 409 },
        );
      }
      return Response.json({ code: "accepted", replayed: false });
    }
    if (url === "/api/social/access") {
      return Response.json(
        state.accessStatus === 200
          ? { viewerHandle: state.accountRevision === 2 ? "carol" : "alice" }
          : {},
        { status: state.accessStatus },
      );
    }
    return Response.json({}, { status: 404 });
  }),
}));

import CrewDetailClient from "@/app/social/crews/[crewId]/CrewDetailClient";

let container: HTMLDivElement;
let root: Root;

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

beforeEach(() => {
  state.queue = [
    {
      requestId: REQUEST_ID,
      requesterHandle: "bob",
    },
  ];
  state.decisions = [];
  state.visibility = "open";
  state.identityResolved = true;
  state.provider = "supabase";
  state.providerUserId = "supabase-actor-a";
  state.accountRevision = 1;
  state.decisionFails = false;
  state.queueMissing = false;
  state.crewMissing = false;
  state.accessStatus = 403;
  state.deferQueueForRevision = 0;
  state.deferredQueueResponses = [];
  state.deferLotForRevision = 0;
  state.deferredLotResponses = [];
  responseBody.discardBody.mockReset();
  state.crewReadCount = 0;
  state.crewUnavailableAfterFirst = false;
  state.viewerRole = "owner";
  state.planStatus = "ready";
  state.planStops = [];
  state.completionBodies = [];
  state.completionMode = "ok";
  state.deferredCompletionResponses = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      const revision = state.accountRevision;
      const response = Response.json({
        lot: [revision === 2 ? "dave" : "bob-from-old-account"],
      });
      if (state.deferLotForRevision === revision) {
        return new Promise<Response>((resolve) => {
          state.deferredLotResponses.push(() => resolve(response));
        });
      }
      return response;
    }),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("host join-request queue", () => {
  it("lets a host accept a pending request from the crew page", async () => {
    await act(async () => {
      root.render(createElement(CrewDetailClient, { crewId: CREW_ID, invitationId: null }));
    });
    await settle();

    expect(container.textContent).toContain("Requests to join");
    expect(container.textContent).toContain("@bob");
    const accept = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Accept",
    );
    expect(accept).toBeDefined();

    await act(async () => accept!.click());
    await settle();

    expect(state.decisions).toEqual([JSON.stringify({ decision: "accept" })]);
    expect(container.querySelector('a[href="/u/bob"]')).toBeNull();
    expect(container.textContent).toContain("@bob joined the crew.");
    expect(container.textContent).toContain("No one has asked to join.");
    expect(document.activeElement?.id).toBe("crew-join-requests-title");
  });

  it("does not open the host queue for a friends-only crew", async () => {
    state.visibility = "friends";
    await act(async () => {
      root.render(createElement(CrewDetailClient, { crewId: CREW_ID, invitationId: null }));
    });
    await settle();

    expect(container.textContent).not.toContain("Requests to join");
    expect(container.querySelector('a[href="/u/bob"]')).toBeNull();
  });

  it("loads the next request after a decision at the 50-row boundary", async () => {
    state.queue = Array.from({ length: 51 }, (_, index) => ({
      requestId: `80000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      requesterHandle: `bob${index + 1}`,
    }));
    await act(async () => {
      root.render(createElement(CrewDetailClient, { crewId: CREW_ID, invitationId: null }));
    });
    await settle();

    expect(container.textContent).toContain("More requests are waiting.");
    expect(container.textContent).not.toContain("@bob51");
    const firstAccept = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Accept @bob1"]',
    );
    expect(firstAccept).not.toBeNull();

    await act(async () => firstAccept!.click());
    await settle();

    expect(container.textContent).toContain("@bob51");
    expect(container.textContent).not.toContain("More requests are waiting.");
  });

  it("hides a loaded private queue while identity is unresolved", async () => {
    await act(async () => {
      root.render(createElement(CrewDetailClient, { crewId: CREW_ID, invitationId: null }));
    });
    await settle();
    expect(container.textContent).toContain("@bob");

    state.identityResolved = false;
    await act(async () => {
      root.render(createElement(CrewDetailClient, { crewId: CREW_ID, invitationId: null }));
    });

    expect(container.textContent).not.toContain("@bob");
  });

  it("clears a decision notice when identity becomes unresolved", async () => {
    await act(async () => {
      root.render(createElement(CrewDetailClient, { crewId: CREW_ID, invitationId: null }));
    });
    await settle();

    const accept = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Accept @bob"]',
    );
    expect(accept).not.toBeNull();
    await act(async () => accept!.click());
    await settle();
    expect(container.textContent).toContain("@bob joined the crew.");

    state.identityResolved = false;
    await act(async () => {
      root.render(createElement(CrewDetailClient, { crewId: CREW_ID, invitationId: null }));
    });

    expect(container.textContent).not.toContain("@bob");
  });

  it("does not carry a host decision notice into a resolved sign-out", async () => {
    await act(async () => {
      root.render(createElement(CrewDetailClient, { crewId: CREW_ID, invitationId: null }));
    });
    await settle();

    const accept = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Accept @bob"]',
    );
    expect(accept).not.toBeNull();
    await act(async () => accept!.click());
    await settle();
    expect(container.textContent).toContain("@bob joined the crew.");

    state.provider = "signed-out";
    state.accountRevision = 2;
    await act(async () => {
      root.render(createElement(CrewDetailClient, { crewId: CREW_ID, invitationId: null }));
    });
    await settle();

    expect(container.textContent).not.toContain("@bob");
  });

  it("does not show protected feedback above a failed crew refresh", async () => {
    await act(async () => {
      root.render(createElement(CrewDetailClient, { crewId: CREW_ID, invitationId: null }));
    });
    await settle();
    state.crewUnavailableAfterFirst = true;

    const accept = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Accept @bob"]',
    );
    expect(accept).not.toBeNull();
    await act(async () => accept!.click());
    await settle();

    expect(container.textContent).toContain("Could not load this crew.");
    expect(container.textContent).not.toContain("@bob joined the crew.");
  });

  it("does not restore the previous host queue before a new identity refresh", async () => {
    await act(async () => {
      root.render(createElement(CrewDetailClient, { crewId: CREW_ID, invitationId: null }));
    });
    await settle();
    expect(container.textContent).toContain("@bob");

    state.identityResolved = false;
    await act(async () => {
      root.render(createElement(CrewDetailClient, { crewId: CREW_ID, invitationId: null }));
    });
    state.identityResolved = true;
    state.accountRevision = 2;
    await act(async () => {
      root.render(createElement(CrewDetailClient, { crewId: CREW_ID, invitationId: null }));
    });

    expect(container.textContent).not.toContain("@bob");
    await settle();
    expect(container.textContent).toContain("@carol");
  });

  it("ignores a delayed queue response from the previous account", async () => {
    await act(async () => {
      root.render(createElement(CrewDetailClient, { crewId: CREW_ID, invitationId: null }));
    });
    await settle();

    state.deferQueueForRevision = 1;
    state.identityResolved = false;
    await act(async () => {
      root.render(createElement(CrewDetailClient, { crewId: CREW_ID, invitationId: null }));
    });
    state.identityResolved = true;
    await act(async () => {
      root.render(createElement(CrewDetailClient, { crewId: CREW_ID, invitationId: null }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(state.deferredQueueResponses).toHaveLength(1);

    state.identityResolved = false;
    await act(async () => {
      root.render(createElement(CrewDetailClient, { crewId: CREW_ID, invitationId: null }));
    });
    state.accountRevision = 2;
    state.deferQueueForRevision = 0;
    state.identityResolved = true;
    await act(async () => {
      root.render(createElement(CrewDetailClient, { crewId: CREW_ID, invitationId: null }));
    });
    await settle();
    expect(container.textContent).toContain("@carol");

    await act(async () => state.deferredQueueResponses[0]?.());
    await settle();

    expect(container.textContent).toContain("@carol");
    expect(container.textContent).not.toContain("@bob");
  });

  it("reloads the invite lot and ignores a delayed prior-account response", async () => {
    state.accessStatus = 200;
    state.deferLotForRevision = 1;
    await act(async () => {
      root.render(createElement(CrewDetailClient, { crewId: CREW_ID, invitationId: null }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(state.deferredLotResponses).toHaveLength(1);

    state.accountRevision = 2;
    state.deferLotForRevision = 0;
    await act(async () => {
      root.render(createElement(CrewDetailClient, { crewId: CREW_ID, invitationId: null }));
    });
    await settle();
    expect(container.textContent).toContain("@dave");

    await act(async () => state.deferredLotResponses[0]?.());
    await settle();

    expect(container.textContent).toContain("@dave");
    expect(container.textContent).not.toContain("@bob-from-old-account");
  });

  it("refreshes a request that another manager decided first", async () => {
    state.decisionFails = true;
    await act(async () => {
      root.render(createElement(CrewDetailClient, { crewId: CREW_ID, invitationId: null }));
    });
    await settle();

    const accept = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Accept @bob"]',
    );
    expect(accept).not.toBeNull();
    await act(async () => accept!.click());
    await settle();

    expect(container.querySelector('a[href="/u/bob"]')).toBeNull();
    expect(container.textContent).toContain("Social Crew changed before this request.");
    expect(document.activeElement?.id).toBe("crew-join-requests-title");
  });

  it("drops a stale manager queue when crew authority changes", async () => {
    state.queueMissing = true;
    await act(async () => {
      root.render(createElement(CrewDetailClient, { crewId: CREW_ID, invitationId: null }));
    });
    await settle();

    expect(container.textContent).not.toContain("Could not load join requests.");
    expect(container.textContent).not.toContain("Requests to join");
    expect(container.querySelector('a[href="/u/bob"]')).toBeNull();
    expect(state.crewReadCount).toBe(2);
  });

  it("discards crew and queue 404 response bodies", async () => {
    state.accessStatus = 200;
    state.crewMissing = true;
    await act(async () => {
      root.render(createElement(CrewDetailClient, { crewId: CREW_ID, invitationId: null }));
    });
    await settle();
    expect(responseBody.discardBody).toHaveBeenCalledTimes(1);

    responseBody.discardBody.mockReset();
    state.crewMissing = false;
    state.queueMissing = true;
    state.accountRevision = 2;
    await act(async () => {
      root.render(createElement(CrewDetailClient, { crewId: CREW_ID, invitationId: null }));
    });
    await settle();
    expect(responseBody.discardBody).toHaveBeenCalledTimes(2);
  });
});


describe("Social Crew owner completion", () => {
  beforeEach(() => {
    state.visibility = "friends";
    state.planStops = [
      { venueId: "venue-a", venueName: "First pub", position: 0 },
      { venueId: "venue-b", venueName: "Second pub", position: 1 },
      { venueId: "venue-c", venueName: "Third pub", position: 2 },
    ];
  });

  it("lets an owner select an arrival before saving the night ending", async () => {
    await act(async () => {
      root.render(createElement(CrewDetailClient, { crewId: CREW_ID, invitationId: null }));
    });
    await settle();

    expect(container.textContent).toContain("End this night");
    const arrival = container.querySelector<HTMLSelectElement>('.crews__field select');
    expect(arrival).not.toBeNull();
    expect(Array.from(arrival!.options).map((option) => option.textContent))
      .toEqual(["Choose a stop", "First pub", "Second pub", "Third pub"]);
    const save = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Save ending: got home");
    expect(save).toBeDefined();
    expect(save!.disabled).toBe(true);
    await act(async () => {
      arrival!.value = "1";
      arrival!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(save!.disabled).toBe(false);
  });

  async function chooseArrival(): Promise<HTMLButtonElement> {
    await act(async () => {
      root.render(createElement(CrewDetailClient, { crewId: CREW_ID, invitationId: null }));
    });
    await settle();
    const arrival = container.querySelector<HTMLSelectElement>('.crews__field select');
    expect(arrival).not.toBeNull();
    await act(async () => {
      arrival!.value = "1";
      arrival!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const save = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Save ending: got home");
    expect(save).toBeDefined();
    return save!;
  }

  it("saves one chosen arrival on two immediate taps and adopts the completed Plan", async () => {
    const save = await chooseArrival();
    await act(async () => { save.click(); save.click(); });
    await settle();
    expect(state.completionBodies).toHaveLength(1);
    expect(state.completionBodies[0]).toMatchObject({
      expectedRouteRevision: 1,
      arrivedStopPosition: 1,
      ending: "get_home",
      endingSelection: { kind: "get_home", optionId: "transport:got-home" },
    });
    expect(Object.keys(state.completionBodies[0]!).sort()).toEqual([
      "arrivedStopPosition", "ending", "endingSelection", "expectedRouteRevision",
    ]);
    expect(container.textContent).toContain("Night saved. Your crew's Plan is complete.");
    expect(container.textContent).not.toContain("End this night");
  });

  it("keeps a chosen arrival after conflict and allows a successful retry", async () => {
    state.completionMode = "conflict";
    const save = await chooseArrival();
    await act(async () => save.click());
    await settle();
    expect(container.textContent).toContain("Social Crew changed before this request.");
    expect(container.querySelector<HTMLSelectElement>('.crews__field select')?.value).toBe("1");
    expect(save.disabled).toBe(false);
    state.completionMode = "ok";
    await act(async () => save.click());
    await settle();
    expect(state.completionBodies).toHaveLength(2);
    expect(container.textContent).toContain("Night saved. Your crew's Plan is complete.");
  });

  it("does not adopt a deferred owner completion after the account changes", async () => {
    state.completionMode = "deferred";
    const save = await chooseArrival();
    await act(async () => save.click());
    expect(state.deferredCompletionResponses).toHaveLength(1);
    state.accountRevision = 2;
    state.viewerRole = "member";
    await act(async () => {
      root.render(createElement(CrewDetailClient, { crewId: CREW_ID, invitationId: null }));
    });
    await settle();
    const memberMetadata = container.querySelector('.crewPage__meta')?.textContent;
    expect(memberMetadata).toBeTruthy();
    await act(async () => state.deferredCompletionResponses[0]?.());
    await settle();
    expect(container.querySelector('.crewPage__meta')?.textContent).toBe(memberMetadata);
    expect(container.textContent).not.toContain("Night saved. Your crew's Plan is complete.");
    expect(container.textContent).not.toContain("End this night");
  });

  it.each([
    ["member", "ready"],
    ["owner", "completed"],
    ["owner", "abandoned"],
  ] as const)("does not offer completion to %s on a %s Plan", async (role, status) => {
    state.viewerRole = role;
    state.planStatus = status;
    await act(async () => {
      root.render(createElement(CrewDetailClient, { crewId: CREW_ID, invitationId: null }));
    });
    await settle();
    expect(container.querySelector("h1")?.textContent).toBe("Open Friday");
    expect(container.querySelector('a[href="/u/alice"]')).not.toBeNull();
    expect(container.textContent).not.toContain("End this night");
    expect(Array.from(container.querySelectorAll("button"))
      .some((button) => button.textContent === "Save ending: got home")).toBe(false);
  });
});
