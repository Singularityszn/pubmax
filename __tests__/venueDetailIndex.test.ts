import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  clearVenueDetailEntriesForTests,
  getManifestReadAttemptsForTests,
  getVenueDetail,
  isVenueDetailId,
  resetVenueDetailCachesForTests,
  setVenueDetailIndexFileForTests,
  setVenueDetailRowsFileForTests,
  venueFromDetailArtifact,
  type VenueDetailArtifact,
} from "@/lib/venueDetailIndex";
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

const rows = JSON.parse(readFileSync(RAW_PATH, "utf8")) as VenuePrice[];
const seedRows = rows.filter(
  (row) => stableVenueIdFromKey(venueGroupingKey(row)) === SEED_VENUE_ID,
);

beforeAll(() => {
  if (!existsSync(DETAIL_INDEX)) {
    execFileSync("node", [BUILD_SLIM_SCRIPT], { cwd: ROOT });
  }
});

beforeEach(() => {
  resetVenueDetailCachesForTests();
});

afterEach(() => {
  resetVenueDetailCachesForTests();
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
  });

  it("does not cache missing venue ids permanently", async () => {
    await expect(getVenueDetail("venue-does-not-exist")).resolves.toBeNull();
    const venue = await getVenueDetail(SEED_VENUE_ID);
    expect(venue?.id).toBe(SEED_VENUE_ID);
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

  it("synthesizes non-London detail from the city slim pack when no artifact exists", async () => {
    const venue = await getVenueDetail("venue-oxf-16404bl");
    expect(venue?.id).toBe("venue-oxf-16404bl");
    expect(venue?.name).toBeTruthy();
    expect(venue?.prices).toEqual([]);
  });
});
