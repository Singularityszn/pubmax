import type { NextConfig } from "next";
import { describe, expect, it } from "vitest";

// The client Router Cache window (experimental.staleTimes in next.config.mjs)
// is what makes a return to a tab instant: the browser reuses a route it
// already holds instead of paying a fresh RSC round trip and a fresh server
// render for a page it just left.
//
// It is only safe while no page server-renders per-account content and no
// surface expects a server re-render after a write. The window below is the
// one derived from those two invariants, so moving it means re-deriving it.

/** The ceiling this window may take without a fresh argument for it. */
const MAX_STALE_SECONDS = 300;

const DERIVED_STALE_TIMES = { dynamic: 180, static: 300 } as const;

async function resolvedStaleTimes() {
  const configUrl = new URL("../next.config.mjs", import.meta.url).href;
  const { default: config } = (await import(configUrl)) as { default: NextConfig };
  return config.experimental?.staleTimes;
}

describe("the router cache window", () => {
  it("resolves to the derived window", async () => {
    expect(await resolvedStaleTimes()).toEqual(DERIVED_STALE_TIMES);
  });

  it.each(["dynamic", "static"] as const)(
    "loads a positive %s window within its ceiling",
    async (kind) => {
      const seconds = (await resolvedStaleTimes())?.[kind];

      expect(seconds).toBeGreaterThan(0);
      expect(seconds).toBeLessThanOrEqual(MAX_STALE_SECONDS);
    },
  );
});
