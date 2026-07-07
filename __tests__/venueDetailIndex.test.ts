import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getVenueDetail,
  isVenueDetailId,
  resetVenueDetailCachesForTests,
  venueFromDetailArtifact,
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
  vi.restoreAllMocks();
  resetVenueDetailCachesForTests();
});

describe("venueDetailIndex", () => {
  it("rejects ids that cannot be generated venue ids", async () => {
    expect(isVenueDetailId("venue-16pnwmm")).toBe(true);
    expect(isVenueDetailId(`venue-${"a".repeat(13)}`)).toBe(false);
    expect(isVenueDetailId("../venue-16pnwmm")).toBe(false);
    expect(isVenueDetailId("venue-16pnwmm.json")).toBe(false);
    await expect(getVenueDetail("../venue-16pnwmm")).resolves.toBeNull();
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

  it("degrades to null when the detail rows file cannot be opened", async () => {
    vi.spyOn(fs, "open").mockRejectedValueOnce(new Error("missing detail artifact"));
    await expect(getVenueDetail(SEED_VENUE_ID)).resolves.toBeNull();
  });

  it("does not cache missing venue ids permanently", async () => {
    await expect(getVenueDetail("venue-does-not-exist")).resolves.toBeNull();
    const venue = await getVenueDetail(SEED_VENUE_ID);
    expect(venue?.id).toBe(SEED_VENUE_ID);
  });
});
