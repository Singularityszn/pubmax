// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { scrollMotionBehavior } from "@/lib/scrollMotion";

function preferReducedMotion(reduced: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)" && reduced,
      media: query,
    })),
  );
}

describe("scrollMotionBehavior", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("jumps straight to the target for a reader who asked for less motion", () => {
    preferReducedMotion(true);
    expect(scrollMotionBehavior()).toBe("auto");
  });

  it("glides to the target otherwise", () => {
    preferReducedMotion(false);
    expect(scrollMotionBehavior()).toBe("smooth");
  });

  it("glides where the browser cannot answer the media query", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(scrollMotionBehavior()).toBe("smooth");
  });
});
