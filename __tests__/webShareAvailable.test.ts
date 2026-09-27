/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";

import {
  readWebShareAvailable,
  serverWebShareAvailable,
} from "@/lib/webShareAvailable";

describe("webShareAvailable", () => {
  it("never claims native share on the server snapshot", () => {
    expect(serverWebShareAvailable()).toBe(false);
  });

  it("reads navigator.share only on the client snapshot", () => {
    const original = navigator.share;
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: () => Promise.resolve(),
    });
    expect(readWebShareAvailable()).toBe(true);
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: original,
    });
  });
});
