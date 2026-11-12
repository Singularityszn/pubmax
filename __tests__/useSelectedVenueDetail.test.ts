// @vitest-environment jsdom

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useSelectedVenueDetail } from "@/components/map/pubmap/useSelectedVenueDetail";
import { readSavedVenueDetail, saveVenueDetail, SAVED_VENUE_DETAILS_MAX } from "@/lib/savedVenueDetails";
import type { Venue } from "@/lib/venues";
import { __resetWarmVenueDetail, warmVenueDetail } from "@/lib/warmVenueDetail";

const noop = () => {};
let host: HTMLDivElement;
let root: Root;

function Sheet({ id, initialDetails = new Map<string, Venue>() }: {
  id: string;
  initialDetails?: Map<string, Venue>;
}) {
  const [detailById, setDetailById] = useState(initialDetails);
  const savedAt = useSelectedVenueDetail({
    selectedVenueId: id,
    detailById,
    setDetailById,
    setDetailStatusById: noop,
    setSelectedVenueId: noop,
    setSelectionNotice: noop,
    resolveMapSelection: noop,
  });
  return createElement("output", {
    "data-saved-at": savedAt ?? "",
    "data-held": [...detailById.keys()].join(","),
  }, detailById.get(id)?.name ?? "loading");
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  localStorage.clear();
  __resetWarmVenueDetail();
  vi.unstubAllGlobals();
});

it("keeps the displayed copy dated after prefetch and refreshes every saved sheet after reconnect", async () => {
  const savedAt = "2026-11-10T20:00:00.000Z";
  for (const id of ["venue-a", "venue-b"]) {
    saveVenueDetail(id, { id, name: `Saved ${id}`, prices: [] }, new Date(savedAt));
  }
  const fetchMock = vi.fn().mockRejectedValue(new TypeError("Offline"));
  vi.stubGlobal("fetch", fetchMock);
  await act(async () => root.render(createElement(Sheet, { id: "venue-a" })));
  await act(async () => root.render(createElement(Sheet, { id: "venue-b" })));
  expect(host.querySelector("output")?.dataset.savedAt).toBe(savedAt);

  fetchMock.mockImplementation(async (url: string) => {
    const id = url.includes("venue-a") ? "venue-a" : "venue-b";
    return { ok: true, json: async () => ({ venue: { id, name: `Live ${id}`, prices: [] } }) };
  });
  await warmVenueDetail("venue-b");
  await act(async () => root.render(createElement(Sheet, { id: "venue-b" })));
  expect(host.textContent).toBe("Saved venue-b");
  expect(host.querySelector("output")?.dataset.savedAt).toBe(savedAt);

  await act(async () => { window.dispatchEvent(new Event("online")); });
  expect(host.textContent).toBe("Live venue-b");
  expect(host.querySelector("output")?.dataset.savedAt).toBe("");
  expect(host.querySelector("output")?.dataset.held).toBe("venue-b");
  await act(async () => root.render(createElement(Sheet, { id: "venue-a" })));
  expect(host.textContent).toBe("Live venue-a");
  expect(host.querySelector("output")?.dataset.savedAt).toBe("");
});

it("saves an already hydrated stop and restores its evicted copy when reopened", async () => {
  const payload = { id: "venue-plan", name: "Plan Arms", prices: [] };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ venue: payload }) }));
  const result = await warmVenueDetail("venue-plan");
  if (result.status !== "found") throw new Error("Expected live Plan detail");
  const initialDetails = new Map([["venue-plan", result.venue]]);
  expect(readSavedVenueDetail("venue-plan")).toBeNull();
  await act(async () => root.render(createElement(Sheet, { id: "venue-plan", initialDetails })));
  expect(readSavedVenueDetail("venue-plan")?.venue).toEqual(payload);
  await act(async () => root.render(createElement(Sheet, { id: "" })));
  for (let index = 0; index < SAVED_VENUE_DETAILS_MAX; index += 1) {
    saveVenueDetail(`venue-${index}`, { id: `venue-${index}` });
  }
  expect(readSavedVenueDetail("venue-plan")).toBeNull();
  await act(async () => root.render(createElement(Sheet, { id: "venue-plan" })));
  expect(readSavedVenueDetail("venue-plan")?.venue).toEqual(payload);
});
