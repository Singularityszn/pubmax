import type { NextConfig } from "next";
import { describe, expect, it } from "vitest";

const MAX_STALE_SECONDS = 300;

describe("the router cache window", () => {
  it.each(["dynamic", "static"] as const)(
    "loads a positive %s window within its ceiling",
    async (kind) => {
      const configUrl = new URL("../next.config.mjs", import.meta.url).href;
      const { default: config } = await import(configUrl) as { default: NextConfig };
      const seconds = config.experimental?.staleTimes?.[kind];

      expect(seconds).toBeGreaterThan(0);
      expect(seconds).toBeLessThanOrEqual(MAX_STALE_SECONDS);
    },
  );
});
