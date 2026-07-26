import { promises as fs } from "fs";
import path from "path";

import { parseShardManifest } from "@/lib/slimShards";
import { parseUkBaseShard, UK_BASE_MANIFEST_PATH } from "@/lib/ukBasePubs";

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
// Degradation mirrors lib/venueIndex.ts exactly: never throws, a read/parse
// failure yields an EMPTY set (the caller answers 503, retryable), each shard
// is cached individually so a transient per-shard failure retries on the next
// call, and the merged set is only memoized once every shard has loaded.

let cached: Set<string> | null = null;
const shardCache = new Map<string, string[]>();

function publicDataPath(publicPath: string): string {
  return path.join(process.cwd(), "public", publicPath.replace(/^\//, ""));
}

async function readShardIds(publicPath: string): Promise<string[]> {
  const body: unknown = JSON.parse(await fs.readFile(publicDataPath(publicPath), "utf8"));
  return parseUkBaseShard(body).map((pub) => pub.id);
}

export async function getUkBaseIdIndex(): Promise<Set<string>> {
  if (cached) return cached;
  let manifest: ReturnType<typeof parseShardManifest>;
  try {
    manifest = parseShardManifest(
      JSON.parse(await fs.readFile(publicDataPath(UK_BASE_MANIFEST_PATH), "utf8")),
    );
  } catch {
    manifest = null;
  }
  if (!manifest) return new Set();
  let allLoaded = true;
  for (const shard of manifest.shards) {
    if (shardCache.has(shard.url)) continue;
    try {
      shardCache.set(shard.url, await readShardIds(shard.url));
    } catch {
      // Skip this shard for now; it retries on the next call.
      allLoaded = false;
    }
  }
  const index = new Set<string>();
  for (const shard of manifest.shards) {
    const ids = shardCache.get(shard.url);
    if (!ids) continue;
    for (const id of ids) index.add(id);
  }
  if (allLoaded) cached = index;
  return index;
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
