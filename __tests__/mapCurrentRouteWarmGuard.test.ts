import { afterEach, expect, it, vi } from "vitest";
import type { Route } from "next";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("does not warm the active map or change its route history on focus", async () => {
  const schedule = vi.fn();
  vi.stubGlobal("window", {
    location: { pathname: "/map", search: "" },
    requestIdleCallback: schedule,
  });
  vi.stubGlobal("navigator", { connection: { effectiveType: "4g" } });
  const fetch = vi.fn(async () => new Response("[]"));
  vi.stubGlobal("fetch", fetch);
  const { warmNavRoute } = await import("@/lib/mapWarmup");
  const prefetch = vi.fn();
  const seen = new Set(["/today"]);

  warmNavRoute({ prefetch }, "/map#station", seen);

  expect(prefetch).not.toHaveBeenCalled();
  expect(schedule).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  expect([...seen]).toEqual(["/today"]);
});

it.each([
  { pathname: "/map", search: "?sel=venue-test", href: "/map?sel=venue-test#details" },
  { pathname: "/map/manchester", search: "", href: "/map/manchester" },
  { pathname: "/tonight", search: "?area=soho", href: "/tonight?area=soho#main" },
])("skips the exact active path and query: $href", async ({ pathname, search, href }) => {
  const schedule = vi.fn();
  vi.stubGlobal("window", { location: { pathname, search }, requestIdleCallback: schedule });
  vi.stubGlobal("navigator", { connection: { effectiveType: "4g" } });
  const fetch = vi.fn(async () => new Response("[]"));
  vi.stubGlobal("fetch", fetch);
  const { warmNavRoute } = await import("@/lib/mapWarmup");
  const prefetch = vi.fn();
  const seen = new Set<string>();

  warmNavRoute({ prefetch }, href as Route, seen);

  expect(prefetch).not.toHaveBeenCalled();
  expect(schedule).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  expect(seen.size).toBe(0);
});

it("warms a different map query and retains fragment-free history", async () => {
  const schedule = vi.fn();
  vi.stubGlobal("window", {
    location: { pathname: "/map", search: "?sel=venue-current" },
    requestIdleCallback: schedule,
  });
  vi.stubGlobal("navigator", { connection: { effectiveType: "4g" } });
  const fetch = vi.fn(async () => new Response("[]"));
  vi.stubGlobal("fetch", fetch);
  const { warmNavRoute } = await import("@/lib/mapWarmup");
  const prefetch = vi.fn();
  const seen = new Set<string>();

  warmNavRoute({ prefetch }, "/map?sel=venue-next#details", seen);
  warmNavRoute({ prefetch }, "/map?sel=venue-next#overview", seen);

  expect(prefetch.mock.calls).toEqual([["/map?sel=venue-next"]]);
  expect(schedule).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledTimes(4);
  expect([...seen]).toEqual(["/map?sel=venue-next"]);
});

it("does not poison a future off-page warm by skipping the current map", async () => {
  const location = { pathname: "/map", search: "" };
  const schedule = vi.fn();
  vi.stubGlobal("window", { location, requestIdleCallback: schedule });
  vi.stubGlobal("navigator", { connection: { effectiveType: "4g" } });
  const fetch = vi.fn(async () => new Response("[]"));
  vi.stubGlobal("fetch", fetch);
  const { warmNavRoute } = await import("@/lib/mapWarmup");
  const prefetch = vi.fn();
  const seen = new Set<string>();

  warmNavRoute({ prefetch }, "/map", seen);
  expect(seen.size).toBe(0);
  location.pathname = "/tonight";
  warmNavRoute({ prefetch }, "/map", seen);

  expect(prefetch.mock.calls).toEqual([["/map"]]);
  expect(schedule).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledTimes(4);
  expect([...seen]).toEqual(["/map"]);
});

it("preserves route prefetch without a browser location", async () => {
  vi.stubGlobal("window", undefined);
  vi.stubGlobal("navigator", undefined);
  const { warmNavRoute } = await import("@/lib/mapWarmup");
  const prefetch = vi.fn();
  const seen = new Set<string>();

  warmNavRoute({ prefetch }, "/map", seen);

  expect(prefetch.mock.calls).toEqual([["/map"]]);
  expect([...seen]).toEqual(["/map"]);
});
