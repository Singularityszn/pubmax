import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { NEAR_NAME_OWNER_RADIUS_M, nearNameOwnerIndex } from "@/lib/outerLondonOwnership.mjs";

const ROOT = process.cwd();
const readJson = (relative: string) => JSON.parse(readFileSync(path.join(ROOT, relative), "utf8"));

// 1 m of latitude, near enough everywhere in the UK for a fixture.
const METRE = 1 / 111_000;

describe("a base pub whose curated twin spells its name another way", () => {
  const curated = (name: string, lat = 51.5, id = "venue-curated") => [{ id, name, lat, lng: -0.1 }];
  const owner = (pubName: string, venues: ReturnType<typeof curated>, lat = 51.5) =>
    nearNameOwnerIndex(venues)({ name: pubName, lat, lng: -0.1 });

  it("is owned by that venue across '&', 'The', 'Public House' and an apostrophe", () => {
    expect(owner("The King & Queen", curated("The King and Queen"))).toBe("venue-curated");
    expect(owner("Royal Oak", curated("The Royal Oak Public House"))).toBe("venue-curated");
    expect(owner("The New Inn", curated("The New Inn Public House"))).toBe("venue-curated");
    expect(owner("The Champion", curated("The Champion Public House"))).toBe("venue-curated");
    expect(owner("Paxton’s Head", curated("Paxtons Head"))).toBe("venue-curated");
  });

  it("is a near name, so it holds only within 45 m", () => {
    const venues = curated("The Royal Albert Public House");
    expect(NEAR_NAME_OWNER_RADIUS_M).toBe(45);
    expect(owner("Royal Albert", venues, 51.5 + 44 * METRE)).toBe("venue-curated");
    expect(owner("Royal Albert", venues, 51.5 + 46 * METRE)).toBeNull();
  });

  it("never joins two pubs that only share a word", () => {
    expect(owner("The Bell", curated("The Bell and Crown"))).toBeNull();
    expect(owner("The Crown", curated("The Crown and Anchor"))).toBeNull();
    expect(owner("Public House", curated("The Public House"))).toBeNull();
  });

  it("goes to the nearest of two venues it could be", () => {
    const venues = [
      ...curated("Rose & Crown", 51.5 + 20 * METRE, "venue-far"),
      ...curated("The Rose and Crown", 51.5 + 5 * METRE, "venue-near"),
    ];
    expect(owner("Rose and Crown", venues)).toBe("venue-near");
  });

  it("gives the committed shards one pin for each pair #2218 found drawn twice", () => {
    // Group B of Singularityszn/pubmax#2218: OSM ref -> the curated venue it is.
    const pairs: Record<string, string> = {
      w685890788: "venue-19x32b4",
      w227887265: "venue-18a72vf",
      w659258969: "venue-1jybl1w",
      n280606917: "venue-bggdnc",
      w718214669: "venue-1ogmqc1",
      w430448024: "venue-1vqfgdi",
      w279533213: "venue-phqazo",
      w459902731: "venue-1pnwx8j",
      n14178896030: "venue-xiesdn",
      w651644530: "venue-1pxz2e",
      w232592409: "venue-zxwzrd",
      w514560030: "venue-ydxxrn",
      w633865298: "venue-gugv4t",
      w238385297: "venue-1sxdho2",
      w381748316: "venue-z16rcv",
    };
    const manifest = readJson("public/data/uk_base/manifest.json") as {
      urlPrefix?: string;
      shards: { id: string }[];
    };
    const owners: Record<string, string> = {};
    for (const shard of manifest.shards) {
      const pack = readJson(path.join("public", manifest.urlPrefix ?? "data/uk_base", `${shard.id}.json`)) as {
        pubs?: unknown[][];
      };
      for (const row of pack.pubs ?? []) {
        const ref = String(row[0]);
        if (ref in pairs) owners[ref] = String(row[5]);
      }
    }
    expect(owners).toEqual(pairs);
  });
});
