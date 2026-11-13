import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

import type { HistoricPub } from "@/lib/historic";

// The generator is a plain .mjs build script (no .d.ts, matching the repo's
// other scripts/*.mjs); import it with types suppressed rather than shipping a
// stub declaration. Same pattern as the other .mjs-in-test imports.
import {
  buildHistoricIndex,
  buildHistoricPublication,
  buildVenueIdIndex,
  extractEra,
  extractListed,
  slugify,
  generate,
  titleCase,
  VENUE_ID_BY_CACHE_KEY,
  // @ts-expect-error -- untyped .mjs module (resolves fine at runtime under vitest)
} from "../scripts/build_historic_index.mjs";
import { defined } from "@/__tests__/helpers/defined";

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
  "the bell": [{ source: "wikipedia", fact: "Established 1720, a fine old house." }],
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

const FIXTURE_REGISTRY = {
  datasets: [
    { id: "historic_pubs", stamp: { kind: "literal", value: "2026-10-16T00:00:00Z" } },
    { id: "other", stamp: { kind: "literal", value: "2026-09-01T00:00:00Z" } },
  ],
};

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
  "dateValue",
  "datePrecision",
  "dateType",
  "dateLabel",
  "listed",
  "sourced",
];

function byName(records: HistoricPub[], name: string): HistoricPub {
  const found = records.find((r) => r.name === name);
  if (!found) throw new Error(`no historic record named ${name}`);
  return found;
}

describe("buildHistoricIndex — schema + join", () => {
  const records: HistoricPub[] = buildHistoricIndex({ heritageCache: FIXTURE_CACHE, dataset: FIXTURE_DATASET });

  it("retains uniquely named and unlinked directory records", () => {
    expect(records).toHaveLength(4);
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

  it("keeps an unmatched directory record without a venue identity", () => {
    expect(byName(records, "The Bell")).toMatchObject({
      venueId: null, borough: null, lat: null, lng: null,
      facts: [{ source: "wikipedia", fact: "Established 1720, a fine old house." }],
    });
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

describe("venue status — curated closed and demolished pubs", () => {
  it("emits venueStatus only for named cache keys", () => {
    const cache = {
      "the colony room": [{ source: "seed", fact: "A Soho members' club." }],
      "the black cap": [{ source: "seed", fact: "A Camden landmark." }],
      "the sir george robey": [{ source: "seed", fact: "A Finsbury Park pub." }],
      "the old bell": [{ source: "seed", fact: "Still trading." }],
    };
    const records: HistoricPub[] = buildHistoricIndex({
      heritageCache: Object.fromEntries(Object.entries(cache).map(([name, facts]) => [name,
        facts.map((fact) => ({ ...fact, address: "1 High Street" })),
      ])),
      dataset: Object.keys(cache).map((name) => ({
        ...FIXTURE_DATASET[0], pub_name: titleCase(name), address: "1 High Street",
      })),
    });
    expect(byName(records, "The Colony Room").venueStatus).toBe("closed");
    expect(byName(records, "The Black Cap").venueStatus).toBe("closed");
    expect(byName(records, "The Sir George Robey").venueStatus).toBe("demolished");
    expect(byName(records, "The Old Bell").venueStatus).toBeUndefined();
  });
});

describe("slug — deterministic + unique with -2 collision suffix", () => {
  const records: HistoricPub[] = buildHistoricIndex({
    heritageCache: {
      ...FIXTURE_CACHE,
      "the bell": [{ source: "seed", fact: "Established 1720.", address: "2 Bell Lane" }],
      "the bell!": [{ source: "seed", fact: "A public house.", address: "3 Bell Lane" }],
    },
    dataset: [
      ...FIXTURE_DATASET,
      { ...FIXTURE_DATASET[0], pub_name: "The Bell", address: "2 Bell Lane" },
      { ...FIXTURE_DATASET[0], pub_name: "The Bell!", address: "3 Bell Lane" },
    ],
  });

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
    const allSlugs = records.map((r) => r.slug);
    expect(new Set(allSlugs).size).toBe(allSlugs.length);
  });
});

describe("generate — deterministic + idempotent over a /tmp fixture", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "historic-idx-"));
  const cachePath = path.join(dir, "heritage_cache.json");
  const datasetPath = path.join(dir, "dataset.json");
  const outA = path.join(dir, "out-a.json");
  const outB = path.join(dir, "out-b.json");
  const registryPath = path.join(dir, "freshness_registry.json");
  writeFileSync(registryPath, JSON.stringify(FIXTURE_REGISTRY));

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("produces byte-identical output on two runs", async () => {
    writeFileSync(cachePath, JSON.stringify(FIXTURE_CACHE));
    writeFileSync(datasetPath, JSON.stringify(FIXTURE_DATASET));

    const a = await generate({ cachePath, datasetPath, outPath: outA, registryPath });
    await generate({ cachePath, datasetPath, outPath: outB, registryPath });

    expect(a.total).toBe(4);
    expect(readFileSync(outA, "utf8")).toBe(readFileSync(outB, "utf8"));

    // Re-running over the SAME out path is also byte-stable.
    const firstBytes = readFileSync(outA, "utf8");
    await generate({ cachePath, datasetPath, outPath: outA, registryPath });
    expect(readFileSync(outA, "utf8")).toBe(firstBytes);

    expect(a.matched).toBe(2);
    expect(a.withEra).toBe(2);
    expect(a.withListed).toBe(2);
  });

  it("advances only the historic stamp after byte-identical rebuilds", async () => {
    writeFileSync(cachePath, JSON.stringify(FIXTURE_CACHE));
    writeFileSync(datasetPath, JSON.stringify(FIXTURE_DATASET));
    writeFileSync(registryPath, JSON.stringify(FIXTURE_REGISTRY));
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-11-12T06:17:00Z"));
      await generate({ cachePath, datasetPath, outPath: outA, registryPath });
      const firstBytes = readFileSync(outA, "utf8");
      expect(JSON.parse(readFileSync(registryPath, "utf8"))).toEqual({
        datasets: [
          { id: "historic_pubs", stamp: { kind: "literal", value: "2026-11-12T06:17:00.000Z" } },
          FIXTURE_REGISTRY.datasets[1],
        ],
      });

      vi.setSystemTime(new Date("2026-12-03T06:17:00Z"));
      await generate({ cachePath, datasetPath, outPath: outA, registryPath });
      expect(readFileSync(outA, "utf8")).toBe(firstBytes);
      expect(JSON.parse(readFileSync(registryPath, "utf8"))).toEqual({
        datasets: [
          { id: "historic_pubs", stamp: { kind: "literal", value: "2026-12-03T06:17:00.000Z" } },
          FIXTURE_REGISTRY.datasets[1],
        ],
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not advance freshness when the index cannot be written", async () => {
    writeFileSync(cachePath, JSON.stringify(FIXTURE_CACHE));
    writeFileSync(datasetPath, JSON.stringify(FIXTURE_DATASET));
    writeFileSync(registryPath, JSON.stringify(FIXTURE_REGISTRY));
    const before = readFileSync(registryPath, "utf8");
    await expect(generate({
      cachePath,
      datasetPath,
      outPath: path.join(dir, "missing-directory", "historic_pubs.json"),
      registryPath,
    })).rejects.toThrow();
    expect(readFileSync(registryPath, "utf8")).toBe(before);
  });
});


describe("venue joins survive a renamed or merged dataset row", () => {
  it("keeps the Black Friar heritage page joined to the canonical Blackfriar", () => {
    const records: HistoricPub[] = buildHistoricIndex({
      heritageCache: {
        "the black friar, blackfriars": [
          { source: "wikidata", address: "174 Queen Victoria St", fact: "pub in London, UK" },
        ],
      },
      dataset: [{
        pub_name: "The Blackfriar",
        address: "174 Queen Victoria St, Greater, London EC4V 4EG, UK",
        latitude: 51.5121,
        longitude: -0.103677,
        primary_borough: "City of London",
      }],
    });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      venueId: "venue-eltcmh",
      name: "The Black Friar, Blackfriars",
      slug: "the-black-friar-blackfriars",
      borough: "City of London",
      lat: 51.5121,
      lng: -0.103677,
      hook: "pub in London, UK",
      facts: [{ source: "wikidata", fact: "pub in London, UK" }],
    });
  });

  // The dataset spells this pub differently from the heritage key, and its
  // earlier identity was merged into the row below, so neither the name index
  // nor the raw id reaches it. Both hops have to be followed.
  const RENAMED_DATASET = [
    {
      pub_name: "George (Southwark)",
      address: "75-77 Borough High Street",
      latitude: 51.5042,
      longitude: -0.089992,
      primary_borough: "Southwark",
    },
  ];
  const canonicalId: string = defined([
    ...(buildVenueIdIndex(RENAMED_DATASET) as Map<string, { venueId: string }>).keys(),
  ][0]);
  const MERGED_ID = "venue-gone";
  const CACHE = {
    "the george inn": [
      { source: "wikipedia", address: "75-77 Borough High Street", fact: "A galleried coaching inn rebuilt in 1677." },
    ],
  };

  it("joins through the alias map and keeps the heritage name", () => {
    const records: HistoricPub[] = buildHistoricIndex({
      heritageCache: CACHE,
      dataset: RENAMED_DATASET,
      venueAliases: { [MERGED_ID]: canonicalId },
      venueIdsByCacheKey: { "the george inn": MERGED_ID },
    });

    const george = byName(records, "The George Inn");
    expect(george.venueId).toBe(canonicalId);
    expect(george.borough).toBe("Southwark");
    expect(george.lat).toBe(51.5042);
    expect(george.lng).toBe(-0.089992);
    // The dataset spelling is what drifted, so adopting it would rename the
    // pub and move its page.
    expect(george.slug).toBe("the-george-inn");
  });

  it("leaves the directory record unlinked when a curated id no longer resolves", () => {
    const records: HistoricPub[] = buildHistoricIndex({
      heritageCache: CACHE,
      dataset: RENAMED_DATASET,
      venueAliases: {},
      venueIdsByCacheKey: { "the george inn": MERGED_ID },
    });

    expect(records[0]).toMatchObject({ name: "The George Inn", venueId: null, lat: null, lng: null });
  });

  it("keeps joining words lowercase in a name taken from the cache key", () => {
    expect(titleCase("owl and pussycat")).toBe("Owl and Pussycat");
    expect(titleCase("the george inn")).toBe("The George Inn");
  });
});

describe("the shipped historic index (generated artifact)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "historic-shipped-"));
  const outPath = path.join(dir, "historic_pubs.json");
  const registryPath = path.join(dir, "freshness_registry.json");
  writeFileSync(registryPath, JSON.stringify(FIXTURE_REGISTRY));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  // public/data/historic_pubs.json is generated output, so the file that ships
  // must be exactly what the generator produces from today's inputs. A stale
  // artifact is what carried three venue links to pubs the dataset had already
  // renamed or dropped.
  it("is exactly what the generator writes from the current sources", async () => {
    await generate({ outPath, registryPath });
    expect(readFileSync(outPath, "utf8")).toBe(
      readFileSync("public/data/historic_pubs.json", "utf8"),
    );
  });

  it("buildHistoricIndex preserves the committed historic_pubs.json byte contract", () => {
    const records = buildHistoricIndex({
      heritageCache: JSON.parse(readFileSync("public/data/heritage_cache.json", "utf8")),
      dataset: JSON.parse(readFileSync("public/data/pint_prices_app_dataset.json", "utf8")),
      venueAliases: JSON.parse(readFileSync("public/data/venue_id_aliases.json", "utf8")).aliases,
    });
    expect(Buffer.from(`${JSON.stringify(records, null, 2)}\n`)).toEqual(
      readFileSync("public/data/historic_pubs.json"),
    );
  });

  it("names no venue the map cannot open", () => {
    const historic = JSON.parse(
      readFileSync("public/data/historic_pubs.json", "utf8"),
    ) as HistoricPub[];
    const listed = new Set(
      (
        (
          JSON.parse(readFileSync("public/data/venues_slim.json", "utf8")) as {
            rows?: { id: string }[];
          }
        ).rows ?? []
      ).map((row) => row.id),
    );
    const dangling = historic
      .filter((rec) => rec.venueId != null && !listed.has(rec.venueId))
      .map((rec) => `${rec.slug}:${rec.venueId}`);
    expect(dangling).toEqual([]);
  });

  it("keeps only the existing Barley Mow directory record unlinked", () => {
    const historic = JSON.parse(
      readFileSync("public/data/historic_pubs.json", "utf8"),
    ) as HistoricPub[];
    const unjoined = historic
      .filter((rec) => rec.venueId == null)
      .map((rec) => rec.slug);
    expect(unjoined).toEqual(["the-barley-mow"]);

    for (const rec of historic) {
      if (rec.venueId == null) continue;
      expect(rec.borough, `${rec.slug} carries a borough`).toBeTruthy();
      expect(typeof rec.lat, `${rec.slug} carries a latitude`).toBe("number");
      expect(typeof rec.lng, `${rec.slug} carries a longitude`).toBe("number");
    }
  });

  it("drops no join the shipped index already holds", async () => {
    const regeneratedPath = path.join(dir, "historic_pubs_rejoin.json");
    await generate({ outPath: regeneratedPath, registryPath });
    const regenerated = JSON.parse(
      readFileSync(regeneratedPath, "utf8"),
    ) as HistoricPub[];
    const bySlug = new Map(regenerated.map((rec) => [rec.slug, rec]));
    const shipped = JSON.parse(
      readFileSync("public/data/historic_pubs.json", "utf8"),
    ) as HistoricPub[];

    const lost: string[] = [];
    for (const rec of shipped) {
      if (rec.venueId == null) continue;
      const now = bySlug.get(rec.slug);
      if (
        !now ||
        now.venueId !== rec.venueId ||
        now.borough !== rec.borough ||
        now.lat !== rec.lat ||
        now.lng !== rec.lng
      ) {
        lost.push(rec.slug);
      }
    }
    expect(lost).toEqual([]);
  });

  it("keeps every curated venue link joined to a live venue", () => {
    const historic = JSON.parse(
      readFileSync("public/data/historic_pubs.json", "utf8"),
    ) as HistoricPub[];
    const listed = new Set(
      (
        (
          JSON.parse(readFileSync("public/data/venues_slim.json", "utf8")) as {
            rows?: { id: string }[];
          }
        ).rows ?? []
      ).map((row) => row.id),
    );
    const curatedKeys = Object.keys(
      VENUE_ID_BY_CACHE_KEY as Record<string, string>,
    );
    expect(curatedKeys.length).toBeGreaterThan(0);
    for (const cacheKey of curatedKeys) {
      const rec = historic.find((r) => r.slug === slugify(titleCase(cacheKey)));
      if (!rec) continue;
      expect(rec?.venueId, `${cacheKey} joins a venue`).toBeTruthy();
      expect(listed.has(rec?.venueId as string)).toBe(true);
      expect(rec?.borough).toBeTruthy();
      expect(typeof rec?.lat).toBe("number");
    }
  });
});

// F05: the publication gate. A fact written for us rather than for a reader is
// withheld and NAMED, never rewritten, so the cache entry behind it is what
// gets fixed. A record with nothing left to say is withheld whole rather than
// published with an empty description.
describe("buildHistoricPublication — internal language is quarantined", () => {
  const CACHE = {
    // One publishable fact and one internal note: the pub still publishes, on
    // the fact that was written for a reader.
    "the old bell": [
      { source: "wikipedia", address: "1 High Street", fact: "The Old Bell is a Grade II* listed pub rebuilt in 1670." },
      { source: "seed", address: "1 High Street", fact: "A useful reference stop for the seeded heritage route." },
    ],
    // Nothing but an internal note: the record is withheld whole.
    "the new inn": [
      { source: "seed", address: "9 Green Lane", fact: "Kept as a soft match until the exact pub is verified." },
    ],
  };

  const { records, quarantined } = buildHistoricPublication({
    heritageCache: CACHE,
    dataset: FIXTURE_DATASET,
  });

  it("publishes the pub, without the sentence written for us", () => {
    const bell = byName(records, "The Old Bell");
    expect(bell.facts).toHaveLength(1);
    expect(bell.hook).toBe("The Old Bell is a Grade II* listed pub rebuilt in 1670.");
    expect(JSON.stringify(bell)).not.toContain("reference stop");
  });

  it("withholds a record whose every fact was refused", () => {
    expect(records.find((r: HistoricPub) => r.name === "The New Inn")).toBeUndefined();
    expect(
      quarantined.some(
        (q: { cacheKey: string; reason: string }) =>
          q.cacheKey === "the new inn" && q.reason === "no-publishable-facts",
      ),
    ).toBe(true);
  });

  it("names what it withheld and why, so the cache entry can be corrected", () => {
    const refused = quarantined.filter(
      (q: { reason: string }) => q.reason === "internal-language",
    );
    expect(refused).toHaveLength(2);
    for (const item of refused) {
      expect(item.detail).toMatch(/[a-z-]+: ".+" .+/);
      expect(item.name).toBeTruthy();
    }
  });

  it("buildHistoricIndex still answers with the records alone", () => {
    expect(buildHistoricIndex({ heritageCache: CACHE, dataset: FIXTURE_DATASET })).toEqual(
      records,
    );
  });
});

// F06: two pubs with one name are two pubs. The heritage cache is keyed by pub
// NAME, so one key collects facts about several, and the join then hangs them
// all on whichever venue came first. A fact naming a borough other than the
// joined venue's is quarantined, never merged into the card.
describe("buildHistoricPublication — a fact about another borough is quarantined", () => {
  const CACHE = {
    // Joined to the Camden row. One fact agrees by silence, one names Hackney.
    "the old bell": [
      { source: "wikipedia", address: "1 High Street", fact: "The Old Bell is a Grade II* listed pub rebuilt in 1670." },
      {
        source: "wikidata",
        address: "1 High Street",
        fact: "pub in Hackney, London",
        sourceRef: "https://en.wikipedia.org/wiki/The_Old_Bell,_Hackney",
      },
    ],
    // Joined to the Hackney row, and its only fact is about a Camden pub.
    "the new inn": [{ source: "wikidata", address: "9 Green Lane", fact: "pub in Camden, London" }],
  };

  const { records, quarantined } = buildHistoricPublication({
    heritageCache: CACHE,
    dataset: FIXTURE_DATASET,
  });

  it("keeps the pub, on the fact that does not contradict its borough", () => {
    const bell = byName(records, "The Old Bell");
    expect(bell.borough).toBe("Camden");
    expect(bell.facts).toHaveLength(1);
    expect(JSON.stringify(bell)).not.toContain("Hackney");
  });

  it("withholds a record left with nothing that is about it", () => {
    expect(records.find((r: HistoricPub) => r.name === "The New Inn")).toBeUndefined();
  });

  it("says which borough disagreed with which, so the key can be split", () => {
    const conflicts = quarantined.filter(
      (q: { reason: string }) => q.reason === "borough-stated-in-fact",
    );
    expect(conflicts).toHaveLength(2);
    expect(conflicts[0].detail).toContain("Hackney");
    expect(conflicts[0].detail).toContain("Camden");
  });
});

// F07: a year in a cited sentence is not automatically the pub's own date. The
// index publishes the value, its precision, the TYPE of event it dates and a
// label naming that type; `era`, the field every "oldest first" ordering reads,
// carries the value only where the type is evidence of age.
describe("buildHistoricPublication — a date says what it is a date of", () => {
  const CACHE = {
    "the old bell": [
      {
        source: "wikipedia",
        address: "1 High Street",
        fact: "The Old Bell is a Grade II* listed pub named after the highwayman John Bell, who was hanged nearby in 1701.",
      },
    ],
    "the new inn": [
      { source: "wikipedia", address: "9 Green Lane", fact: "The New Inn is a coaching inn built in 1670." },
    ],
  };

  const records: HistoricPub[] = buildHistoricIndex({
    heritageCache: CACHE,
    dataset: FIXTURE_DATASET,
  });

  it("publishes the event year, labelled, and orders nothing by it", () => {
    const bell = byName(records, "The Old Bell");
    expect(bell.dateValue).toBe("1701");
    expect(bell.datePrecision).toBe("year");
    expect(bell.dateType).toBe("associated_event");
    expect(bell.dateLabel).toBe("Linked to 1701");
    expect(bell.era).toBeNull();
  });

  it("publishes a real age in era as well as in the typed fields", () => {
    const inn = byName(records, "The New Inn");
    expect(inn.dateType).toBe("construction");
    expect(inn.dateLabel).toBe("Built 1670");
    expect(inn.era).toBe("1670");
  });

  it("sorts the dated pub above the one whose only date is an event", () => {
    expect(records.map((r) => r.name)).toEqual(["The New Inn", "The Old Bell"]);
  });
});

describe("shared heritage names require one address, postcode or coordinate match", () => {
  const hammersmith = {
    pub_name: "Black Lion", address: "2 S Black Lion Ln, London W6 9TJ",
    latitude: 51.4905, longitude: -0.24209, primary_borough: "Hammersmith and Fulham",
  };
  const kilburn = {
    pub_name: "Black Lion", address: "274 Kilburn High Road, London NW6 2BY",
    latitude: 51.5438, longitude: -0.199868, primary_borough: "Brent",
  };
  const hammerFact = {
    source: "wikidata", fact: "pub in Hammersmith, London", address: "W6 9TJ",
    sourceRef: "https://en.wikipedia.org/wiki/Black_Lion,_Hammersmith",
  };
  const kilburnFact = {
    source: "wikidata", fact: "pub in Kilburn, London", address: "274 Kilburn High Road",
    sourceRef: "https://en.wikipedia.org/wiki/Black_Lion,_Kilburn",
  };

  it.each([[hammersmith, kilburn], [kilburn, hammersmith]])("separates Black Lion facts and sources in either dataset order", (...dataset) => {
    const records: HistoricPub[] = buildHistoricIndex({
      heritageCache: { "black lion": [kilburnFact, hammerFact] }, dataset,
    });
    expect(records).toHaveLength(2);
    expect(records.find((record) => record.borough === "Hammersmith and Fulham")?.facts).toEqual([
      { source: hammerFact.source, fact: hammerFact.fact, sourceRef: hammerFact.sourceRef },
    ]);
    expect(records.find((record) => record.borough === "Brent")?.facts).toEqual([
      { source: kilburnFact.source, fact: kilburnFact.fact, sourceRef: kilburnFact.sourceRef },
    ]);
  });

  it("withholds a postcode shared by two venues and facts without address evidence", () => {
    expect(buildHistoricIndex({
      heritageCache: { "black lion": [hammerFact, { source: "seed", fact: "A historic pub." }] },
      dataset: [hammersmith, { ...hammersmith, address: "4 Black Lion Lane, London W6 9TJ", latitude: 51.491 }],
    })).toEqual([]);
  });

  it.each([[hammersmith, kilburn], [kilburn, hammersmith]])("matches nearby namesakes and rejects swapped coordinates in either dataset order", (...dataset) => {
    const fact = { source: "wikidata", fact: "An old riverside public house.",
      sourceRef: "https://example.org/riverside", latitude: 51.4915, longitude: -0.24209 };
    const records: HistoricPub[] = buildHistoricIndex({
      heritageCache: { "black lion": [fact] }, dataset,
    });
    expect(records).toHaveLength(1);
    expect(records[0]?.venueId).toBe("venue-fudfew");
    expect(records[0]?.facts).toEqual([{ source: fact.source, fact: fact.fact, sourceRef: fact.sourceRef }]);
    expect(buildHistoricIndex({
      heritageCache: { "black lion": [{ ...fact, latitude: fact.longitude, longitude: fact.latitude }] },
      dataset,
    })).toEqual([]);
  });

  it.each([
    { latitude: 51.4925, longitude: -0.24209 },
    { latitude: null, longitude: null },
    { latitude: 151, longitude: -0.24209 },
  ])("withholds coordinates without a nearby namesake: %j", (coordinates) => {
    expect(buildHistoricIndex({
      heritageCache: { "black lion": [{ source: "seed", fact: "An old public house.", ...coordinates }] },
      dataset: [hammersmith, kilburn],
    })).toEqual([]);
  });

  it("withholds coordinates within 150 metres of two namesakes", () => {
    expect(buildHistoricIndex({
      heritageCache: { "black lion": [{ source: "seed", fact: "An old public house.",
        latitude: hammersmith.latitude, longitude: hammersmith.longitude }] },
      dataset: [hammersmith, { ...hammersmith, address: "4 Black Lion Lane", latitude: 51.491 }],
    })).toEqual([]);
  });

  it("retains a unique name without requiring address evidence", () => {
    const records = buildHistoricIndex({
      heritageCache: { "black lion": [{ source: "wikidata", fact: "pub in Hammersmith, London" }] },
      dataset: [hammersmith],
    });
    expect(records[0]?.facts).toEqual([{ source: "wikidata", fact: "pub in Hammersmith, London" }]);
  });

  it("retains facts from the same address-verified source", () => {
    const secondFact = { source: "seed", fact: "An old riverside public house.", sourceRef: hammerFact.sourceRef };
    const records: HistoricPub[] = buildHistoricIndex({
      heritageCache: { "black lion": [hammerFact, secondFact] }, dataset: [hammersmith, kilburn],
    });
    expect(records[0]?.facts).toEqual([
      { source: hammerFact.source, fact: hammerFact.fact, sourceRef: hammerFact.sourceRef }, secondFact,
    ]);
  });

  it("does not let a curated venue ID bypass namesake address evidence", () => {
    expect(buildHistoricIndex({
      heritageCache: { "black lion": [{ source: "seed", fact: "A historic pub." }] }, dataset: [hammersmith, kilburn],
      venueIdsByCacheKey: { "black lion": "venue-fudfew" },
    })).toEqual([]);
  });

  it("does not share evidence between different sources with identical text", () => {
    const records: HistoricPub[] = buildHistoricIndex({
      heritageCache: { "black lion": [hammerFact, {
        source: "seed", fact: hammerFact.fact, sourceRef: "https://example.org/unresolved",
      }] }, dataset: [hammersmith, kilburn],
    });
    expect(records[0]?.facts).toEqual([
      { source: hammerFact.source, fact: hammerFact.fact, sourceRef: hammerFact.sourceRef },
    ]);
  });

  it("withholds demolished Blackheath history from Camden and an unverified Blackheath row", () => {
    const cache = { "green man": [{ source: "wikidata",
      fact: "demolished pub in Blackheath, London, England",
      sourceRef: "https://en.wikipedia.org/wiki/Green_Man,_Blackheath",
    }] };
    expect(buildHistoricIndex({ heritageCache: cache, dataset: [
      { ...hammersmith, pub_name: "Green Man", address: "383 Euston Road, NW1 3AU", primary_borough: "Camden" },
      { ...kilburn, pub_name: "Green Man", address: "Greenwich, Greater London", primary_borough: "Greenwich" },
    ] })).toEqual([]);
  });
});
