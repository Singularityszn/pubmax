// @vitest-environment jsdom

// THE LONDON LANE NEVER PARKS A FOCUSED CONTROL OUT OF SIGHT.
//
// The lane takes the door slot's place once the session answers nobody, then
// grows twice more (skeletons, then posts or the empty line). Find your lot sits
// under it, so a reader who already tabbed into the handle field saw it pushed
// under the consent card (e2e/ux-consent-chrome.spec.ts, 1 Nov 2026). The lane
// asks the focused control below it back into view, "nearest", on every change
// of its size, and leaves focus inside itself or above it alone.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SocialLondonLane from "@/app/social/SocialLondonLane";

let container: HTMLDivElement;
let root: Root | null = null;
let scrollCalls: Array<{ element: Element; options: unknown }> = [];
const scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");

async function settle(): Promise<void> {
  for (let turn = 0; turn < 4; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function mountWithFieldAt(position: "below" | "above"): HTMLInputElement {
  const field = document.createElement("input");
  field.setAttribute("aria-label", "Search handles");
  const laneHost = document.createElement("div");
  if (position === "above") container.append(field, laneHost);
  else container.append(laneHost, field);
  root = createRoot(laneHost);
  return field;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  scrollCalls = [];
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value(this: Element, options: unknown) {
      scrollCalls.push({ element: this, options });
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ posts: [], nextCursor: null }), { status: 200 })),
  );
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container.remove();
  vi.unstubAllGlobals();
  if (scrollDescriptor) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scrollDescriptor);
  else delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

describe("the London lane and a focused control", () => {
  it("brings a focused field below it back into view as it mounts and as it loads", async () => {
    const field = mountWithFieldAt("below");
    field.focus();
    expect(document.activeElement).toBe(field);

    act(() => root!.render(createElement(SocialLondonLane)));
    // The lane replaced the slot: the field is asked back into view at once.
    expect(scrollCalls.filter((call) => call.element === field).length).toBeGreaterThanOrEqual(1);
    const atMount = scrollCalls.length;

    await settle();
    // The lane loaded (the empty line), so it changed size again.
    expect(container.textContent).toContain("No London posts yet.");
    expect(scrollCalls.length).toBeGreaterThan(atMount);
    for (const call of scrollCalls) {
      expect(call.element).toBe(field);
      expect(call.options).toEqual({ block: "nearest" });
    }
  });

  it("leaves a focused control above the lane where the reader put it", async () => {
    const field = mountWithFieldAt("above");
    field.focus();

    act(() => root!.render(createElement(SocialLondonLane)));
    await settle();

    expect(scrollCalls).toEqual([]);
  });

  it("does nothing when nothing on the page holds focus", async () => {
    mountWithFieldAt("below");

    act(() => root!.render(createElement(SocialLondonLane)));
    await settle();

    expect(scrollCalls).toEqual([]);
  });
});
