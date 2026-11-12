// @vitest-environment jsdom

import { act, createElement, useCallback, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useSelectedVenueDetail } from "@/components/map/pubmap/useSelectedVenueDetail";
import { readSavedVenueDetail, saveVenueDetail, SAVED_VENUE_DETAILS_MAX } from "@/lib/savedVenueDetails";
import type { VenueDetailStatus } from "@/lib/pubMap";
import type { Venue } from "@/lib/venues";
import { __resetWarmVenueDetail, warmVenueDetail } from "@/lib/warmVenueDetail";

const noop = () => {};
let host: HTMLDivElement;
let root: Root;
let online: boolean;

function Sheet({ id, initialDetails = new Map<string, Venue>() }: {
  id: string;
  initialDetails?: Map<string, Venue>;
}) {
  const [detailById, setDetailById] = useState(initialDetails);
  const [selectedVenueId, setSelectedVenueId] = useState(id);
  const [previousId, setPreviousId] = useState(id);
  const [statuses, setDetailStatusById] = useState(new Map<string, VenueDetailStatus>());
  const [resolution, setResolution] = useState("");
  const resolveMapSelection = useCallback((requested: string, canonical: string) => {
    setResolution(`${requested}:${canonical}`);
  }, []);
  if (previousId !== id) {
    setPreviousId(id);
    setSelectedVenueId(id);
  }
  const savedAt = useSelectedVenueDetail({
    selectedVenueId,
    detailById,
    setDetailById,
    setDetailStatusById,
    setSelectedVenueId,
    setSelectionNotice: noop,
    resolveMapSelection,
  });
  return createElement("output", {
    "data-saved-at": savedAt ?? "",
    "data-held": [...detailById.keys()].join(","),
    "data-selected": selectedVenueId,
    "data-resolution": resolution,
    "data-status": statuses.get(selectedVenueId) ?? "",
  }, detailById.get(selectedVenueId)?.name ?? "loading");
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  online = false;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
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
  vi.restoreAllMocks();
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

  online = true;
  await act(async () => { window.dispatchEvent(new Event("online")); });
  expect(host.textContent).toBe("Live venue-b");
  expect(host.querySelector("output")?.dataset.savedAt).toBe("");
  // Every saved sheet refreshes in place, so a reopened one is already live.
  expect(host.querySelector("output")?.dataset.held).toBe("venue-a,venue-b");
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

it("keeps a displayed saved copy dated when the reconnect read fails, and drops it only on a confirmed 404", async () => {
  const savedAt = "2026-11-10T20:00:00.000Z";
  saveVenueDetail("venue-kept", { id: "venue-kept", name: "Saved Kept", prices: [] }, new Date(savedAt));
  saveVenueDetail("venue-gone", { id: "venue-gone", name: "Saved Gone", prices: [] }, new Date(savedAt));
  const fetchMock = vi.fn().mockRejectedValue(new TypeError("Offline"));
  vi.stubGlobal("fetch", fetchMock);
  await act(async () => root.render(createElement(Sheet, { id: "venue-gone" })));
  await act(async () => root.render(createElement(Sheet, { id: "venue-kept" })));
  expect(host.querySelector("output")?.dataset.held).toBe("venue-gone,venue-kept");

  fetchMock.mockImplementation(async (url: string) =>
    url.includes("venue-gone") ? { ok: false, status: 404 } : { ok: false, status: 503 });
  online = true;
  await act(async () => { window.dispatchEvent(new Event("online")); });

  expect(host.textContent).toBe("Saved Kept");
  expect(host.querySelector("output")?.dataset.savedAt).toBe(savedAt);
  expect(host.querySelector("output")?.dataset.held).toBe("venue-kept");
});

it.each(["live", "missing", "failed", "offline"])(
  "retries a reopened saved sheet after a failed reconnect: %s",
  async (outcome) => {
    const savedAt = "2026-11-10T20:00:00.000Z";
    const id = "venue-reopen";
    saveVenueDetail(id, { id, name: "Saved Arms", prices: [] }, new Date(savedAt));
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Offline"));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(createElement(Sheet, { id })));

    online = true;
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    await act(async () => { window.dispatchEvent(new Event("online")); });
    expect(host.textContent).toBe("Saved Arms");
    expect(host.querySelector("output")?.dataset.savedAt).toBe(savedAt);
    await act(async () => root.render(createElement(Sheet, { id: "" })));

    let finishRead!: () => void;
    const responseReady = new Promise<void>((resolve) => { finishRead = resolve; });
    fetchMock.mockImplementation(async () => {
      await responseReady;
      if (outcome === "offline") throw new TypeError("Offline");
      return {
        ok: outcome === "live",
        status: outcome === "missing" ? 404 : outcome === "failed" ? 503 : 200,
        json: async () => ({ venue: { id, name: "Live Arms", prices: [] } }),
      };
    });
    await act(async () => root.render(createElement(Sheet, { id })));
    expect(host.textContent).toBe("Saved Arms");
    expect(host.querySelector("output")?.dataset.savedAt).toBe(savedAt);
    await act(async () => { finishRead(); });

    expect(host.textContent).toBe(outcome === "live" ? "Live Arms" : outcome === "missing" ? "loading" : "Saved Arms");
    expect(host.querySelector("output")?.dataset.savedAt).toBe(
      outcome === "failed" || outcome === "offline" ? savedAt : "",
    );
    expect(host.querySelector("output")?.dataset.status).toBe(outcome === "missing" ? "missing" : "");
  },
);

it.each(["reconnect", "reopen", "initial"])(
  "resolves a replacement canonical id during %s",
  async (path) => {
    const id = "venue-old";
    saveVenueDetail(id, { id, name: "Saved Old", prices: [] });
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Offline"));
    vi.stubGlobal("fetch", fetchMock);
    if (path !== "initial") {
      await act(async () => root.render(createElement(Sheet, { id })));
      expect(host.textContent).toBe("Saved Old");
    }
    if (path === "reopen") {
      await act(async () => root.render(createElement(Sheet, { id: "" })));
    }
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ venue: { id: "venue-canonical", name: "Live Canonical", prices: [] } }),
    });
    online = true;
    await act(async () => {
      if (path === "reconnect") window.dispatchEvent(new Event("online"));
      else root.render(createElement(Sheet, { id }));
    });

    expect(host.textContent).toBe("Live Canonical");
    expect(host.querySelector("output")?.dataset.selected).toBe("venue-canonical");
    expect(host.querySelector("output")?.dataset.held).toBe("venue-canonical");
    expect(host.querySelector("output")?.dataset.resolution).toBe("venue-old:venue-canonical");
    expect(host.querySelector("output")?.dataset.savedAt).toBe("");
  },
);
