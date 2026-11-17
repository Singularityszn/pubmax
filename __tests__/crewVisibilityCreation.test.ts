// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  identityResolved: true,
  user: { id: "account-a" } as { id: string } | null,
}));
const authedActionFetch = vi.hoisted(() => vi.fn());

const PLAN_ID = "60000000-0000-4000-8000-000000000001";
const CREW_ID = "50000000-0000-4000-8000-000000000001";

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => authState,
}));
vi.mock("@/lib/authedFetch", () => ({ authedActionFetch }));

import CrewsPanel from "@/components/social/CrewsPanel";
import { CREW_VISIBILITY_LABEL } from "@/lib/socialCrewsUi";
import { SOCIAL_CREW_HOST_CAPABILITY_HEADER, SOCIAL_CREW_VISIBILITIES } from "@/lib/socialCrew";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  authState.identityResolved = true;
  authState.user = { id: "account-a" };
  authedActionFetch.mockReset();
  authedActionFetch.mockResolvedValue(
    new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 }),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  vi.useRealTimers();
  await act(async () => root.unmount());
  container.remove();
});

const PLAN_TOKEN = "plan-token";

function mockStartCrewRequests(crewResponse: () => Response) {
  authedActionFetch.mockImplementation(async (url: string, options?: RequestInit) => {
    if (url === "/api/social/crews" && !options?.method) {
      return new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 });
    }
    if (url.startsWith("/api/social/venues")) {
      return new Response(
        JSON.stringify({ venues: [{ id: "venue-a", name: "The First", borough: "Camden" }] }),
        { status: 200 },
      );
    }
    if (url === "/api/plans") {
      return new Response(
        JSON.stringify({ plan: { plan: { id: PLAN_ID } }, memberToken: PLAN_TOKEN }),
        { status: 201 },
      );
    }
    if (url === "/api/social/crews" && options?.method === "POST") return crewResponse();
    throw new Error(`Unexpected request: ${url}`);
  });
}

async function fillAndSubmitCrewForm() {
    vi.useFakeTimers();
    await act(async () => {
      root.render(createElement(CrewsPanel, { viewerHandle: "alice" }));
    });
    const startButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Start a crew",
    );
    await act(async () => startButton?.click());

    const name = container.querySelector<HTMLInputElement>('input[type="text"]');
    expect(name).toBeTruthy();
    const search = container.querySelector<HTMLInputElement>('input[type="search"]');
    expect(search).toBeTruthy();
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setValue.call(name, "Friday in Camden");
      name!.dispatchEvent(new Event("input", { bubbles: true }));
      setValue.call(search, "First");
      search!.dispatchEvent(new Event("input", { bubbles: true }));
      await vi.advanceTimersByTimeAsync(220);
      await Promise.resolve();
      await Promise.resolve();
    });
    const venueButton = container.querySelector<HTMLButtonElement>(".crews__venueOption");
    expect(venueButton).toBeTruthy();
    await act(async () => venueButton?.click());

    const openRadio = container.querySelector<HTMLInputElement>('input[value="open"]');
    expect(openRadio).toBeTruthy();
    await act(async () => openRadio?.click());
    const submitButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Start the crew",
    );
    await act(async () => submitButton?.click());
}

function stubPlanCleanup() {
  const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function expectPlanRetired(fetchMock: ReturnType<typeof stubPlanCleanup>) {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe(`/api/plans/${PLAN_ID}`);
  expect(init.method).toBe("PATCH");
  expect(JSON.parse(init.body as string)).toEqual({
    status: "abandoned",
    memberToken: PLAN_TOKEN,
  });
}

describe("crew list filters", () => {
  it("offers no phase counts or filters while more crew rows remain unread", async () => {
    authedActionFetch.mockResolvedValue(Response.json({
      items: [1, 2].map((index) => ({
        kind: "member",
        crewId: `50000000-0000-4000-8000-00000000000${index}`,
        title: `Camden crew ${index}`,
        phase: "planning",
        nightArea: "Camden",
        startsAt: "2026-10-26T18:30:00.000Z",
        viewer: { memberId: "30000000-0000-4000-8000-000000000001", role: "member" },
      })),
      nextCursor: "another-page",
    }));
    await act(async () => root.render(createElement(CrewsPanel, { viewerHandle: "alice" })));
    expect(container.querySelectorAll(".crews__row")).toHaveLength(2);
    expect(container.querySelector(".crews__filters")).toBeNull();
    expect(container.textContent).not.toContain("No crews match this filter.");
  });

  it("filters real crew rows by phase and keeps the crew route reachable", async () => {
    const phases = ["planning", "live"] as const;
    authedActionFetch.mockResolvedValue(Response.json({
      items: phases.map((phase, index) => ({
        kind: "member",
        crewId: `50000000-0000-4000-8000-00000000000${index + 1}`,
        title: ["Friday in Camden", "Round at the Crown"][index],
        phase,
        nightArea: "Camden",
        startsAt: "2026-10-26T18:30:00.000Z",
        viewer: { memberId: "30000000-0000-4000-8000-000000000001", role: "member" },
      })),
      nextCursor: null,
    }));
    await act(async () => root.render(createElement(CrewsPanel, { viewerHandle: "alice" })));
    expect(container.querySelectorAll(".crews__row")).toHaveLength(2);
    const filter = container.querySelector<HTMLButtonElement>('button[aria-label="Out now, 1 crew"]');
    expect(filter).not.toBeNull();
    await act(async () => filter!.click());
    expect(filter?.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelectorAll(".crews__row")).toHaveLength(1);
    expect(container.querySelector(".crews__rowLink")?.textContent).toContain("Round at the Crown");
    expect(container.querySelector(".crews__rowLink")?.getAttribute("href")).toBe(
      "/social/crews/50000000-0000-4000-8000-000000000002",
    );
    const doneFilter = container.querySelector<HTMLButtonElement>('button[aria-label="Done, 0 crews"]');
    await act(async () => doneFilter!.click());
    expect(container.querySelectorAll(".crews__row")).toHaveLength(0);
    expect(container.textContent).toContain("No crews match this filter.");
    const reset = [...container.querySelectorAll("button")].find((button) => button.textContent === "Show all crews");
    await act(async () => reset!.click());
    expect(container.querySelectorAll(".crews__row")).toHaveLength(2);
    expect(authedActionFetch).toHaveBeenCalledTimes(1);
  });
});

describe("crew visibility creation", () => {
  it("offers every supported visibility and defaults to invite only", async () => {
    await act(async () => {
      root.render(createElement(CrewsPanel, { viewerHandle: "alice" }));
    });

    const startButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Start a crew",
    );
    expect(startButton).toBeTruthy();

    await act(async () => startButton?.click());

    const radios = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="radio"][name="visibility"]'),
    );
    expect(radios.map((radio) => radio.value)).toEqual([...SOCIAL_CREW_VISIBILITIES]);
    expect(radios.filter((radio) => radio.checked).map((radio) => radio.value)).toEqual([
      "private",
    ]);
    for (const visibility of SOCIAL_CREW_VISIBILITIES) {
      expect(container.textContent).toContain(CREW_VISIBILITY_LABEL[visibility]);
    }
  });

  it("sends selected open visibility after the valid first pub is chosen", async () => {
    mockStartCrewRequests(() =>
      new Response(JSON.stringify({ code: "created", crewId: CREW_ID }), { status: 201 }),
    );
    await fillAndSubmitCrewForm();

    const crewCreateCall = authedActionFetch.mock.calls.find(
      ([url, options]) => url === "/api/social/crews" && options?.method === "POST",
    );
    expect(crewCreateCall).toBeTruthy();
    expect(JSON.parse(crewCreateCall?.[1].body as string)).toMatchObject({
      planId: PLAN_ID,
      visibility: "open",
    });
    vi.useRealTimers();
  });

  it("carries the plan capability in its own header, never in Authorization", async () => {
    mockStartCrewRequests(() =>
      new Response(JSON.stringify({ code: "created", crewId: CREW_ID }), { status: 201 }),
    );
    await fillAndSubmitCrewForm();

    const crewCreateCall = authedActionFetch.mock.calls.find(
      ([url, options]) => url === "/api/social/crews" && options?.method === "POST",
    );
    const headers = crewCreateCall?.[1].headers as Record<string, string>;
    expect(headers[SOCIAL_CREW_HOST_CAPABILITY_HEADER]).toBe(PLAN_TOKEN);
    expect(Object.keys(headers).map((name) => name.toLowerCase())).not.toContain(
      "authorization",
    );
    vi.useRealTimers();
  });

  it.each([
    [
      "refused",
      () =>
        new Response(
          JSON.stringify({ error: "Social Crew request is not valid.", code: "SOCIAL_CREW_INVALID" }),
          { status: 422 },
        ),
      "Social Crew request is not valid.",
    ],
    [
      "accepted without naming a crew",
      () => new Response(JSON.stringify({ code: "created" }), { status: 201 }),
      "Could not start the crew.",
    ],
  ])("retires the plan it made when the crew is %s", async (_, crewResponse, message) => {
    const fetchMock = stubPlanCleanup();
    mockStartCrewRequests(crewResponse);
    await fillAndSubmitCrewForm();

    expectPlanRetired(fetchMock);
    expect(container.textContent).toContain(message);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it.each([
    ["answers 503", () => new Response(JSON.stringify({ error: "Try again." }), { status: 503 })],
    [
      "drops the connection",
      () => {
        throw new TypeError("Failed to fetch");
      },
    ],
    [
      "finds the session waking",
      () => {
        throw Object.assign(new Error("Your session is waking up."), { name: "AuthActionSessionError" });
      },
    ],
  ])("keeps the plan when the crew call %s, since the crew may exist", async (_, failure) => {
    const fetchMock = stubPlanCleanup();
    mockStartCrewRequests(failure);
    await fillAndSubmitCrewForm();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.querySelector(".crews__problem")).toBeTruthy();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
});
