// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MapRouteTransferButton, type MapRouteResponse } from "@/components/plan/MapRouteTransferButton";

import { transferMapRouteToDraft } from "@/lib/mapRouteTransfer";
import { readPlanDraftEnvelope, writePlanDraftEnvelope } from "@/lib/planDraft";
import { readPlanRouteDraftEnvelope } from "@/lib/planRouteDraft";
import { createPlanningIntent, PLANNING_INTENT_STORAGE_KEY, readPlanningIntent } from "@/lib/planningIntent";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const response: MapRouteResponse = {
  groundingProof: "payload.signature",
  operationKey: "operation-1",
  stops: [{ venueId: "venue-a", venueName: "Venue A", alternatives: [] }],
};

describe("MapRouteTransferButton", () => {
  it("renders the plain navigate-and-regenerate CTA with no captured Route", () => {
    const noRoute = renderToStaticMarkup(createElement(MapRouteTransferButton, { response: null }));

    expect(noRoute).toContain('href="/plan?src=mobile-route-preview"');
    expect(noRoute).toContain("Open Plan to lock it in");
  });

  it("keeps the identical navigation target with a Route: the transfer rides the click, not a re-render", () => {
    const withRoute = renderToStaticMarkup(createElement(MapRouteTransferButton, { response }));
    const noRoute = renderToStaticMarkup(createElement(MapRouteTransferButton, { response: null }));

    expect(withRoute).toContain('href="/plan?src=mobile-route-preview"');
    expect(withRoute).toBe(noRoute);
  });
});


it("blocks navigation on a failed current-route write and leaves an actionable retry with no captured-route fallback", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const local = window.localStorage;
  const storagePrototype = Object.prototype.hasOwnProperty.call(local, "setItem")
    ? local : Object.getPrototypeOf(local) as Storage;
  const originalSetItem = local.setItem;
  const setItem = vi.spyOn(storagePrototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
    if (this === local) throw new Error("storage denied");
    originalSetItem.call(this, key, value);
  });
  try {
    expect(() => local.setItem("storage-write-probe", "value")).toThrow("storage denied");
    await act(async () => root.render(createElement(MapRouteTransferButton, {
      response,
      displayedRoute: [{ id: "venue-a", name: "Venue A" }],
    })));
    const link = container.querySelector("a")!;
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    await act(async () => { link.dispatchEvent(click); });
    expect(click.defaultPrevented).toBe(true);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Could not carry this route to Plan. Your route is still here. Try again.");
    expect(container.querySelector("a")?.textContent).toBe("Open Plan to lock it in");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/plan?src=mobile-route-preview");
  } finally {
    setItem.mockRestore();
    await act(async () => root.unmount());
    container.remove();
  }
});


it("preserves all acceptance owners on a blocked move, then releases them explicitly while carrying the displayed route", async () => {
  const now = Date.now();
  const expiresAt = new Date(now + 60 * 60 * 1000).toISOString();
  const intent = createPlanningIntent({
    source: "near", cityId: "london", acceptedVenueId: "venue-a",
    acceptedArea: { kind: "night-patch", id: "soho" }, startsAt: null,
    displayEvidence: { kind: "directory", observedAt: null },
  }, now);
  window.sessionStorage.setItem(PLANNING_INTENT_STORAGE_KEY, JSON.stringify(intent));
  expect(writePlanDraftEnvelope({
    title: "Held route", creatorName: "K", startTime: "", conciergeQuery: "Quiet pints",
    stops: [{ key: 1, venueId: "venue-a", venueName: "Venue A" }],
    acceptedAnchor: { venueId: "venue-a", source: "near", cityId: "london",
      acceptedArea: { kind: "night-patch", id: "soho" }, startsAt: null, expiresAt },
  }, "planning-intent", window.sessionStorage, now).v2).toBe(true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  // Keep this mounted control in place after the native link event; its own
  // callback still writes/releases real storage before this outer cancellation.
  container.addEventListener("click", (event) => event.preventDefault());
  try {
    await act(async () => root.render(createElement(MapRouteTransferButton, {
      response: { ...response, outcome: "route", anchorVenueId: "venue-a", anchorSource: "near",
        stops: [{ venueId: "venue-a", venueName: "Venue A", alternatives: [] },
          { venueId: "venue-b", venueName: "Venue B", alternatives: [] }] },
      displayedRoute: [{ id: "venue-b", name: "Venue B" }, { id: "venue-a", name: "Venue A" }],
    })));
    await act(async () => { container.querySelector("a")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("moves your accepted Stop 1");
    expect(readPlanDraftEnvelope(window.sessionStorage, now)?.draft.acceptedAnchor?.venueId).toBe("venue-a");
    expect(readPlanningIntent({ storage: window.sessionStorage, now })?.acceptedVenueId).toBe("venue-a");
    const release = [...container.querySelectorAll("a")].find((link) => link.textContent === "Release Stop 1 and review current route")!;
    await act(async () => { release.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(readPlanDraftEnvelope(window.sessionStorage, Date.now())?.draft.acceptedAnchor).toBeUndefined();
    expect(readPlanningIntent({ storage: window.sessionStorage, now: Date.now() })).toBeNull();
    const route = readPlanRouteDraftEnvelope(window.localStorage, Date.now());
    expect(route?.value.anchorVenueId).toBeNull();
    expect(route?.value.stops.map((stop) => stop.venueId)).toEqual(["venue-b", "venue-a"]);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    window.localStorage.clear();
    window.sessionStorage.clear();
  }
});


it("cancels a moved-Stop-1 transfer when session acceptance cannot be cleared, then succeeds on a healthy retry", async () => {
  const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  const now = Date.now();
  const local = window.localStorage;
  const session = window.sessionStorage;
  local.clear();
  session.clear();
  const intent = createPlanningIntent({
    source: "near", cityId: "london", acceptedVenueId: "venue-a",
    acceptedArea: { kind: "night-patch", id: "soho" }, startsAt: null,
    displayEvidence: { kind: "directory", observedAt: null },
  }, now);
  session.setItem(PLANNING_INTENT_STORAGE_KEY, JSON.stringify(intent));
  expect(writePlanDraftEnvelope({
    title: "Held route", creatorName: "K", startTime: "", conciergeQuery: "Quiet pints",
    stops: [{ key: 1, venueId: "venue-a", venueName: "Venue A" }],
    acceptedAnchor: { venueId: "venue-a", source: "near", cityId: "london",
      acceptedArea: { kind: "night-patch", id: "soho" }, startsAt: null,
      expiresAt: new Date(now + 60 * 60 * 1000).toISOString() },
  }, "planning-intent", session, now).v2).toBe(true);
  const anchoredResponse: MapRouteResponse = {
    ...response, outcome: "route", anchored: true, anchorVenueId: "venue-a", anchorSource: "near",
    stops: [{ venueId: "venue-a", venueName: "Venue A", alternatives: [] },
      { venueId: "venue-b", venueName: "Venue B", alternatives: [] }],
  };
  expect(transferMapRouteToDraft(anchoredResponse, local, now)).toBe(true);
  expect(readPlanningIntent({ storage: session, now })?.acceptedVenueId).toBe("venue-a");
  expect(readPlanDraftEnvelope(session, now)?.draft.acceptedAnchor?.venueId).toBe("venue-a");
  expect(readPlanRouteDraftEnvelope(local, now)?.value.anchorVenueId).toBe("venue-a");

  // Fault only browser persistence. Public readers, transfer and release owners
  // stay real; local route writes remain available throughout the outage.
  const storagePrototype = Object.getPrototypeOf(session) as Storage;
  const originalSetItem = storagePrototype.setItem;
  const originalRemoveItem = storagePrototype.removeItem;
  let failSessionWrites = true;
  const setItem = vi.spyOn(storagePrototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
    if (this === session && failSessionWrites) throw new Error("session storage denied");
    originalSetItem.call(this, key, value);
  });
  const removeItem = vi.spyOn(storagePrototype, "removeItem").mockImplementation(function (this: Storage, key: string) {
    if (this === session && failSessionWrites) throw new Error("session storage denied");
    originalRemoveItem.call(this, key);
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const navigationWasCancelled: boolean[] = [];
  // React's root listener runs first. Record whether the real CTA cancelled,
  // then keep jsdom in place without counting this outer cancellation as proof.
  container.addEventListener("click", (event) => {
    navigationWasCancelled.push(event.defaultPrevented);
    event.preventDefault();
  });
  try {
    expect(() => session.setItem("storage-write-probe", "value")).toThrow("session storage denied");
    expect(() => session.removeItem("storage-write-probe")).toThrow("session storage denied");
    expect(readPlanDraftEnvelope(session, now)?.draft.acceptedAnchor?.venueId).toBe("venue-a");
    await act(async () => root.render(createElement(MapRouteTransferButton, {
      response: anchoredResponse,
      displayedRoute: [{ id: "venue-b", name: "Venue B" }, { id: "venue-a", name: "Venue A" }],
    })));
    await act(async () => { container.querySelector("a")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
    expect(navigationWasCancelled.at(-1)).toBe(true);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("moves your accepted Stop 1");
    const release = [...container.querySelectorAll("a")].find((link) => link.textContent === "Release Stop 1 and review current route")!;
    await act(async () => { release.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
    expect(navigationWasCancelled.at(-1)).toBe(true);
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/try again|retry/i);
    expect(readPlanDraftEnvelope(session, Date.now())?.draft.acceptedAnchor?.venueId).toBe("venue-a");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/plan?src=mobile-route-preview");

    failSessionWrites = false;
    const retry = [...container.querySelectorAll("a")].find((link) => link.textContent === "Release Stop 1 and review current route")!;
    await act(async () => { retry.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
    expect(navigationWasCancelled.at(-1)).toBe(false);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(readPlanningIntent({ storage: session, now: Date.now() })).toBeNull();
    expect(readPlanDraftEnvelope(session, Date.now())?.draft.acceptedAnchor).toBeUndefined();
    const carried = readPlanRouteDraftEnvelope(local, Date.now());
    expect(carried?.value.anchorVenueId).toBeNull();
    expect(carried?.value.groundingProof).toBeNull();
    expect(carried?.value.stops.map((stop) => stop.venueId)).toEqual(["venue-b", "venue-a"]);
  } finally {
    setItem.mockRestore();
    removeItem.mockRestore();
    await act(async () => root.unmount());
    container.remove();
    local.clear();
    session.clear();
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  }
});
