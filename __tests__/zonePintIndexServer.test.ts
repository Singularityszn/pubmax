// What the slim index is allowed to put into a zone median.
//
// `computeZonePintIndex` counts an ABSENT kind as a pub, because a row written
// before the vocabulary existed is a pub. A kind string this build does not
// hold is a different answer, and it must not arrive at that gate wearing the
// legacy one: the zone Pint Index is a price authority and fails closed.

import { beforeEach, describe, expect, it, vi } from "vitest";

const readFile = vi.hoisted(() => vi.fn());

vi.mock("node:fs/promises", () => ({ readFile, default: { readFile } }));

import { MIN_PRICED_VENUES } from "@/lib/zones";

/** A fresh server process: the loader keeps a good read for the life of one. */
async function freshLoader() {
  vi.resetModules();
  return (await import("@/lib/zonePintIndex.server")).loadZonePintIndex;
}

function rows(kind: unknown, count: number, price: number) {
  return Array.from({ length: count }, () => ({ zone: 1, cheapestPrice: price, kind }));
}

async function zoneOne(slim: unknown[]) {
  readFile.mockResolvedValue(JSON.stringify(slim));
  const index = await (await freshLoader())();
  return index!.rows.find((row) => row.zone === 1)!;
}

describe("loadZonePintIndex", () => {
  beforeEach(() => {
    readFile.mockReset();
  });

  it("counts a pub row and a row from before the vocabulary existed", async () => {
    expect((await zoneOne(rows("pub", MIN_PRICED_VENUES, 5))).pricedCount).toBe(MIN_PRICED_VENUES);
    expect((await zoneOne(rows(undefined, MIN_PRICED_VENUES, 5))).pricedCount).toBe(
      MIN_PRICED_VENUES,
    );
  });

  it("keeps a kind this build does not hold out of the median", async () => {
    // A slim row carrying a kind added by a later build must not be read as a
    // legacy pub row and priced into the zone median.
    const unknownKind = await zoneOne(rows("brewpub", MIN_PRICED_VENUES, 9));
    expect(unknownKind.pricedCount).toBe(0);
    expect(unknownKind.medianGbp).toBeNull();

    const known = await zoneOne(rows("cafe", MIN_PRICED_VENUES, 9));
    expect(known.pricedCount).toBe(0);

    const mixed = await zoneOne([
      ...rows("pub", MIN_PRICED_VENUES, 5),
      ...rows("brewpub", MIN_PRICED_VENUES, 12),
    ]);
    expect(mixed.pricedCount).toBe(MIN_PRICED_VENUES);
    expect(mixed.medianGbp).toBe(5);
  });

  it("answers null for a slim index it could not read, and reads again next time", async () => {
    const loadZonePintIndex = await freshLoader();
    readFile.mockRejectedValueOnce(new Error("ENOENT"));
    expect(await loadZonePintIndex()).toBeNull();

    readFile.mockResolvedValueOnce(JSON.stringify(rows("pub", MIN_PRICED_VENUES, 5)));
    const index = await loadZonePintIndex();
    expect(index?.rows.find((row) => row.zone === 1)?.enough).toBe(true);
    expect(readFile).toHaveBeenCalledTimes(2);
  });

  it("reads and rolls up the slim index once per server process", async () => {
    const loadZonePintIndex = await freshLoader();
    readFile.mockResolvedValue(JSON.stringify(rows("pub", MIN_PRICED_VENUES, 5)));
    const [first, second] = await Promise.all([loadZonePintIndex(), loadZonePintIndex()]);
    const third = await loadZonePintIndex();
    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(readFile).toHaveBeenCalledTimes(1);
  });
});
