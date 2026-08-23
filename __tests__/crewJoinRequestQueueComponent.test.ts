// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const CREW_ID = "50000000-0000-4000-8000-000000000001";
const REQUEST_ID = "80000000-0000-4000-8000-000000000001";

const state = vi.hoisted(() => ({
  queue: [
    {
      requestId: "80000000-0000-4000-8000-000000000001",
      requesterHandle: "bob",
    },
  ],
  decisions: [] as string[],
  visibility: "open" as "open" | "friends",
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    createElement("a", { href: String(href), ...props }, children),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ identityResolved: true }),
}));

vi.mock("@/components/nav/SiteNav", () => ({
  default: () => createElement("nav", null, "Navigation"),
}));

vi.mock("@/lib/authedFetch", () => ({
  authedActionFetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === `/api/social/crews/${CREW_ID}`) {
      return Response.json({
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
          role: "owner",
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
            status: "ready",
          },
          stops: [],
          context: null,
          actions: [],
          ending: null,
        },
      });
    }
    if (url === `/api/social/crews/${CREW_ID}/join-requests` && !init?.method) {
      return Response.json({
        items: state.queue.slice(0, 50),
        hasMore: state.queue.length > 50,
      });
    }
    if (url.includes("/join-requests/") && init?.method === "PATCH") {
      state.decisions.push(String(init.body));
      const requestId = decodeURIComponent(url.split("/").at(-1) ?? "");
      state.queue = state.queue.filter((request) => request.requestId !== requestId);
      return Response.json({ code: "accepted", replayed: false });
    }
    if (url === "/api/social/access") {
      return Response.json({}, { status: 403 });
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
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
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
});
