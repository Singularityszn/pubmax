// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import NightCrawlMode from "@/components/plan/NightCrawlMode";
import { markActivePlan, readActivePlan, setActivePlanStopIndex } from "@/lib/activePlan";
import { clearPlanCapability, PLAN_HTTP_ONLY_SESSION, writePlanCapability } from "@/lib/planSessionCapability";
import { __resetPlanMutationOutboxForTests, listPlanMutationOutbox } from "@/lib/planMutationOutbox";
import type { PlanState } from "@/lib/plan";

const planId = "11111111-1111-4111-8111-111111111111";
const plan: PlanState = {
  plan: { id: planId, title: "Tonight", startTime: new Date().toISOString(), createdAt: new Date().toISOString() },
  stops: [{ venueId: "first", venueName: "First Arms", position: 0 }, { venueId: "second", venueName: "Second Arms", position: 1 }],
  crew: [], actions: [],
};
let host: HTMLDivElement;
let root: Root;
let actionStatus: number | "network";
let actionCalls: number;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  localStorage.clear();
  sessionStorage.clear();
  __resetPlanMutationOutboxForTests();
  markActivePlan(planId, plan.plan.startTime);
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  actionStatus = 200;
  actionCalls = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).endsWith("/actions")) {
      actionCalls += 1;
      if (actionStatus === "network") throw new TypeError("offline");
      return Response.json(actionStatus === 200 ? plan : {
        error: { code: actionStatus === 403 ? "PLAN_ACTION_FORBIDDEN" : "MALFORMED_REQUEST", retryable: false },
      }, { status: actionStatus });
    }
    return Response.json(plan);
  }));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  clearPlanCapability(planId);
  __resetPlanMutationOutboxForTests();
  vi.unstubAllGlobals();
});

async function render(role: "host" | "guest", collaborationAuthorized: boolean) {
  writePlanCapability(planId, { token: PLAN_HTTP_ONLY_SESSION, role, collaborationAuthorized });
  await act(async () => root.render(createElement(NightCrawlMode, { planId, initialState: plan })));
}

// The outbox flush runs on fetch and Response.json() promises that settle
// outside a single act() turn, later on a loaded machine. Each poll flushes
// React's queued work first, because an update made inside one long act()
// scope is not committed until that scope ends.
async function settle(check: () => void) {
  await vi.waitFor(async () => {
    await act(async () => {});
    check();
  }, { timeout: 5_000 });
}

function action(label: string) {
  return [...host.querySelectorAll("button")].find((button) => button.textContent?.startsWith(label));
}

// The action buttons stay disabled while a tap is in flight, as a person sees
// them, so a tap is finished only once they are enabled again.
async function tap(label: string) {
  await act(async () => action(label)!.click());
  await settle(() => {
    for (const button of host.querySelectorAll<HTMLButtonElement>(".nightCrawl__actions button")) {
      expect(button.disabled).toBe(false);
    }
  });
}

describe("Night mode action permissions and recovery", () => {
  it.each([false, true])("reads the route after bootstrap and removes it after revocation (collapsed: %s)", async (collapsed) => {
    const preview = { visibility: "preview", stopCount: 2 };
    const initialState = { ...plan, stops: [], crew: [], actions: [] };
    let releaseSession!: (response: Response) => void;
    const session = new Promise<Response>((resolve) => { releaseSession = resolve; });
    let member = false;
    let previewReads = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/session")) {
        return member ? Response.json({ active: false }) : session;
      }
      if (!member) previewReads += 1;
      return Response.json(member ? plan : preview);
    }));
    await act(async () => root.render(createElement(NightCrawlMode, { planId, initialState })));
    await settle(() => {
      expect(previewReads).toBeGreaterThan(0);
      expect(host.querySelector('[role="dialog"]')).not.toBeNull();
      expect(host.querySelector(".nightCrawl__heroName")).toBeNull();
    });
    await act(async () => {
      member = true;
      releaseSession(Response.json({ active: true, role: "guest", collaborationAuthorized: false }));
    });
    await settle(() => expect(host.querySelector(".nightCrawl__heroName")?.textContent).toBe("First Arms"));
    expect(action("We are here")).toBeUndefined();
    expect(action("Skip it")).toBeUndefined();

    let releaseOldRead!: (response: Response) => void;
    const oldRead = new Promise<Response>((resolve) => { releaseOldRead = resolve; });
    let oldReadStarted = false;
    vi.mocked(fetch).mockImplementation(async () => {
      oldReadStarted = true;
      return oldRead;
    });
    await act(async () => writePlanCapability(planId, {
      token: PLAN_HTTP_ONLY_SESSION, role: "guest", collaborationAuthorized: true,
    }));
    await settle(() => expect(oldReadStarted).toBe(true));
    if (collapsed) await act(async () => action("View full plan")!.click());
    const readsBeforeRevocation = previewReads;
    // The server has revoked access. The new capability snapshot triggers a
    // preview read even when the overlay is closed.
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input).endsWith("/session")) return Response.json({ active: false });
      previewReads += 1;
      return Response.json(preview);
    });
    await act(async () => clearPlanCapability(planId));
    await settle(() => expect(previewReads).toBeGreaterThan(readsBeforeRevocation));
    await act(async () => releaseOldRead(Response.json(plan)));
    if (collapsed) await act(async () => action("Night mode")!.click());
    expect(host.querySelector(".nightCrawl__heroName")).toBeNull();
    expect(host.textContent).not.toContain("First Arms");
    expect(host.textContent).not.toContain("Second Arms");
    expect(actionCalls).toBe(0);
  });

  it("keeps classic guests on the route without impossible arrival or skip controls", async () => {
    await render("guest", false);
    expect(host.textContent).toContain("First Arms");
    expect(action("We are here")).toBeUndefined();
    expect(action("Skip it")).toBeUndefined();
    expect(host.textContent).toMatch(/host|update/i);
    expect(host.querySelector('a[href="https://tfl.gov.uk/plan-a-journey/"]')).not.toBeNull();
    expect(actionCalls).toBe(0);
  });

  it.each(["host", "guest"] as const)("lets an authorized %s arrive and skip", async (role) => {
    await render(role, true);
    for (const label of ["We are here", "Skip it"]) {
      await tap(label);
      expect(readActivePlan()?.stopIndex).toBe(1);
    }
    await settle(() => {
      expect(actionCalls).toBe(2);
      expect(listPlanMutationOutbox(planId)).toEqual([]);
    });
  });

  it.each([403, 400] as const)("rolls back HTTP %s without suggesting a signal retry", async (status) => {
    actionStatus = status;
    await render("host", true);
    await tap("Skip it");
    await settle(() => {
      expect(readActivePlan()?.stopIndex).toBe(0);
      expect(host.textContent).toContain("Stop 1 of 2");
      expect(host.querySelector('[role="status"][data-tone]')?.textContent).toMatch(
        status === 403 ? /permission|host/i : /rejected|full plan/i,
      );
    });
    const note = host.querySelector('[role="status"]');
    expect(note?.textContent).not.toMatch(/signal/i);
    await act(async () => window.dispatchEvent(new Event("online")));
    expect(actionCalls).toBe(1);
  });

  it("holds an offline action and confirms it when signal returns", async () => {
    actionStatus = "network";
    await render("host", true);
    await tap("We are here");
    await settle(() => {
      expect(readActivePlan()?.stopIndex).toBe(1);
      expect(host.textContent).toContain("Held on this phone");
      expect(listPlanMutationOutbox(planId)[0]?.status).toBe("pending");
    });
    const attemptsBeforeOnline = actionCalls;
    actionStatus = 200;
    await act(async () => window.dispatchEvent(new Event("online")));
    await settle(() => {
      expect(actionCalls).toBe(attemptsBeforeOnline + 1);
      expect(listPlanMutationOutbox(planId)).toEqual([]);
      expect(host.textContent).not.toContain("Held on this phone");
    });
  });
});

it.each([0, 1])("reveals the stamped completed pub with a stale device cursor at %s after a safe revision", async (cursor) => {
  const revised: PlanState = {
    ...plan,
    plan: { ...plan.plan, routeRevision: 2 },
    stops: [...plan.stops, { venueId: "replacement", venueName: "Later Replacement", position: 2 }],
    actions: [{ id: "arrival-at-second", type: "arrived", stopPosition: 1, ending: null,
      createdAt: new Date().toISOString(), routeRevision: 1, venueId: "second" }],
  };
  setActivePlanStopIndex(cursor);
  writePlanCapability(planId, { token: PLAN_HTTP_ONLY_SESSION, role: "guest", collaborationAuthorized: true });
  const calls: Array<{ url: string; method: string }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET" });
    if (url.endsWith("/presentation")) return Response.json({ memberId: "guest-seat", canEdit: false, mysteryEnabled: true, routeRevision: 2 });
    return Response.json(revised);
  }));
  await act(async () => root.render(createElement(NightCrawlMode, { planId, initialState: revised })));
  await settle(() => expect(action("Show full route")).toBeDefined());
  const glance = host.querySelector(cursor === 0 ? ".nightCrawl__glanceNext" : ".nightCrawl__glanceNow");
  expect(glance?.textContent).toContain("Second Arms");
  expect(host.querySelector(cursor === 0 ? ".nightCrawl__upcomingName" : ".nightCrawl__heroName")?.textContent).toContain("Second Arms");
  expect(action("Open stop 2")).toBeUndefined();
  expect(action("Open stop 3")).toBeDefined();
  expect(host.textContent).not.toContain("Later Replacement");
  await act(async () => action("Show full route")!.click());
  expect(host.textContent).toContain("Later Replacement");
  expect(calls.every((call) => call.method === "GET")).toBe(true);
  expect(readActivePlan()?.stopIndex).toBe(cursor);
});
