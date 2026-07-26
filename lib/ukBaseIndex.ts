import { promises as fs } from "fs";
import path from "path";

import { parseShardManifest, type ShardEntry } from "@/lib/slimShards";
import {
  UK_BASE_MANIFEST_PATH,
  UK_BASE_SHARD_VERSION,
  parseUkBaseShardForEntry,
} from "@/lib/ukBasePubs";

// Server-only membership index for the UK BASE layer, the sibling of
// lib/venueIndex.ts for `venue-uk-…` ids. Base pubs deliberately live OUTSIDE
// the curated venue index (that is what keeps them out of search, the price
// filters and the crawl router), but they ARE a price-submission target — so
// /api/price-submit needs a way to tell a real base pub from a fabricated
// `venue-uk-…` id. Never accept an id on shape alone: an unvalidated id could
// scope its own rate-limit bucket and litter the community-price store, which
// is exactly the hole the slim-index membership check closed.
//
// It reads the committed shard pack (~2.7 MB) with `fs` — so import it ONLY
// from server code. Client code streams the same shards per viewport through
// lib/ukBasePubs.ts; the id decode is shared (parseUkBaseShard), so the two
// sides can never disagree about which ids exist.
//
// Never throws. A read/parse failure returns an explicit unavailable result,
// each shard is cached individually so a transient per-shard failure retries
// on the next call, and the merged set is only memoized once every shard loads.

export type UkBaseIdIndexResult =
  | { status: "ready"; ids: Set<string> }
  | { status: "unavailable" };

let cached: UkBaseIdIndexResult | null = null;
const shardCache = new Map<string, string[]>();

function publicDataPath(publicPath: string): string {
  return path.join(process.cwd(), "public", publicPath.replace(/^\//, ""));
}

async function readShardIds(shard: ShardEntry): Promise<string[] | null> {
  const body: unknown = JSON.parse(
    await fs.readFile(publicDataPath(shard.url), "utf8"),
  );
  const pubs = parseUkBaseShardForEntry(body, shard);
  if (!pubs) return null;
  return pubs.map((pub) => pub.id);
}

export async function getUkBaseIdIndex(): Promise<UkBaseIdIndexResult> {
  if (cached) return cached;
  let manifest: ReturnType<typeof parseShardManifest>;
  try {
    manifest = parseShardManifest(
      JSON.parse(await fs.readFile(publicDataPath(UK_BASE_MANIFEST_PATH), "utf8")),
    );
  } catch {
    manifest = null;
  }
  if (
    !manifest ||
    manifest.version !== UK_BASE_SHARD_VERSION ||
    manifest.shards.length === 0 ||
    manifest.shards.some(
      (shard) =>
        !Number.isSafeInteger(shard.count) ||
        shard.count <= 0 ||
        !shard.url.startsWith("/data/uk_base/") ||
        shard.url.split("/").includes(".."),
    )
  ) {
    return { status: "unavailable" };
  }
  for (const shard of manifest.shards) {
    if (shardCache.has(shard.url)) continue;
    try {
      const ids = await readShardIds(shard);
      if (ids) shardCache.set(shard.url, ids);
    } catch {
      // Retry on the next call without publishing a partial authority.
    }
  }
  const index = new Set<string>();
  let expectedCount = 0;
  for (const shard of manifest.shards) {
    const ids = shardCache.get(shard.url);
    if (!ids) return { status: "unavailable" };
    expectedCount += shard.count;
    for (const id of ids) index.add(id);
  }
  if (index.size !== expectedCount) return { status: "unavailable" };
  cached = { status: "ready", ids: index };
  return cached;
}

export function resetUkBaseIndexForTests(): void {
  if (
    process.env.NODE_ENV === "test" ||
    Boolean(process.env.VITEST) ||
    Boolean(process.env.VITEST_WORKER_ID)
  ) {
    cached = null;
    shardCache.clear();
  }
}
