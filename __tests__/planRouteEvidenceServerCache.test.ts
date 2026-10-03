import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PINT_DATASET_OBSERVED_AT } from "@/lib/dataFreshness";

const readFileMock = vi.hoisted(() => vi.fn());

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: readFileMock };
});

const ICE_WHARF = {
  id: "venue-17u2i1w",
  name: "The Ice Wharf - JD Wetherspoon",
  area: "Camden",
  lat: 51.5404,
  lng: -0.145649,
};

describe("plan price evidence cache", () => {
  beforeEach(() => {
    vi.resetModules();
    readFileMock.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("retries the price index after a transient read failure", async () => {
    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    readFileMock.mockRejectedValueOnce(new Error("transient read failure"));
    readFileMock.mockImplementation(actualFs.readFile);

    const { planPriceEvidenceForVenues } = await import("@/lib/planRouteEvidence.server");
    const now = PINT_DATASET_OBSERVED_AT.getTime();

    const afterFailure = await planPriceEvidenceForVenues([ICE_WHARF], now);
    expect(afterFailure.get(ICE_WHARF.id)).toMatchObject({
      pence: null,
      confidenceState: "unknown",
    });

    const afterRetry = await planPriceEvidenceForVenues([ICE_WHARF], now);
    expect(afterRetry.get(ICE_WHARF.id)).toMatchObject({
      pence: 366,
      source: { label: "Pint Prices" },
    });
    expect(readFileMock).toHaveBeenCalledTimes(2);
  });
});
