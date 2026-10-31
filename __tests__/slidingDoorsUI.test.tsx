// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SlidingDoors from "@/components/plan/SlidingDoors";
import type { PlanState } from "@/lib/plan";

vi.mock("@/components/plan/PlanRouteMiniMap", () => ({ default: ({ stops }: { stops: Array<{ venueId: string }> }) =>
  createElement("div", { "data-testid": "comparison-map" }, stops.map((stop) => stop.venueId).join(",")) }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const state: PlanState = {
  plan: { id: "plan-one", title: "Friday", startTime: "2026-11-01T18:00:00.000Z", createdAt: "2026-10-31T12:00:00.000Z", routeRevision: 1 },
  stops: ["a", "b", "c"].map((venueId, position) => ({ venueId, venueName: `Pub ${venueId}`, position })), crew: [],
  context: { nightArea: "piccadilly-soho", daypart: "evening", partyType: "friends", groupSize: 3, stopCount: 3, budget: "value", budgetLimitPence: null, zeroProof: false, wetherspoonsPreferred: false, atmosphere: [], foodNeeds: [], accessibility: [], transportConstraints: [] },
};
let root: Root;
let container: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>>;

function button(text: string) {
  const element = Array.from(container.querySelectorAll("button")).find((item) => item.textContent === text);
  if (!element) throw new Error(`Missing control: ${text}`);
  return element;
}

beforeEach(() => {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  fetchMock = vi.fn(async (url: string) => {
    if (url === "/api/plans/generate") return Response.json({ grounded: true, groundingProof: "signed", operationKey: "generation-one", stops: [state.stops[0], { venueId: "d", venueName: "Pub d", position: 1 }, state.stops[1]] });
    if (url.startsWith("/api/venue/")) return Response.json({ venue: { longitude: -0.1, latitude: { a: 51.5, b: 51.51, c: 51.52, d: 51.505 }[url.slice(-1)] } });
    if (url.endsWith("/proposals")) return Response.json({ proposal: { id: "proposal-one" } }, { status: 201 });
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("Sliding Doors controls", () => {
  it("compares without saving, then sends one proposal after an explicit choice", async () => {
    const submitted = vi.fn();
    await act(async () => root.render(createElement(SlidingDoors, { planState: state, memberToken: "guest-token", onProposalCreated: submitted })));
    await act(async () => button("Compare routes").click());
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/proposals"))).toHaveLength(0);
    expect(container.textContent).toContain("straight-line estimate");
    expect(container.querySelectorAll('[data-testid="comparison-map"]')).toHaveLength(1);
    expect(container.querySelector('[data-testid="comparison-map"]')?.textContent).toBe("a,b,c");
    await act(async () => container.querySelector<HTMLInputElement>('input[value="shorter-walk"]')!.click());
    expect(container.querySelector('[data-testid="comparison-map"]')?.textContent).toBe("a,d,b");
    await act(async () => { const send = button("Send route for crew review"); send.click(); send.click(); });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/proposals"))).toHaveLength(1);
    expect(submitted).toHaveBeenCalledTimes(1);
    for (const [url, init] of fetchMock.mock.calls) {
      expect(init?.cache).toBe("no-store");
      expect(new Headers(init?.headers).get("authorization")).toBe(String(url).endsWith("/proposals") ? "Bearer guest-token" : null);
    }
    expect(state.stops.map((stop) => stop.venueId)).toEqual(["a", "b", "c"]);
  });

  it("discards a comparison after the owner or saved revision changes", async () => {
    const props = { planState: state, memberToken: "cookie-seat", ownerKey: "account-one:1", onProposalCreated: vi.fn() };
    await act(async () => root.render(createElement(SlidingDoors, props)));
    await act(async () => button("Compare routes").click());
    expect(container.querySelectorAll('input[type="radio"]')).toHaveLength(2);
    await act(async () => root.render(createElement(SlidingDoors, { ...props, planState: { ...state, plan: { ...state.plan, routeRevision: 2 } } })));
    expect(container.querySelectorAll('input[type="radio"]')).toHaveLength(0);
    expect(container.textContent).toContain("The saved route changed");
    await act(async () => root.render(createElement(SlidingDoors, { ...props, ownerKey: "account-two:2" })));
    expect(container.querySelectorAll('input[type="radio"]')).toHaveLength(0);
    expect(container.textContent).not.toContain("The saved route changed");
  });

  it("reuses the proposal key when a lost response needs a retry", async () => {
    const original = fetchMock.getMockImplementation()!;
    const keys: string[] = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/proposals")) {
        keys.push(new Headers(init?.headers).get("idempotency-key") ?? "");
        if (keys.length === 1) throw new Error("The response was lost.");
      }
      return original(url, init);
    });
    await act(async () => root.render(createElement(SlidingDoors, { planState: state, memberToken: "guest-token", onProposalCreated: vi.fn() })));
    await act(async () => button("Compare routes").click());
    await act(async () => container.querySelector<HTMLInputElement>('input[value="shorter-walk"]')!.click());
    await act(async () => button("Send route for crew review").click());
    await act(async () => button("Send route for crew review").click());
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
  });

  it("keeps retry keys with their payload after a lost response and an option change", async () => {
    const original = fetchMock.getMockImplementation()!;
    const submissions: Array<{ key: string; body: string }> = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/plans/generate") {
        const candidate = await original(url, init);
        const body = await candidate.json();
        const generatedBefore = fetchMock.mock.calls.filter(([path]) => path === "/api/plans/generate").length;
        return Response.json(generatedBefore === 2 ? { ...body, operationKey: "generation-twist", stops: [state.stops[0], state.stops[1], { venueId: "d", venueName: "Pub d", position: 2 }] } : body);
      }
      if (url.endsWith("/proposals")) {
        submissions.push({ key: new Headers(init?.headers).get("idempotency-key") ?? "", body: String(init?.body) });
        throw new Error("The response was lost.");
      }
      return original(url, init);
    });
    await act(async () => root.render(createElement(SlidingDoors, { planState: state, memberToken: "guest-token", onProposalCreated: vi.fn() })));
    await act(async () => button("Compare routes").click());
    await act(async () => container.querySelector<HTMLInputElement>('input[value="shorter-walk"]')!.click());
    await act(async () => button("Send route for crew review").click());
    await act(async () => container.querySelector<HTMLInputElement>('input[value="plot-twist"]')!.click());
    await act(async () => button("Send route for crew review").click());
    await act(async () => container.querySelector<HTMLInputElement>('input[value="shorter-walk"]')!.click());
    await act(async () => button("Send route for crew review").click());
    expect(submissions).toHaveLength(3);
    expect(submissions[0]!.key).toBeTruthy();
    expect(submissions[1]!.key).not.toBe(submissions[0]!.key);
    expect(submissions[2]).toEqual(submissions[0]);
    expect(JSON.parse(submissions[1]!.body).stops.map((stop: { venueId: string }) => stop.venueId)).toEqual(["a", "b", "d"]);
  });

  it.each(["fetch", "body"])("releases comparison controls when the generation %s ignores cancellation", async (stage) => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(() => stage === "fetch" ? new Promise(() => {})
      : Promise.resolve({ ok: true, status: 200, json: () => new Promise(() => {}) } as Response));
    await act(async () => root.render(createElement(SlidingDoors, { planState: state, memberToken: "guest-token", onProposalCreated: vi.fn() })));
    await act(async () => button("Compare routes").click());
    expect(button("Checking routes…").disabled).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(8_001));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("took too long");
    expect(button("Compare routes").disabled).toBe(false);
  });

  it.each(["fetch", "body"])("releases proposal controls when the submission %s stalls", async (stage) => {
    await act(async () => root.render(createElement(SlidingDoors, { planState: state, memberToken: "guest-token", onProposalCreated: vi.fn() })));
    await act(async () => button("Compare routes").click());
    await act(async () => container.querySelector<HTMLInputElement>('input[value="shorter-walk"]')!.click());
    vi.useFakeTimers();
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => url.endsWith("/proposals")
      ? stage === "fetch" ? new Promise(() => {}) : Promise.resolve({ ok: true, status: 201, json: () => new Promise(() => {}) } as Response)
      : original(url, init));
    await act(async () => button("Send route for crew review").click());
    await act(async () => vi.advanceTimersByTimeAsync(8_001));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("took too long");
    expect(button("Send route for crew review").disabled).toBe(false);
  });

  it("offers a retry when a venue body stalls without claiming a shorter walk", async () => {
    vi.useFakeTimers();
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => url.startsWith("/api/venue/")
      ? Promise.resolve({ ok: true, status: 200, json: () => new Promise(() => {}) } as Response) : original(url, init));
    await act(async () => root.render(createElement(SlidingDoors, { planState: state, memberToken: "guest-token", onProposalCreated: vi.fn() })));
    await act(async () => button("Compare routes").click());
    await act(async () => vi.advanceTimersByTimeAsync(8_001));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Compare again to retry");
    expect(container.querySelector('input[value="shorter-walk"]')).toBeNull();
    expect(button("Compare again").disabled).toBe(false);
  });
});
