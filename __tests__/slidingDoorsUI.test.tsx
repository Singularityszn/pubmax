// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SlidingDoors from "@/components/plan/SlidingDoors";
import type { PlanState } from "@/lib/plan";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const state: PlanState = {
  plan: { id: "plan-one", title: "Friday", startTime: "2026-11-01T18:00:00.000Z", createdAt: "2026-10-31T12:00:00.000Z", routeRevision: 1 },
  stops: ["a", "b", "c"].map((venueId, position) => ({ venueId, venueName: `Pub ${venueId}`, position })), crew: [],
  context: { nightArea: "piccadilly-soho", daypart: "evening", partyType: "friends", groupSize: 3, stopCount: 3, budget: "value", budgetLimitPence: null, zeroProof: false, wetherspoonsPreferred: false, atmosphere: [], foodNeeds: [], accessibility: [], transportConstraints: [] },
};
let root: Root;
let container: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn>;

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
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe("Sliding Doors controls", () => {
  it("compares without saving, then sends one proposal after an explicit choice", async () => {
    const submitted = vi.fn();
    await act(async () => root.render(createElement(SlidingDoors, { planState: state, memberToken: "guest-token", onProposalCreated: submitted })));
    await act(async () => button("Compare routes").click());
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/proposals"))).toHaveLength(0);
    expect(container.textContent).toContain("straight-line estimate");
    await act(async () => container.querySelector<HTMLInputElement>('input[value="shorter-walk"]')!.click());
    await act(async () => { const send = button("Send route for crew review"); send.click(); send.click(); });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/proposals"))).toHaveLength(1);
    expect(submitted).toHaveBeenCalledTimes(1);
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
});
