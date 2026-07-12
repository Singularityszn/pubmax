import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

// The generator is a plain .mjs build script (no .d.ts, matching the repo's
// other scripts/*.mjs); import it with types suppressed rather than shipping a
// stub declaration. Same pattern as the other .mjs-in-test imports.
// @ts-ignore -- untyped .mjs module (resolves fine at runtime under vitest)
import { buildHistoricIndex, extractEra, extractListed, slugify, generate } from "../scripts/build_historic_index.mjs";

// A tiny, self-contained fixture — deliberately NOT the committed dataset, so
// these assertions can never drift with the real data.
const FIXTURE_CACHE = {
  // Matched to a venue row; has BOTH a century and a year → earliest (century)
  // wins for `era`, and a Grade II* → listed must preserve the star.
  "the old bell": [
    { source: "seed", fact: "A tavern here since the 15th century.", sourceRef: "https://ex/1" },
    { source: "wikipedia", fact: "The Old Bell is a Grade II* listed pub rebuilt in 1670.", sourceRef: "https://ex/2" },
  ],
  // Matched; a plain Grade II, no year/century → era null, listed "II".
  "the new inn": [
    { source: "osm", fact: "A Grade II listed coaching inn on the green.", sourceRef: "https://ex/3" },
  ],
  // Unmatched (no dataset row); has a year → era "1720".
  "the bell": [{ source: "wikipedia", fact: "Established 1720, a fine old house." }],
  // Unmatched; slugifies to the SAME base as "the bell" → collision suffix test.
  "the bell!": [{ source: "seed", fact: "No dates on record here at all." }],
};

const FIXTURE_DATASET = [
  {
    pub_name: "The Old Bell",
    address: "1 High Street, London, EC4",
    latitude: 51.5,
    longitude: -0.1,
    primary_borough: "Camden",
  },
  {
    pub_name: "The New Inn",
    address: "9 Green Lane, London, E8",
    latitude: 51.55,
    longitude: -0.05,
    primary_borough: "Hackney",
  },
];

const EXPECTED_KEYS = [
  "venueId",
  "name",
  "slug",
  "borough",
  "lat",
  "lng",
  "hook",
  "facts",
  "era",
  "listed",
  "sourced",
];

function byName(records: any[], name: string) {
  return records.find((r) => r.name === name);
}

describe("buildHistoricIndex — schema + join", () => {
  const records = buildHistoricIndex({ heritageCache: FIXTURE_CACHE, dataset: FIXTURE_DATASET });

  it("emits exactly one record per cache entry", () => {
    expect(records).toHaveLength(Object.keys(FIXTURE_CACHE).length);
  });

  it("every record has exactly the documented schema keys, in order", () => {
    for (const rec of records) {
      expect(Object.keys(rec)).toEqual(EXPECTED_KEYS);
      expect(rec.sourced).toBe(true);
      expect(Array.isArray(rec.facts)).toBe(true);
    }
  });

  it("fills venue fields from the matched dataset row", () => {
    const oldBell = byName(records, "The Old Bell");
    expect(typeof oldBell.venueId).toBe("string");
    expect(oldBell.venueId).toMatch(/^venue-/);
    expect(oldBell.borough).toBe("Camden");
    expect(oldBell.lat).toBe(51.5);
    expect(oldBell.lng).toBe(-0.1);
    // hook prefers the wikipedia-source fact over the seed fact.
    expect(oldBell.hook).toBe("The Old Bell is a Grade II* listed pub rebuilt in 1670.");
    expect(oldBell.facts).toHaveLength(2);
  });

  it("leaves venue fields null when there is no dataset match", () => {
    const bell = byName(records, "The Bell");
    expect(bell.venueId).toBeNull();
    expect(bell.borough).toBeNull();
    expect(bell.lat).toBeNull();
    expect(bell.lng).toBeNull();
    // Unmatched name is title-cased from the cache key.
    expect(bell.name).toBe("The Bell");
  });
});

describe("extractEra — earliest cited period wins", () => {
  it("extracts a 4-digit year in 1400–1999", () => {
    expect(extractEra("Established 1720, a fine house.").era).toBe("1720");
  });

  it("ignores years outside 1400–1999", () => {
    expect(extractEra("Refitted in 2019; nothing older cited.").era).toBeNull();
  });

  it("extracts an Nth-century (space or hyphen form)", () => {
    expect(extractEra("A 13th century tavern.").era).toBe("13th century");
    expect(extractEra("A 17th-century coaching inn.").era).toBe("17th century");
  });

  it("picks the EARLIEST of several years", () => {
    expect(extractEra("Rebuilt 1720 after a fire, first licensed 1650.").era).toBe("1650");
  });

  it("prefers an earlier century over a later year", () => {
    // 15th century (→1400) is earlier than the cited 1670.
    expect(extractEra("A tavern here since the 15th century, rebuilt in 1670.").era).toBe(
      "15th century",
    );
  });

  it("returns null when no year or century is cited", () => {
    expect(extractEra("No dates on record here at all.").era).toBeNull();
  });
});

describe("extractListed — grade preserves the star", () => {
  it("captures Grade I", () => {
    expect(extractListed("A Grade I listed masterpiece.")).toBe("I");
  });

  it("captures Grade II*", () => {
    expect(extractListed("The pub is a Grade II* listed building.")).toBe("II*");
  });

  it("captures plain Grade II", () => {
    expect(extractListed("A Grade II listed coaching inn.")).toBe("II");
  });

  it("returns null when no grade is cited", () => {
    expect(extractListed("A historic pub with no listing on record.")).toBeNull();
  });
});

describe("slug — deterministic + unique with -2 collision suffix", () => {
  const records = buildHistoricIndex({ heritageCache: FIXTURE_CACHE, dataset: FIXTURE_DATASET });

  it("slugifies names url-safely", () => {
    expect(slugify("The Old Bell")).toBe("the-old-bell");
    expect(byName(records, "The Old Bell").slug).toBe("the-old-bell");
  });

  it("suffixes colliding slugs with -2 (and all slugs are unique)", () => {
    // "The Bell" and "The Bell!" both slugify to "the-bell".
    const first = byName(records, "The Bell").slug;
    const second = byName(records, "The Bell!").slug;
    expect(new Set([first, second]).size).toBe(2);
    expect([first, second].sort()).toEqual(["the-bell", "the-bell-2"]);
    const allSlugs = records.map((r: any) => r.slug);
    expect(new Set(allSlugs).size).toBe(allSlugs.length);
  });
});

describe("generate — deterministic + idempotent over a /tmp fixture", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "historic-idx-"));
  const cachePath = path.join(dir, "heritage_cache.json");
  const datasetPath = path.join(dir, "dataset.json");
  const outA = path.join(dir, "out-a.json");
  const outB = path.join(dir, "out-b.json");

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("produces byte-identical output on two runs", async () => {
    writeFileSync(cachePath, JSON.stringify(FIXTURE_CACHE));
    writeFileSync(datasetPath, JSON.stringify(FIXTURE_DATASET));

    const a = await generate({ cachePath, datasetPath, outPath: outA });
    const b = await generate({ cachePath, datasetPath, outPath: outB });

    expect(a.total).toBe(Object.keys(FIXTURE_CACHE).length);
    expect(readFileSync(outA, "utf8")).toBe(readFileSync(outB, "utf8"));

    // Re-running over the SAME out path is also byte-stable.
    const firstBytes = readFileSync(outA, "utf8");
    await generate({ cachePath, datasetPath, outPath: outA });
    expect(readFileSync(outA, "utf8")).toBe(firstBytes);

    // Summary stats reflect the fixture: 2 matched (old bell, new inn),
    // 2 with era (old bell "15th century", the bell "1720"),
    // 2 with a listing grade (old bell "II*", new inn "II").
    expect(a.matched).toBe(2);
    expect(a.withEra).toBe(2);
    expect(a.withListed).toBe(2);
  });
});
