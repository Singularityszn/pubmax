// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNowHref } from "@/lib/useNowHref";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function MainTab() {
  return createElement("a", { href: useNowHref() }, "Tonight");
}
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});
async function renderAt(time: string) {
  vi.setSystemTime(new Date(time));
  await act(async () => root.render(createElement(MainTab)));
}
const href = () => host.querySelector("a")?.getAttribute("href");

describe("automatic Day and Tonight entry", () => {
  it.each([
    ["2026-01-15T00:00:00Z", "/tonight"],
    ["2026-01-15T09:00:00Z", "/today"],
    ["2026-01-15T03:59:59.999Z", "/tonight"],
    ["2026-01-15T04:00:00Z", "/today"],
    ["2026-07-15T02:59:59.999Z", "/tonight"],
    ["2026-07-15T03:00:00Z", "/today"],
    ["2026-03-29T00:59:59Z", "/tonight"],
    ["2026-03-29T01:00:00Z", "/tonight"],
    ["2026-03-29T02:59:59.999Z", "/tonight"],
    ["2026-03-29T03:00:00Z", "/today"],
    ["2026-10-25T00:30:00Z", "/tonight"],
    ["2026-10-25T01:30:00Z", "/tonight"],
    ["2026-10-25T03:59:59.999Z", "/tonight"],
    ["2026-10-25T04:00:00Z", "/today"],
    ["2026-01-15T15:59:59.999Z", "/today"],
    ["2026-01-15T16:00:00Z", "/tonight"],
    ["2026-01-15T23:59:59Z", "/tonight"],
    ["2026-07-15T14:59:59.999Z", "/today"],
    ["2026-07-15T15:00:00Z", "/tonight"],
    ["2026-07-15T23:00:00Z", "/tonight"],
    ["2026-03-29T14:59:59Z", "/today"],
    ["2026-03-29T15:00:00Z", "/tonight"],
    ["2026-10-25T15:59:59Z", "/today"],
    ["2026-10-25T16:00:00Z", "/tonight"],
  ])("links to %s as %s on the London clock", async (time, target) => {
    await renderAt(time);
    expect(href()).toBe(target);
  });

  it("hydrates a cached Tonight link into Day without a hydration mismatch", async () => {
    vi.setSystemTime(new Date("2026-07-15T08:00:00Z"));
    const cached = document.createElement("div");
    cached.innerHTML = renderToString(createElement(MainTab));
    expect(cached.querySelector("a")?.getAttribute("href")).toBe("/tonight");
    document.body.append(cached);
    const onRecoverableError = vi.fn();
    let hydrated: Root;
    await act(async () => { hydrated = hydrateRoot(cached, createElement(MainTab), { onRecoverableError }); });
    expect(cached.querySelector("a")?.getAttribute("href")).toBe("/today");
    expect(onRecoverableError).not.toHaveBeenCalled();
    await act(async () => hydrated.unmount());
    cached.remove();
  });

  it("changes at exactly 16:00 without a reload", async () => {
    await renderAt("2026-07-15T14:59:59.999Z");
    expect(href()).toBe("/today");
    await act(async () => vi.advanceTimersByTime(1));
    expect(href()).toBe("/tonight");
  });

  it("keeps Tonight across midnight and opens Day at the 04:00 service rollover", async () => {
    await renderAt("2026-07-15T22:59:59.999Z");
    expect(href()).toBe("/tonight");
    await act(async () => vi.advanceTimersByTime(1));
    expect(href()).toBe("/tonight");
    vi.setSystemTime(new Date("2026-07-16T02:59:59.999Z"));
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(href()).toBe("/tonight");
    await act(async () => vi.advanceTimersByTime(1));
    expect(href()).toBe("/today");
    vi.setSystemTime(new Date("2026-07-16T08:00:00Z"));
    await act(async () => window.dispatchEvent(new Event("pageshow")));
    expect(href()).toBe("/today");
  });

  it.each(["focus", "pageshow", "visibilitychange"])("refreshes after a suspended clock on %s", async (event) => {
    await renderAt("2026-07-15T14:00:00Z");
    vi.setSystemTime(new Date("2026-07-15T16:00:00Z"));
    await act(async () => (event === "visibilitychange" ? document : window).dispatchEvent(new Event(event)));
    expect(href()).toBe("/tonight");
    expect(vi.getTimerCount()).toBe(1);
  });
});
