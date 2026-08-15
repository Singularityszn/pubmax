import { describe, expect, it } from "vitest";

import { coverageDetailForArea } from "@/components/night/NightAreaCoverage";
import { NIGHT_AREAS, type NightArea } from "@/lib/nightAreas";

function areaWithMissingEvidence(
  missingEvidence: NightArea["missingEvidence"],
): NightArea {
  return {
    ...NIGHT_AREAS[0],
    coverageStatus: "captured",
    missingEvidence,
  };
}

describe("night area coverage detail", () => {
  it("does not turn non-price evidence into a price-check claim", () => {
    const detail = coverageDetailForArea(
      areaWithMissingEvidence(["opening_hours", "transport_anchor"]),
      new Date("2026-08-05T18:00:00.000Z"),
    );

    expect(detail).toBe("2 more checks to do here before a crawl.");
    expect(detail).not.toContain("price");
  });
});
