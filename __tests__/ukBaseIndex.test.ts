import { promises as fs } from "fs";
import path from "path";

import { beforeEach, describe, expect, it } from "vitest";

import { getUkBaseIdIndex, resetUkBaseIndexForTests } from "@/lib/ukBaseIndex";
import { UK_BASE_ID_PREFIX, ukBaseIdFor } from "@/lib/ukBasePubs";

// The server-side membership index for `venue-uk-…` ids — the thing that lets
// /api/price-submit accept a real base pub without accepting a fabricated id
// on shape alone. Asserted against the committed shard pack, not fixtures, so
// a pack refresh that broke the decode would fail here first.

async function firstCommittedOsmRef(): Promise<string> {
  const manifestRaw = await fs.readFile(
    path.join(process.cwd(), "public", "data", "uk_base", "manifest.json"),
    "utf8",
  );
  const manifest = JSON.parse(manifestRaw) as { shards: Array<{ url: string }> };
  const shardRaw = await fs.readFile(
    path.join(process.cwd(), "public", manifest.shards[0].url.replace(/^\//, "")),
    "utf8",
  );
  const shard = JSON.parse(shardRaw) as { pubs: Array<[string, ...unknown[]]> };
  return shard.pubs[0][0];
}

beforeEach(() => {
  resetUkBaseIndexForTests();
});

describe("getUkBaseIdIndex", () => {
  it("contains every committed base pub id, prefixed, and nothing malformed", async () => {
    const index = await getUkBaseIdIndex();
    // The full pack is ~35k pubs; a partial read would collapse well below it.
    expect(index.size).toBeGreaterThan(30_000);
    for (const id of index) {
      expect(id.startsWith(UK_BASE_ID_PREFIX)).toBe(true);
    }
  });

  it("answers has() for a real shard row's id", async () => {
    const osmRef = await firstCommittedOsmRef();
    const index = await getUkBaseIdIndex();
    expect(index.has(ukBaseIdFor(osmRef))).toBe(true);
  });

  it("rejects a well-formed id that no shard carries", async () => {
    const index = await getUkBaseIdIndex();
    expect(index.has(`${UK_BASE_ID_PREFIX}n0000000000`)).toBe(false);
  });

  it("memoizes: a second call returns the same set instance", async () => {
    const first = await getUkBaseIdIndex();
    const second = await getUkBaseIdIndex();
    expect(second).toBe(first);
  });
});
