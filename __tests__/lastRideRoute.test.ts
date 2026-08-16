import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const LAST_RIDE_ROUTES = [
  "app/api/last-subway/route.ts",
  "app/api/last-merseyrail/route.ts",
  "app/api/last-tram/route.ts",
] as const;

/** Same shape as the three thin wrappers; only provider-specific names differ. */
function providerNeutralRouteBody(source: string): string {
  return source
    .replace(/^import[\s\S]*?(?=^export)/m, "")
    .replace(/nearest\w+Station/g, "nearestStation")
    .replace(/compute\w+LastRide/g, "computeLastRide")
    .replace(/\b[A-Z][A-Z0-9_]*_PROVENANCE\b/g, "PROVENANCE")
    .replace(/\/\/.*$/gm, "")
    .replace(/"[^"]*"/g, '"PROVIDER"');
}

describe("lastRide route extraction (#1043 L5)", () => {
  it("each route imports runLastRideRoute from lib/lastRideRoute", () => {
    for (const route of LAST_RIDE_ROUTES) {
      const source = readFileSync(join(process.cwd(), route), "utf8");
      expect(source, route).toContain('from "@/lib/lastRideRoute"');
      expect(source, route).toContain("runLastRideRoute");
    }
  });

  it("provider-name-normalised bodies match across the three routes", () => {
    const neutral = LAST_RIDE_ROUTES.map((route) =>
      providerNeutralRouteBody(readFileSync(join(process.cwd(), route), "utf8")),
    );
    expect(neutral[0]).toBe(neutral[1]);
    expect(neutral[1]).toBe(neutral[2]);
  });
});
