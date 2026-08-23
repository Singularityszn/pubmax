// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const CREW_A = "50000000-0000-4000-8000-000000000001";
const CREW_B = "50000000-0000-4000-8000-000000000002";

const state = vi.hoisted(() => ({
  identityResolved: true,
  userId: "actor-a" as string | null,
  privateState: "none" as "none" | "pending" | "member",
  publicResponses: new Map<string, "ready" | "deferred">(),
  deferredPublic: new Map<string, Array<(response: Response) => void>>(),
  deferredJoin: [] as Array<(response: Response) => void>,
  actionCalls: [] as string[],
}));

function preview(crewId: string, title = crewId === CREW_A ? "Friday in Camden" : "Saturday in Soho") {
  return {
    kind: "public" as const,
    crewId,
    title,
    hostHandle: "host",
    startsAt: "2026-08-23T18:30:00.000Z",
    meetingPoint: {
      kind: "venue" as const,
      name: crewId === CREW_A ? "Camden Arms" : "Soho Arms",
      lat: 51.541,
      lng: -0.142,
    },
  };
}

function privatePreview(crewId: string) {
  return {
    kind: "preview",
    title: preview(crewId).title,
    phase: "planning",
    nightArea: "london",
    startsAt: "2026-08-23T18:30:00.000Z",
    joinRequestState: state.privateState === "pending" ? "pending" : "none",
  };
}

function privateMember(crewId: string) {
  return {
    kind: "member",
    crewId,
    title: preview(crewId).title,
    visibility: "open",
    phase: "planning",
    nightArea: "london",
    startsAt: "2026-08-23T18:30:00.000Z",
    authorityRevision: 1,
    viewer: {
      memberId: "30000000-0000-4000-8000-000000000001",
      role: "member",
    },
    owner: {
      memberId: "30000000-0000-4000-8000-000000000002",
      handle: "host",
    },
    members: [],
  };
}

function publicResponse(crewId: string): Response {
  return Response.json(preview(crewId));
}

function actionResponse(crewId: string): Response {
  if (state.privateState === "member") return Response.json(privateMember(crewId));
  return Response.json(privatePreview(crewId));
}

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    createElement("a", { href: String(href), ...props }, children),
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    // A Clerk-backed Social identity has no Supabase session. The component
    // must still use the provider-neutral resolved identity seam.
    identityResolved: state.identityResolved,
    session: null,
    user: state.userId ? { id: state.userId } : null,
  }),
}));

vi.mock("@/components/nav/SiteNav", () => ({
  default: () => createElement("nav", null, "Navigation"),
}));

vi.mock("@/app/social/crews/[crewId]/CrewDetailClient", () => ({
  default: ({ crewId }: { crewId: string }) =>
    createElement("div", { "data-testid": "crew-detail" }, `Member detail ${crewId}`),
}));

vi.mock("@/lib/authedFetch", () => ({
  authedActionFetch: vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    state.actionCalls.push(`${init?.method ?? "GET"} ${url}`);
    if (init?.method === "POST" && url.endsWith("/join-requests")) {
      return new Promise<Response>((resolve) => state.deferredJoin.push(resolve));
    }
    const crewId = url.includes(CREW_B) ? CREW_B : CREW_A;
    return Promise.resolve(actionResponse(crewId));
  }),
}));

import PublicCrewRouteClient from "@/components/social/PublicCrewRouteClient";

let container: HTMLDivElement;
let root: Root;

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 15));
  });
}

beforeEach(() => {
  state.identityResolved = true;
  state.userId = "actor-a";
  state.privateState = "none";
  state.publicResponses = new Map([
    [CREW_A, "ready"],
    [CREW_B, "ready"],
  ]);
  state.deferredPublic = new Map();
  state.deferredJoin = [];
  state.actionCalls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      const crewId = url.includes(CREW_B) ? CREW_B : CREW_A;
      if (state.publicResponses.get(crewId) === "deferred") {
        return new Promise<Response>((resolve) => {
          const pending = state.deferredPublic.get(crewId) ?? [];
          pending.push(resolve);
          state.deferredPublic.set(crewId, pending);
        });
      }
      return Promise.resolve(publicResponse(crewId));
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

describe("PublicCrewRouteClient identity and crew boundaries", () => {
  it("loads protected Social state when identity is resolved without a Supabase session", async () => {
    state.privateState = "member";
    await act(async () => {
      root.render(createElement(PublicCrewRouteClient, { crewId: CREW_A, invitationId: null }));
    });
    await settle();

    expect(state.actionCalls).toContain(`GET /api/social/crews/${CREW_A}`);
    expect(container.querySelector('[data-testid="crew-detail"]')).not.toBeNull();
  });

  it("clears private join state when the account identity changes", async () => {
    state.privateState = "pending";
    await act(async () => {
      root.render(createElement(PublicCrewRouteClient, { crewId: CREW_A, invitationId: null }));
    });
    await settle();
    expect(container.textContent).toContain("Request sent. The host decides.");

    state.userId = "actor-b";
    state.privateState = "none";
    await act(async () => {
      root.render(createElement(PublicCrewRouteClient, { crewId: CREW_A, invitationId: null }));
    });
    await settle();

    expect(container.textContent).not.toContain("Request sent. The host decides.");
  });

  it("does not retain the previous crew preview while the next crew loads", async () => {
    await act(async () => {
      root.render(createElement(PublicCrewRouteClient, { crewId: CREW_A, invitationId: null }));
    });
    await settle();
    expect(container.textContent).toContain("Friday in Camden");

    state.publicResponses.set(CREW_B, "deferred");
    await act(async () => {
      root.render(createElement(PublicCrewRouteClient, { crewId: CREW_B, invitationId: null }));
    });

    expect(container.textContent).not.toContain("Friday in Camden");
    expect(container.textContent).not.toContain("Camden Arms");
  });

  it("ignores a delayed join response after navigating to another crew", async () => {
    await act(async () => {
      root.render(createElement(PublicCrewRouteClient, { crewId: CREW_A, invitationId: null }));
    });
    await settle();

    const ask = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "Ask to join",
    );
    expect(ask).not.toBeUndefined();
    await act(async () => ask?.click());
    expect(state.deferredJoin).toHaveLength(1);

    await act(async () => {
      root.render(createElement(PublicCrewRouteClient, { crewId: CREW_B, invitationId: null }));
    });
    await settle();
    await act(async () => state.deferredJoin[0]?.(Response.json({ code: "requested" })));
    await settle();

    expect(container.textContent).toContain("Saturday in Soho");
    expect(container.textContent).not.toContain("Request sent. The host decides.");
  });
});
