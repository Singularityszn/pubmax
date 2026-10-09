import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

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

describe("venue status — curated closed and demolished pubs", () => {
  it("emits venueStatus only for named cache keys", () => {
    const cache = {
      "the colony room": [{ source: "seed", fact: "A Soho members' club." }],
      "the black cap": [{ source: "seed", fact: "A Camden landmark." }],
      "the sir george robey": [{ source: "seed", fact: "A Finsbury Park pub." }],
      "the old bell": [{ source: "seed", fact: "Still trading." }],
    };
    const records: HistoricPub[] = buildHistoricIndex({
      heritageCache: cache,
      dataset: [],
    });
    expect(byName(records, "The Colony Room").venueStatus).toBe("closed");
    expect(byName(records, "The Black Cap").venueStatus).toBe("closed");
    expect(byName(records, "The Sir George Robey").venueStatus).toBe("demolished");
    expect(byName(records, "The Old Bell").venueStatus).toBeUndefined();
  });
});

describe("slug — deterministic + unique with -2 collision suffix", () => {
  const records: HistoricPub[] = buildHistoricIndex({ heritageCache: FIXTURE_CACHE, dataset: FIXTURE_DATASET });

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

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("produces byte-identical output on two runs", async () => {
    writeFileSync(cachePath, JSON.stringify(FIXTURE_CACHE));
    writeFileSync(datasetPath, JSON.stringify(FIXTURE_DATASET));

    const a = await generate({ cachePath, datasetPath, outPath: outA });
    await generate({ cachePath, datasetPath, outPath: outB });

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


describe("venue joins survive a renamed or merged dataset row", () => {
  it("keeps the Black Friar heritage page joined to the canonical Blackfriar", () => {
    const records: HistoricPub[] = buildHistoricIndex({
      heritageCache: {
        "the black friar, blackfriars": [
          { source: "wikidata", fact: "pub in London, UK" },
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
      { source: "wikipedia", fact: "A galleried coaching inn rebuilt in 1677." },
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

  it("joins nothing when the curated id no longer resolves to a venue", () => {
    const records: HistoricPub[] = buildHistoricIndex({
      heritageCache: CACHE,
      dataset: RENAMED_DATASET,
      venueAliases: {},
      venueIdsByCacheKey: { "the george inn": MERGED_ID },
    });

    const george = byName(records, "The George Inn");
    expect(george.venueId).toBeNull();
    expect(george.borough).toBeNull();
  });

  it("keeps joining words lowercase in a name taken from the cache key", () => {
    expect(titleCase("owl and pussycat")).toBe("Owl and Pussycat");
    expect(titleCase("the george inn")).toBe("The George Inn");
  });
});

describe("the shipped historic index (generated artifact)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "historic-shipped-"));
  const outPath = path.join(dir, "historic_pubs.json");
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  // public/data/historic_pubs.json is generated output, so the file that ships
  // must be exactly what the generator produces from today's inputs. A stale
  // artifact is what carried three venue links to pubs the dataset had already
  // renamed or dropped.
  it("is exactly what the generator writes from the current sources", async () => {
    await generate({ outPath });
    expect(readFileSync(outPath, "utf8")).toBe(
      readFileSync("public/data/historic_pubs.json", "utf8"),
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

  // A heritage record with no venue id has no map link, no borough and no
  // place in the borough heritage counts. Exactly one record is allowed to be
  // in that state, and only because the pub is in neither the dataset nor the
  // alias map: the next dataset rename that drops a join fails here and has to
  // be answered with a VENUE_ID_BY_CACHE_KEY entry or an explicit acceptance.
  const RECORDS_WITH_NO_VENUE = ["the-barley-mow"];

  it("joins every historic record to a venue, save the ones named here", () => {
    const historic = JSON.parse(
      readFileSync("public/data/historic_pubs.json", "utf8"),
    ) as HistoricPub[];
    const unjoined = historic
      .filter((rec) => rec.venueId == null)
      .map((rec) => rec.slug);
    expect(unjoined.sort()).toEqual([...RECORDS_WITH_NO_VENUE].sort());

    for (const rec of historic) {
      if (rec.venueId == null) continue;
      expect(rec.borough, `${rec.slug} carries a borough`).toBeTruthy();
      expect(typeof rec.lat, `${rec.slug} carries a latitude`).toBe("number");
      expect(typeof rec.lng, `${rec.slug} carries a longitude`).toBe("number");
    }
  });

  it("drops no join the shipped index already holds", async () => {
    const regeneratedPath = path.join(dir, "historic_pubs_rejoin.json");
    await generate({ outPath: regeneratedPath });
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
      expect(rec, `a historic record for ${cacheKey}`).toBeTruthy();
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
      { source: "wikipedia", fact: "The Old Bell is a Grade II* listed pub rebuilt in 1670." },
      { source: "seed", fact: "A useful reference stop for the seeded heritage route." },
    ],
    // Nothing but an internal note: the record is withheld whole.
    "the new inn": [
      { source: "seed", fact: "Kept as a soft match until the exact pub is verified." },
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
      { source: "wikipedia", fact: "The Old Bell is a Grade II* listed pub rebuilt in 1670." },
      {
        source: "wikidata",
        fact: "pub in Hackney, London",
        sourceRef: "https://en.wikipedia.org/wiki/The_Old_Bell,_Hackney",
      },
    ],
    // Joined to the Hackney row, and its only fact is about a Camden pub.
    "the new inn": [{ source: "wikidata", fact: "pub in Camden, London" }],
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
        fact: "The Old Bell is a Grade II* listed pub named after the highwayman John Bell, who was hanged nearby in 1701.",
      },
    ],
    "the new inn": [
      { source: "wikipedia", fact: "The New Inn is a coaching inn built in 1670." },
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
