import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { NEAR_NAME_OWNER_RADIUS_M, nearNameOwnerIndex } from "@/lib/outerLondonOwnership.mjs";
import { mergeOsmTwins } from "@/scripts/lib/ukBaseOsmTwins.mjs";

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

describe("a pub OpenStreetMap maps twice, as a node and its building's way", () => {
  it("publishes inherited addresses in five-column national search records", () => {
    const { pubs } = readJson("data/generated/uk_pub_search.json") as { pubs: unknown[][] };
    expect(pubs.every((row) => row.length === 5)).toBe(true);
    expect(pubs).toContainEqual([
      "n3898524863", "Golden Lion", "54, Bedhampton Road, Havant, PO9 3EY", 50.85486, -0.99828,
    ]);
    expect(pubs).toContainEqual([
      "n16574759", "The Langley Tavern", "Lepe Road, Southampton, SO45 1XR", 50.80743, -1.36811,
    ]);
    expect(pubs).toContainEqual([
      "n2458210719", "The Brendon Arms", "Vicarage Road, Bude, EX23 8SD", 50.8267, -4.54785,
    ]);
    expect(pubs.some((row) => row[0] === "w1007388063")).toBe(false);
  });

  it("ships the node alone, with the way's address and owner where the node has none", () => {
    const far = ["n3", "The Swan", "", 51.5 + 200 * METRE, -0.1, ""];
    const otherName = ["w4", "The Crown", "", 51.5, -0.1, ""];
    const twoNodes = [
      ["n5", "The Bell", "", 51.6, -0.1, ""],
      ["n6", "The Bell", "", 51.6, -0.1, ""],
    ];
    const { rows, twins } = mergeOsmTwins([
      ["n1", "The Swan", "", 51.5, -0.1, ""],
      ["w2", "the swan", "High Street", 51.5 + 30 * METRE, -0.1, "venue-x"],
      far,
      otherName,
      ...twoNodes,
    ]);
    expect(rows).toEqual([["n1", "The Swan", "High Street", 51.5, -0.1, "venue-x"], far, otherName, ...twoNodes]);
    expect([...twins]).toEqual([["w2", "n1"]]);
  });

  it("is one pub only within 50 m", () => {
    const node = ["n1", "The Swan", "", 51.5, -0.1, ""];
    expect(mergeOsmTwins([node, ["w2", "The Swan", "", 51.5 + 49 * METRE, -0.1, ""]]).twins.size).toBe(1);
    expect(mergeOsmTwins([node, ["w2", "The Swan", "", 51.5 + 51 * METRE, -0.1, ""]]).twins.size).toBe(0);
  });

  it("gives the committed shards one pin for each pair #2218 found mapped twice", () => {
    // Group C of Singularityszn/pubmax#2218: the node is kept, the way is not.
    const pairs = { n316951209: "w1499736517", n213434643: "w1414645898" };
    const manifest = readJson("public/data/uk_base/manifest.json") as {
      urlPrefix?: string;
      shards: { id: string }[];
    };
    const refs = new Set<string>();
    for (const shard of manifest.shards) {
      const pack = readJson(path.join("public", manifest.urlPrefix ?? "data/uk_base", `${shard.id}.json`)) as {
        pubs?: unknown[][];
      };
      for (const row of pack.pubs ?? []) refs.add(String(row[0]));
    }
    for (const [node, way] of Object.entries(pairs)) {
      expect(refs.has(node)).toBe(true);
      expect(refs.has(way)).toBe(false);
    }
    const aliases = readJson("public/data/uk_base_venue_id_aliases.json").aliases;
    expect(aliases["venue-uk-w1499736517"]).toBe("venue-uk-n316951209");
    expect(aliases["venue-uk-w1414645898"]).toBe("venue-uk-n213434643");
  });
});
