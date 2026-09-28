import { execFileSync } from "node:child_process";
import { existsSync, promises as fs, readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearVenueDetailEntriesForTests,
  getManifestReadAttemptsForTests,
  getVenueDetail,
  isVenueDetailId,
  lookupVenueDetail,
  resetVenueDetailCachesForTests,
  setVenueDetailIndexFileForTests,
  setVenueDetailRowsFileForTests,
  venueFromDetailArtifact,
  type VenueDetailArtifact,
} from "@/lib/venueDetailIndex";
import {
  resetVenueAliasesForTests,
  setVenueAliasesPathForTests,
} from "@/lib/venueAliases";
import {
  stableVenueIdFromKey,
  venueGroupingKey,
  type VenuePrice,
} from "@/lib/venues";

const ROOT = path.resolve(__dirname, "..");
const BUILD_SLIM_SCRIPT = path.join(ROOT, "scripts", "build_slim_index.mjs");
const DETAIL_INDEX = path.join(ROOT, "data", "generated", "venue_detail_index.json");
const RAW_PATH = path.join(ROOT, "public", "data", "pint_prices_app_dataset.json");
const SEED_VENUE_ID = "venue-16pnwmm";
const FAMOUS_BAR_ID = "bar-american-bar-savoy";
const FIXTURE_RESTAURANT_ID = "restaurant-fixture-seed-fallback";
const SEED_FALLBACK_ROOT = path.join(
  ROOT,
  "__tests__",
  "fixtures",
  "famous_venues",
  "seed_fallback",
);

const rows = JSON.parse(readFileSync(RAW_PATH, "utf8")) as VenuePrice[];
const seedRows = rows.filter(
  (row) => stableVenueIdFromKey(venueGroupingKey(row)) === SEED_VENUE_ID,
);

vi.mock("@/lib/venueIndex", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/venueIndex")>();
  return {
    ...actual,
    lookupCanonicalVenue: async (id: string) => {
      if (id !== FIXTURE_RESTAURANT_ID) return actual.lookupCanonicalVenue(id);
      const slimVenue = {
        id,
        name: "Fixture Chop House",
        lat: 51.5108,
        lng: -0.1232,
        borough: "Westminster",
        kind: "restaurant" as const,
      };
      return { status: "found" as const, canonicalId: id, venue: slimVenue, slimVenue };
    },
  };
});

beforeAll(() => {
  if (!existsSync(DETAIL_INDEX)) {
    execFileSync("node", [BUILD_SLIM_SCRIPT], {
      cwd: ROOT,
      env: { ...process.env, DEPLOYMENT_VERSION: "local" },
    });
  }
});

beforeEach(() => {
  resetVenueDetailCachesForTests();
});

afterEach(() => {
  resetVenueDetailCachesForTests();
  resetVenueAliasesForTests();
  vi.unstubAllEnvs();
});

describe("venueDetailIndex", () => {
  it("rejects ids that cannot be generated venue ids", async () => {
    expect(isVenueDetailId("venue-16pnwmm")).toBe(true);
    expect(isVenueDetailId("venue-mcr-1lwo5lo")).toBe(true);
    expect(isVenueDetailId("venue-oxf-16404bl")).toBe(true);
    expect(isVenueDetailId("venue-glw-dsoj3p")).toBe(true);
    // Forward-compat: today's ids are ≤12 chars, but the regex allows up to 24
    // so a future id-generator bump doesn't need a code change here. 25 is out.
    expect(isVenueDetailId(`venue-${"a".repeat(24)}`)).toBe(true);
    expect(isVenueDetailId(`venue-${"a".repeat(25)}`)).toBe(false);
    expect(isVenueDetailId(FAMOUS_BAR_ID)).toBe(true);
    expect(isVenueDetailId("venue-mcr-")).toBe(false);
    expect(isVenueDetailId("../venue-16pnwmm")).toBe(false);
    expect(isVenueDetailId("venue-16pnwmm.json")).toBe(false);
    await expect(getVenueDetail("../venue-16pnwmm")).resolves.toBeNull();
  });

  it("hydrates story and anchor provenance for a famous venue artifact", () => {
    const seed = (
      JSON.parse(
        readFileSync(
          path.join(ROOT, "data", "famous_venues", "bars.json"),
          "utf8",
        ),
      ) as Array<
        NonNullable<VenueDetailArtifact["famous"]>["seed"]
      >
    ).find((row) => row.id === FAMOUS_BAR_ID)!;
    const slim: NonNullable<VenueDetailArtifact["famous"]>["slim"] = {
      id: seed.id,
      name: seed.name,
      lat: seed.lat,
      lng: seed.lng,
      cheapestPrice: seed.anchor.price,
      borough: seed.borough,
      kind: seed.kind,
    };

    const venue = venueFromDetailArtifact(
      { id: seed.id, famous: { seed, slim } },
      seed.id,
    );
    expect(venue).toMatchObject({
      id: FAMOUS_BAR_ID,
      description: seed.story.text,
      anchorLabel: seed.anchor.label,
      anchorObservedAt: seed.anchor.observedAt,
      anchorSourceUrl: seed.anchor.sourceUrl,
      storySourceUrl: seed.story.sourceUrl,
      hasStory: true,
    });
  });

  it("rejects artifacts whose id or grouped rows do not match the expected id", () => {
    expect(venueFromDetailArtifact({ id: "venue-other", rows: seedRows }, SEED_VENUE_ID)).toBeNull();
    expect(venueFromDetailArtifact({ id: SEED_VENUE_ID, rows: [] }, SEED_VENUE_ID)).toBeNull();
  });

  it("range-loads a full venue detail from the generated artifact", async () => {
    const venue = await getVenueDetail(SEED_VENUE_ID);
    expect(venue?.id).toBe(SEED_VENUE_ID);
    expect(venue?.prices.length).toBe(seedRows.length);
    expect(venue?.name).toBe(seedRows[0]?.pub_name);
  });

  it("loads restaurant detail from seed fallback without generated artifacts", async () => {
    // The seed fallback is deliberately non-production only (production serves
    // famous venues from the generated artifact). `npm run ci` runs this suite
    // inside Vercel's build, where NODE_ENV=production, so pin the runtime the
    // fallback belongs to instead of inheriting the ambient one.
    vi.stubEnv("NODE_ENV", "test");
    setVenueDetailIndexFileForTests(
      path.join(ROOT, "data", "generated", "missing-venue-detail-index.json"),
    );
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(SEED_FALLBACK_ROOT);

    try {
      await expect(getVenueDetail(FIXTURE_RESTAURANT_ID)).resolves.toMatchObject({
        id: FIXTURE_RESTAURANT_ID,
        name: "Fixture Chop House",
        kind: "restaurant",
        address: "1 Fixture Lane, London WC2E 7LB",
        anchorLabel: "Fixture Pie",
        anchorCourse: "mains",
        sourceDatasets: ["famous_venues"],
      });
    } finally {
      cwd.mockRestore();
    }
  });

  it("merges curated menu enrichment onto Prospect of Whitby detail", async () => {
    const venue = await getVenueDetail(SEED_VENUE_ID);
    expect(venue?.menuUrl).toBe(
      "https://www.greeneking.co.uk/pubs/greater-london/prospect-of-whitby/menu",
    );
    expect(venue?.orderUrl).toBeUndefined();
    expect(venue?.bookingLink).toMatch(/^https:\/\//);
  });

  it("degrades to null when the detail rows file cannot be opened", async () => {
    setVenueDetailRowsFileForTests(path.join(ROOT, "data", "generated", "missing-details.jsonl"));
    await expect(getVenueDetail(SEED_VENUE_ID)).resolves.toBeNull();
    await expect(lookupVenueDetail(SEED_VENUE_ID)).resolves.toEqual({ status: "unavailable" });
  });

  it("does not cache missing venue ids permanently", async () => {
    await expect(lookupVenueDetail("venue-does-not-exist")).resolves.toEqual({
      status: "missing",
    });
    await expect(getVenueDetail("venue-does-not-exist")).resolves.toBeNull();
    const venue = await getVenueDetail(SEED_VENUE_ID);
    expect(venue?.id).toBe(SEED_VENUE_ID);
  });

  it("does not call a failed alias lookup an unknown venue", async () => {
    setVenueAliasesPathForTests(
      path.join(ROOT, "data", "generated", "missing-venue-aliases.json"),
    );

    await expect(lookupVenueDetail(SEED_VENUE_ID)).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("retries a failed manifest read instead of caching null forever", async () => {
    setVenueDetailIndexFileForTests(
      path.join(ROOT, "data", "generated", "missing-venue-detail-index.json"),
    );
    await getVenueDetail(SEED_VENUE_ID);
    expect(getManifestReadAttemptsForTests()).toBe(1);

    // I/O failures leave the manifest cache unset, so the next call re-reads.
    clearVenueDetailEntriesForTests();
    await getVenueDetail(SEED_VENUE_ID);
    expect(getManifestReadAttemptsForTests()).toBe(2);
  });

  it("preserves the full city slim row when no detail artifact exists", async () => {
    const venue = await getVenueDetail("venue-bat-1vw6eb2");

    expect(venue).toMatchObject({
      id: "venue-bat-1vw6eb2",
      name: "The Raven",
      address: "6-7, queen street, bath, ba1 1he bath pie",
      hasStory: true,
      filterHints: {
        amenities: { food: true, beerGarden: true },
        curation: { hasStory: true },
      },
      prices: [],
    });
  });

  it("keeps venue detail readable when OSM enrichment is unavailable", async () => {
    const realRead = fs.readFile.bind(fs);
    vi.spyOn(fs, "readFile").mockImplementation(async (file, ...args) => {
      if (String(file).endsWith("cities/manchester/osm_pubs.json")) {
        throw new Error("missing Manchester OSM pack");
      }
      return realRead(file, ...(args as [BufferEncoding]));
    });

    await expect(getVenueDetail("venue-mcr-1lwo5lo")).resolves.toMatchObject({
      id: "venue-mcr-1lwo5lo",
      name: "Peveril of the Peak",
    });
  });
});
