import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { outerLondonOwnerForPub } from "@/lib/outerLondonOwnership.mjs";
import { stableVenueIdFromKey, venueGroupingKey } from "@/scripts/lib/venueCanonicalization.mjs";

const ROOT = process.cwd();
const readJson = (relative: string) => JSON.parse(readFileSync(path.join(ROOT, relative), "utf8"));

describe("a base pub whose curated record was merged away", () => {
  it("is owned by the venue that kept it", () => {
    const pub = { name: "Mc Glynn's Bar", address: "70, Willesden Lane, London, NW6 7SX", lat: 51.5434, lng: -0.1948 };
    const ownId = stableVenueIdFromKey(
      venueGroupingKey({ pub_name: pub.name, address: pub.address, latitude: pub.lat, longitude: pub.lng }),
    );
    const kept = { id: "venue-kept", name: "McGlynn’s Bar", lat: 51.5434, lng: -0.1948 };
    expect(outerLondonOwnerForPub(pub, [kept])).toBeNull();
    expect(outerLondonOwnerForPub(pub, [kept], { [ownId]: "venue-kept" })).toBe("venue-kept");
  });

  it("is never left on a merged-away id in the committed packs", () => {
    const aliases = readJson("public/data/venue_id_aliases.json").aliases as Record<string, string>;
    const manifest = readJson("public/data/uk_base/manifest.json") as {
      urlPrefix?: string;
      shards: { id: string }[];
    };
    const stale: string[] = [];
    for (const shard of manifest.shards) {
      const pack = readJson(path.join("public", manifest.urlPrefix ?? "data/uk_base", `${shard.id}.json`)) as {
        pubs?: unknown[][];
      };
      for (const row of pack.pubs ?? []) {
        const owner = row[5];
        if (typeof owner === "string" && owner in aliases) stale.push(`${String(row[0])}:${owner}`);
      }
    }
    expect(stale).toEqual([]);
  });
});
