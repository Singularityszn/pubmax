// AN EMPTY PINT INDEX IS NOT PROMOTED (captain decision D10, review amendment 2).
//
// `public/data/pint_index_snapshot.json` has carried `"status": "empty"` since
// 2026-07-16, and the site still advertised the Index: `/pint-index` sat in the
// sitemap at priority 0.8 and stayed indexable. The captain held both until a
// month carries the admission floor of confirmed pints in at least one borough.
//
// THE ROUTE STAYS LIVE, AND SO DO THE LINKS TO IT. Holding means the sitemap row
// and the `robots` index directive, never the route: `/pint-index` still answers
// with its honest empty, and a reader who follows a link from a borough page
// still gets the page. The floor itself is READ from the flywheel constant and
// never typed onto a surface.

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { SEED_BOROUGH_MONTHLY_TARGET } from "@/lib/boroughCoverageStatus";
import { validatePintIndexSnapshot, type PintIndexSnapshot } from "@/lib/pintIndex";
import { pintIndexMeetsAdmissionFloor } from "@/lib/pintIndexArchive";
import { LONDON_BOROUGH_CLASSIFIER_VERSION } from "@/lib/londonBoroughPoint.mjs";
import { defined } from "@/__tests__/helpers/defined";

/** A snapshot whose named boroughs carry the priced-pub counts given. */
function snapshotWith(boroughs: readonly [string, string, number][]): PintIndexSnapshot {
  const observations = boroughs.flatMap(([code, name, pubCount]) =>
    Array.from({ length: pubCount }, (_, offset) => ({
      venueId: `${code}-${offset}`,
      pubName: `${name} pub ${offset}`,
      boroughCode: code,
      boroughName: name as PintIndexSnapshot["observations"][number]["boroughName"],
      pricePence: 500 + offset,
      observedAt: "2026-07-10T12:00:00.000Z",
      sourceId: "community-1",
    })),
  );
  return {
    schemaVersion: 1,
    snapshotId: "admission-floor-fixture",
    status: observations.length === 0 ? "empty" : "published",
    generatedAt: "2026-07-16T00:00:00.000Z",
    observationWindow: observations.length === 0
      ? null
      : { start: "2026-07-01T00:00:00.000Z", end: "2026-07-31T23:59:59.000Z" },
    classification: {
      version: LONDON_BOROUGH_CLASSIFIER_VERSION,
      method: "point_in_polygon",
      sourceArtifact: "data/london_boroughs_simplified.json",
      licence: "Open Government Licence v3.0",
    },
    sources: [{
      id: "community-1",
      kind: "confirmed_pint_drop",
      publisher: "PUBMAXX contributor",
      sourceUrl: "https://pubmaxxing.com/evidence/1",
      licence: null,
      confirmationId: "drop-confirmation-1",
      reviewState: "confirmed",
    }],
    observations,
    excluded: [],
  };
}

const EMPTY_MONTH = snapshotWith([]);
const ONE_BOROUGH_AT_FLOOR = snapshotWith([
  ["hackney", "Hackney", SEED_BOROUGH_MONTHLY_TARGET],
  ["westminster", "Westminster", 1],
]);
const EVERY_BOROUGH_THIN = snapshotWith([
  ["hackney", "Hackney", SEED_BOROUGH_MONTHLY_TARGET - 1],
  ["westminster", "Westminster", 1],
]);

function withDates(snapshot: PintIndexSnapshot, dates: string[]): PintIndexSnapshot {
  const observations = snapshot.observations.map((row, index) => ({ ...row, observedAt: defined(dates[index]) }));
  const instants = dates.map((date) => new Date(date).toISOString()).sort();
  return {
    ...snapshot,
    generatedAt: "2026-09-12T00:00:00.000Z",
    observations,
    observationWindow: { start: defined(instants[0]), end: defined(instants[instants.length - 1]) },
  };
}

const CAMDEN_AT_FLOOR = snapshotWith([["camden", "Camden", SEED_BOROUGH_MONTHLY_TARGET]]);
const SPLIT_MONTHS = withDates(CAMDEN_AT_FLOOR, CAMDEN_AT_FLOOR.observations.map((_, index) =>
  index < SEED_BOROUGH_MONTHLY_TARGET / 2 ? "2026-08-31T12:00:00Z" : "2026-09-01T12:00:00Z",
));
const DUPLICATE_PUBS = {
  ...CAMDEN_AT_FLOOR,
  observations: CAMDEN_AT_FLOOR.observations.map((row, index) => ({
    ...row,
    venueId: `camden-${Math.floor(index / 2)}`,
  })),
};
const EARLIER_QUALIFYING_MONTH = withDates({
  ...CAMDEN_AT_FLOOR,
  observations: [...CAMDEN_AT_FLOOR.observations, ...CAMDEN_AT_FLOOR.observations.slice(0, 1)],
}, [...CAMDEN_AT_FLOOR.observations.map(() => "2026-08-15T12:00:00Z"), "2026-09-01T12:00:00Z"]);

const MONTH_CASES = [
  { name: "split months cannot pool their pubs", snapshot: SPLIT_MONTHS, promoted: false },
  { name: "repeat observations count each pub once", snapshot: DUPLICATE_PUBS, promoted: false },
  { name: "an earlier qualifying month survives a later observation of the same pub", snapshot: EARLIER_QUALIFYING_MONTH, promoted: true },
  {
    name: "offset dates belong to their UTC month, not their written month",
    snapshot: withDates(CAMDEN_AT_FLOOR, CAMDEN_AT_FLOOR.observations.map((_, index) =>
      index === 0 ? "2026-09-01T00:30:00+01:00" : "2026-09-01T12:00:00Z",
    )),
    promoted: false,
  },
  {
    name: "different written months can share one qualifying UTC month",
    snapshot: withDates(CAMDEN_AT_FLOOR, CAMDEN_AT_FLOOR.observations.map((_, index) =>
      index === 0 ? "2026-09-01T00:30:00+01:00" : "2026-08-31T12:00:00Z",
    )),
    promoted: true,
  },
];

describe("the Pint Index admission floor", () => {
  it("refuses an empty month", () => {
    expect(pintIndexMeetsAdmissionFloor(EMPTY_MONTH)).toBe(false);
  });

  it("refuses a month whose every borough sits below the floor", () => {
    expect(pintIndexMeetsAdmissionFloor(EVERY_BOROUGH_THIN)).toBe(false);
  });

  // Growth may only help: one confirmed drop landing in a thin borough must not
  // demote a month a mature borough already carries.
  it("admits a month once one borough reaches the floor, thin rows beside it", () => {
    expect(pintIndexMeetsAdmissionFloor(ONE_BOROUGH_AT_FLOOR)).toBe(true);
  });

  it.each(MONTH_CASES)("$name", ({ snapshot, promoted }) => {
    expect(validatePintIndexSnapshot(snapshot)).toMatchObject({ ok: true });
    expect(pintIndexMeetsAdmissionFloor(snapshot)).toBe(promoted);
  });
});

describe("/pint-index indexing while the Index is held", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/pintIndexSnapshot.server");
    vi.resetModules();
  });

  async function robotsFor(snapshot: PintIndexSnapshot) {
    vi.resetModules();
    vi.doMock("@/lib/pintIndexSnapshot.server", async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      loadPublicPintIndexSnapshotOrThrow: async () => snapshot,
    }));
    const { generateMetadata } = await import("@/app/pint-index/page");
    return (await generateMetadata()).robots;
  }

  it("tells a crawler not to index an empty month, while still following its links", async () => {
    expect(await robotsFor(EMPTY_MONTH)).toEqual({ index: false, follow: true });
  });

  it("indexes the hub again once a borough reaches the floor, with no code change", async () => {
    expect(await robotsFor(ONE_BOROUGH_AT_FLOOR)).toEqual({ index: true, follow: true });
  });

  it.each(MONTH_CASES)("metadata and sitemap: $name", async ({ snapshot, promoted }) => {
    expect(await robotsFor(snapshot)).toEqual({ index: promoted, follow: true });
    const { default: sitemap } = await import("@/app/sitemap");
    const urls = (await sitemap()).map((entry) => entry.url);
    expect(urls.includes("https://pubmaxxing.com/pint-index")).toBe(promoted);
  });
});

describe("/pint-index snapshot failure", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/pintIndexSnapshot.server");
    vi.doUnmock("@/lib/zonePintIndex.server");
    vi.doUnmock("@/lib/venueDataset");
    vi.resetModules();
  });

  it("rejects metadata and page rendering instead of publishing an empty page", async () => {
    vi.resetModules();
    const failure = new Error("Public Pint Index snapshot is unavailable");
    vi.doMock("@/lib/pintIndexSnapshot.server", () => ({
      loadPublicPintIndexSnapshotOrThrow: async () => { throw failure; },
      loadPintIndexArchive: async () => [],
    }));
    vi.doMock("@/lib/zonePintIndex.server", async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      loadZonePintIndex: async () => null,
    }));
    vi.doMock("@/lib/venueDataset", async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      loadGroupedVenues: async () => [],
    }));
    const { default: page, generateMetadata } = await import("@/app/pint-index/page");
    await expect(generateMetadata()).rejects.toBe(failure);
    await expect(page()).rejects.toBe(failure);
  });
});
