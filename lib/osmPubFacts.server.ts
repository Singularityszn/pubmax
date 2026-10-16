import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { canonicalOsmId } from "@/lib/harvestFold";
import { osmPubFactsFromRow, type OsmPubFacts } from "@/lib/osmPubFacts";
import { OSM_PUB_FACTS_TRACING_INCLUDE } from "@/lib/osmPubFactsFile.mjs";

let cachedByOsmId: Promise<ReadonlyMap<string, OsmPubFacts>> | undefined;

async function readByOsmId(): Promise<ReadonlyMap<string, OsmPubFacts>> {
  const byOsmId = new Map<string, OsmPubFacts>();
  try {
    const file = JSON.parse(
      await readFile(path.join(/* turbopackIgnore: true */ process.cwd(), OSM_PUB_FACTS_TRACING_INCLUDE), "utf8"),
    );
    if (file?.version !== 1 || !Array.isArray(file.rows)) return byOsmId;
    for (const row of file.rows) {
      const facts = osmPubFactsFromRow(row);
      if (facts) byOsmId.set(facts.osmId, facts);
    }
  } catch {
    // A failed read is not cached, so the next request asks the file again.
    cachedByOsmId = undefined;
    return new Map();
  }
  return byOsmId;
}

/**
 * What OpenStreetMap states about the pub these OSM ids name, or null. One
 * venue can carry several OSM ids. When exactly one of them has facts, those
 * are the venue's. When two do, we cannot tell which feature is the pub, so
 * neither is shown. A missing or unreadable pack states nothing.
 */
export async function osmFactsForOsmIds(osmIds: readonly string[]): Promise<OsmPubFacts | null> {
  const ids = [...new Set(osmIds.map(canonicalOsmId).filter((id): id is string => id !== null))];
  if (ids.length === 0) return null;
  cachedByOsmId ??= readByOsmId();
  const byOsmId = await cachedByOsmId;
  const found = ids.flatMap((id) => {
    const facts = byOsmId.get(id);
    return facts ? [facts] : [];
  });
  return found.length === 1 ? (found[0] ?? null) : null;
}
