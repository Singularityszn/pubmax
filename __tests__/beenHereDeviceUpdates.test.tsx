// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { useBeenHereVenueIds, useHasBeenHere } from "@/components/map/beenHere/useBeenHere";
import { BEEN_HERE_LIST, emitBeenHereChanged } from "@/lib/beenHere";
import { toggleSaveDurable } from "@/lib/savedPubs";

vi.mock("@/lib/venueAliasMap", () => ({
  loadVenueAliasMap: async () => new Map([["old-pub", "current-pub"]]),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function DeviceVisits() {
  const hasVisits = useHasBeenHere();
  const ids = useBeenHereVenueIds();
  return <output>{`${hasVisits}:${[...ids].sort().join(",")}`}</output>;
}

it("updates both map reads for local writes, other tabs, and committed account signals", async () => {
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
