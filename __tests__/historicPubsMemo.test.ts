import { beforeEach, describe, expect, it, vi } from "vitest";

// The bundled Historic Pubs file is build-time constant and carries nothing
// about a viewer, so lib/historic holds the parsed answer for the life of the
// process. What is pinned here is the RULE around that memo: one read however
// many renders ask, and a read that could not be done is never cached, because
// caching [] would leave every later render looking at an empty city.

const readFile = vi.fn<(...args: unknown[]) => Promise<string>>();

vi.mock("node:fs/promises", () => ({
  readFile: (...args: unknown[]) => readFile(...args),
}));

import { loadHistoricPubs, resetHistoricPubsForTests } from "@/lib/historic";

const ONE_PUB = JSON.stringify([
  { venueId: null, name: "The Old Bell", slug: "the-old-bell", borough: "Camden" },
]);

beforeEach(() => {
  resetHistoricPubsForTests();
  readFile.mockReset();
});

describe("loadHistoricPubs", () => {
  it("reads and parses the file once however many callers ask", async () => {
    readFile.mockResolvedValue(ONE_PUB);

    const first = await loadHistoricPubs();
    const second = await loadHistoricPubs();

    expect(first).toHaveLength(1);
    expect(second).toBe(first);
    expect(readFile).toHaveBeenCalledTimes(1);
  });

  it("answers [] on a failed read and does not cache it", async () => {
    readFile.mockRejectedValueOnce(new Error("ENOENT"));
    expect(await loadHistoricPubs()).toEqual([]);

    readFile.mockResolvedValue(ONE_PUB);
    expect(await loadHistoricPubs()).toHaveLength(1);
    expect(readFile).toHaveBeenCalledTimes(2);
  });

  it("answers [] for a file that is not a list, and does not cache it", async () => {
    readFile.mockResolvedValueOnce('{"not":"a list"}');
    expect(await loadHistoricPubs()).toEqual([]);

    readFile.mockResolvedValue(ONE_PUB);
    expect(await loadHistoricPubs()).toHaveLength(1);
    expect(readFile).toHaveBeenCalledTimes(2);
  });
});
