import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readFileMock = vi.hoisted(() => vi.fn());

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: readFileMock };
});

const ICE_WHARF = {
  id: "ice-wharf",
  name: "The Ice Wharf - JD Wetherspoon",
  lat: 51.5404,
  lng: -0.145649,
};

describe("wetherspoons directory cache", () => {
  beforeEach(() => {
    vi.resetModules();
    readFileMock.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("retries the directory after a transient read failure", async () => {
    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    readFileMock.mockRejectedValueOnce(new Error("transient read failure"));
    readFileMock.mockImplementation(actualFs.readFile);

    const { matchedWetherspoonsVenueIds } = await import("@/lib/wetherspoonsMatch.server");

    const afterFailure = await matchedWetherspoonsVenueIds([ICE_WHARF]);
    expect([...afterFailure]).toEqual([]);

    const afterRetry = await matchedWetherspoonsVenueIds([ICE_WHARF]);
    expect([...afterRetry]).toEqual([ICE_WHARF.id]);
    expect(readFileMock).toHaveBeenCalledTimes(2);
  });
});
