// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PintDropStrip from "@/components/landing/PintDropStrip";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("landing community Pint Drops", () => {
  it("hides a hanging feed after eight seconds", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    await act(async () => root.render(createElement(PintDropStrip)));
    expect(container.textContent).toContain("Pint drops");
    expect(container.querySelectorAll(".dropStripCardSkeleton")).toHaveLength(4);

    await act(async () => { vi.advanceTimersByTime(7_999); });
    expect(container.querySelector(".dropStrip")).not.toBeNull();
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(container.childElementCount).toBe(0);
  });

  it("keeps a successful feed visible when the hang deadline passes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      drops: [{
        id: "drop-test",
        handle: "London drinker",
        priceGbp: 5,
        passedDownNote: "A pint by the Thames.",
        provenance: "contributor",
        venueId: "venue-test",
        createdAt: "2026-10-01T12:00:00Z",
      }],
    }))));
    await act(async () => root.render(createElement(PintDropStrip)));
    expect(container.textContent).toContain("London drinker");
    expect(container.textContent).toContain("A pint by the Thames.");
    expect(container.querySelectorAll(".dropStripCard")).toHaveLength(1);

    await act(async () => { vi.advanceTimersByTime(8_000); });
    expect(container.textContent).toContain("London drinker");
    expect(container.querySelector(".dropStripCardSkeleton")).toBeNull();
  });

  it.each([
    { name: "an empty feed", fetchFeed: () => Promise.resolve(new Response(JSON.stringify({ drops: [] }))) },
    { name: "an HTTP error", fetchFeed: () => Promise.resolve(new Response("", { status: 503 })) },
    { name: "a network error", fetchFeed: () => Promise.reject(new Error("Offline")) },
  ])("silently hides $name", async ({ fetchFeed }) => {
    vi.stubGlobal("fetch", vi.fn(fetchFeed));
    await act(async () => root.render(createElement(PintDropStrip)));
    expect(container.childElementCount).toBe(0);
  });
});
