// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const mapBoundary = vi.hoisted(() => ({ mounts: 0 }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/components/map/fairpint/FairPintMap", () => ({
  default: function MapBoundary({ cityId }: { cityId: string }) {
    const [instance] = useState(() => ++mapBoundary.mounts);
    return createElement("div", { className: "mapStage", "data-instance": instance }, createElement("span", null, cityId));
  },
}));

import PubMaxingShell from "@/components/PubMaxingShell";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("keeps the map and coverage note distinct while the city changes", async () => {
  mapBoundary.mounts = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    queueMicrotask(() => callback(performance.now()));
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  const errors = vi.spyOn(console, "error");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(PubMaxingShell, { cityId: "london" })));
    await act(async () => { await vi.dynamicImportSettled(); });
    const london = host.querySelector(".mapStage");
    expect(london).not.toBeNull();
    expect(host.querySelector('[role="note"]')).toBeNull();
    await act(async () => root.render(createElement(PubMaxingShell, { cityId: "london" })));
    expect(host.querySelector(".mapStage")).toBe(london);
    expect(mapBoundary.mounts).toBe(1);
    await act(async () => root.render(createElement(PubMaxingShell, { cityId: "manchester" })));
    await act(async () => { await vi.dynamicImportSettled(); });
    expect(host.querySelectorAll(".mapStage")).toHaveLength(1);
    expect(host.querySelector(".mapStage")).not.toBe(london);
    expect(mapBoundary.mounts).toBe(2);
    expect(host.querySelector(".mapStage")?.textContent).toContain("manchester");
    expect(host.querySelectorAll('[role="note"]')).toHaveLength(1);
    expect(host.querySelector('[role="note"]')?.textContent).toBe("Few prices here yet. Tell us your city.");
    expect(errors.mock.calls.filter(args => String(args[0]).includes("same key"))).toEqual([]);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
