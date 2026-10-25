// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import DrinkCoverage from "@/components/map/DrinkCoverage";
import { clearSurfaceCache } from "@/lib/surfaceDataCache";
beforeEach(() => { clearSurfaceCache(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-25T12:00:00Z")); });
const mounted: Array<ReturnType<typeof createRoot>> = [];
afterEach(async () => { for (const root of mounted.splice(0)) await act(async () => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function mount(category: "coffee" | "alcohol-free") {
  const target = document.createElement("div");
  document.body.append(target);
  const root = createRoot(target);
  mounted.push(root);
  await act(async () => { root.render(<DrinkCoverage category={category} coverage={{ count: 0, total: 2, status: "ready", loadedPubIds: ["pub-1", "pub-2"] }} />); });
  return target;
}
it("shows one listed pub beside zero confirmed pubs without counting an unloaded pub", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify([
    { venueId: "pub-1", category: "coffee", observedAt: "2026-10-25T10:00:00Z" },
    { venueId: "pub-outside", category: "coffee", observedAt: "2026-10-25T10:00:00Z" },
  ]))));
  const target = await mount("coffee");
  expect(target.textContent).toContain("1 loaded pub has a listed coffee price");
  expect(target.textContent).toContain("0 of 2 loaded pubs have a confirmed coffee price");
  expect(target.textContent).toContain("Latest source read: 25 Oct 2026");
});
it("reports a failed listed read without inventing zero", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  const target = await mount("alcohol-free");
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(target.textContent).toContain("Listed menu coverage could not be read.");
  });
  expect(target.textContent).not.toContain("0 loaded pubs have a listed");
});

it("reuses the static read while the loaded pubs and selected drink change", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([
    { venueId: "pub-1", category: "coffee", observedAt: "2026-10-25T10:00:00Z" },
    { venueId: "pub-2", category: "alcohol-free", observedAt: "2026-10-25T10:00:00Z" },
  ])));
  vi.stubGlobal("fetch", fetch);
  const target = await mount("coffee");
  expect(target.textContent).toContain("1 loaded pub has a listed coffee price");
  await act(async () => { mounted[0]!.render(<DrinkCoverage category="alcohol-free" coverage={{ count: 0, total: 1, status: "ready", loadedPubIds: ["pub-2"] }} />); });
  expect(target.textContent).toContain("1 loaded pub has a listed alcohol-free drink price");
  await act(async () => { mounted[0]!.render(<DrinkCoverage category="coffee" coverage={{ count: 0, total: 1, status: "ready", loadedPubIds: ["pub-2"] }} />); });
  expect(target.textContent).toContain("0 loaded pubs have a listed coffee price");
  expect(fetch).toHaveBeenCalledTimes(1);
});

// The shared surface-cache contract keeps a recent public answer across mounts.
// A component-local read would fetch again when the picker returns.
it("keeps listed coverage across a picker remount without another request", async () => {
  const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify([
    { venueId: "pub-1", category: "coffee", observedAt: "2026-10-25T10:00:00Z" },
  ])));
  vi.stubGlobal("fetch", fetch);
  await mount("coffee");
  await act(async () => mounted.pop()!.unmount());
  const target = await mount("coffee");
  expect(target.textContent).toContain("1 loaded pub has a listed coffee price");
  expect(fetch).toHaveBeenCalledTimes(1);
});
