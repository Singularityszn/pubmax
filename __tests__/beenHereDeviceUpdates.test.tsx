// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { useBeenHereVenueIds, useHasBeenHere } from "@/components/map/beenHere/useBeenHere";
import { BEEN_HERE_LIST, emitBeenHereChanged } from "@/lib/beenHere";
import { toggleSaveDurable } from "@/lib/savedPubs";

const aliases = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/lib/venueAliasMap", () => ({
  loadVenueAliasMap: async () => new Map([["old-pub", "current-pub"]]),
  loadVenueAliasMaps: aliases.load,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function DeviceVisits() {
  const hasVisits = useHasBeenHere();
  const ids = useBeenHereVenueIds();
  return <output>{`${hasVisits}:${[...ids].sort().join(",")}`}</output>;
}

it("updates both map reads for local writes, other tabs, and committed account signals", async () => {
  aliases.load.mockResolvedValue({ read: true, aliases: new Map([["old-pub", "current-pub"]]) });
  window.localStorage.clear();
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () => { root.render(<DeviceVisits />); });
    expect(host.textContent).toBe("false:");

    await act(async () => { await toggleSaveDurable("", "pub-1", BEEN_HERE_LIST); });
    expect(host.textContent).toBe("true:pub-1");
    await act(async () => { await toggleSaveDurable("", "pub-2", " Been here "); });
    expect(host.textContent).toBe("true:pub-1,pub-2");
    await act(async () => { await toggleSaveDurable("", "pub-1", BEEN_HERE_LIST, undefined, "pub", false); });
    expect(host.textContent).toBe("true:pub-2");
    await act(async () => { await toggleSaveDurable("", "pub-2", BEEN_HERE_LIST, undefined, "pub", false); });
    expect(host.textContent).toBe("false:");

    await act(async () => {
      window.localStorage.setItem("pubmax:savedPubs:v1", JSON.stringify([
        { venueId: "old-pub", listType: BEEN_HERE_LIST, savedAt: "2026-11-12T12:00:00.000Z" },
      ]));
      window.dispatchEvent(new StorageEvent("storage", { key: "pubmax:savedPubs:v1" }));
    });
    expect(host.textContent).toBe("true:current-pub");
    await act(async () => {
      window.localStorage.clear();
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });
    expect(host.textContent).toBe("false:");

    await act(async () => {
      window.localStorage.setItem("pubmax:savedPubs:v1", JSON.stringify([
        { venueId: "pub-3", listType: BEEN_HERE_LIST, savedAt: "2026-11-12T12:00:00.000Z" },
      ]));
      emitBeenHereChanged();
    });
    expect(host.textContent).toBe("true:pub-3");
  } finally {
    await act(async () => { root.unmount(); });
    window.localStorage.clear();
  }
});

it("shares alias recovery with mounted consumers and keeps the last good IDs after failure", async () => {
  window.localStorage.clear();
  aliases.load.mockResolvedValue({ read: true, aliases: new Map() });
  const host = document.createElement("div");
  const root = createRoot(host);
  const outputs = () => [...host.querySelectorAll("output")].map((output) => output.textContent);
  try {
    await act(async () => { root.render(<><DeviceVisits /></>); });
    expect(outputs()).toEqual(["false:"]);
    aliases.load.mockResolvedValue({ read: false, aliases: new Map() });
    await act(async () => {
      window.localStorage.setItem("pubmax:savedPubs:v1", JSON.stringify([
        { venueId: "venue-13wpw9e", listType: BEEN_HERE_LIST, savedAt: "2026-11-12T12:00:00.000Z" },
      ]));
      window.dispatchEvent(new StorageEvent("storage", { key: "pubmax:savedPubs:v1" }));
    });
    expect(outputs()).toEqual(["true:"]);

    aliases.load.mockResolvedValue({ read: true, aliases: new Map([["venue-13wpw9e", "venue-gv8lwa"]]) });
    await act(async () => { root.render(<><DeviceVisits /><DeviceVisits /></>); });
    expect(outputs()).toEqual(["true:venue-gv8lwa", "true:venue-gv8lwa"]);

    aliases.load.mockResolvedValue({ read: false, aliases: new Map() });
    await act(async () => { emitBeenHereChanged(); });
    expect(outputs()).toEqual(["true:venue-gv8lwa", "true:venue-gv8lwa"]);
    aliases.load.mockRejectedValue(new Error("offline"));
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: "pubmax:savedPubs:v1" }));
    });
    expect(outputs()).toEqual(["true:venue-gv8lwa", "true:venue-gv8lwa"]);

    aliases.load.mockResolvedValue({ read: true, aliases: new Map([["venue-13wpw9e", "venue-gv8lwa"]]) });
    await act(async () => { await toggleSaveDurable("", "pub-2", BEEN_HERE_LIST); });
    expect(outputs()).toEqual(["true:pub-2,venue-gv8lwa", "true:pub-2,venue-gv8lwa"]);
    await act(async () => {
      window.localStorage.clear();
      emitBeenHereChanged();
    });
    expect(outputs()).toEqual(["false:", "false:"]);
  } finally {
    await act(async () => { root.unmount(); });
    window.localStorage.clear();
  }
});
