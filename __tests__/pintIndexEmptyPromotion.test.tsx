// @vitest-environment jsdom

// AN EMPTY PINT INDEX IS NOT PROMOTED (captain decision D10, review amendment 2).
//
// `public/data/pint_index_snapshot.json` has carried `"status": "empty"` since
// 2026-07-16, and the site still advertised the Index twice: `/pint-index` sat
// in the sitemap at priority 0.8, and the map's zone picker mounted the "Zone
// pint index" strip beside its chips. The captain held both until a month
// carries the admission floor of confirmed pints per borough.
//
// THE ROUTE STAYS LIVE. Hiding means the sitemap row and the strip, never the
// route: `/pint-index` still answers with its honest empty, and a reader who
// holds the URL still gets the page. The floor itself is READ from
// `lib/pintIndex.ts` and never typed onto a surface.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ZonePicker from "@/components/map/ZonePicker";
import { SEED_BOROUGH_MONTHLY_TARGET } from "@/lib/boroughCoverageStatus";
import {
  PINT_INDEX_BOROUGH_ADMISSION_FLOOR,
  buildLeagueTable,
  pintIndexMeetsAdmissionFloor,
  type PintIndexSnapshot,
} from "@/lib/pintIndex";
import { LONDON_BOROUGH_CLASSIFIER_VERSION } from "@/lib/londonBoroughPoint.mjs";
import { PINT_INDEX_SNAPSHOT_PUBLIC_PATH, resetPintIndexLeagueLoader } from "@/lib/pintIndexLeagueLoader";
import { computeZonePintIndex } from "@/lib/zones";

/** A snapshot carrying `pubsPerBorough` distinct priced pubs in each borough. */
function snapshotWith(pubsPerBorough: number, boroughs: readonly [string, string][]): PintIndexSnapshot {
  const observations = boroughs.flatMap(([code, name]) =>
    Array.from({ length: pubsPerBorough }, (_, offset) => ({
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

const AT_FLOOR: readonly [string, string][] = [
  ["hackney", "Hackney"],
  ["westminster", "Westminster"],
];

describe("the Pint Index admission floor", () => {
  it("reads the one per-borough figure the price flywheel already owns", () => {
    expect(PINT_INDEX_BOROUGH_ADMISSION_FLOOR).toBe(SEED_BOROUGH_MONTHLY_TARGET);
  });

  it("refuses an empty month", () => {
    expect(pintIndexMeetsAdmissionFloor(buildLeagueTable(snapshotWith(0, [])))).toBe(false);
  });

  it("refuses a month whose thinnest borough is one pub short", () => {
    const thin = snapshotWith(PINT_INDEX_BOROUGH_ADMISSION_FLOOR, AT_FLOOR);
    thin.observations = thin.observations.filter((row) => row.venueId !== "westminster-0");
    expect(pintIndexMeetsAdmissionFloor(buildLeagueTable(thin))).toBe(false);
  });

  it("admits a month at the floor in every borough it names", () => {
    const atFloor = snapshotWith(PINT_INDEX_BOROUGH_ADMISSION_FLOOR, AT_FLOOR);
    expect(pintIndexMeetsAdmissionFloor(buildLeagueTable(atFloor))).toBe(true);
  });
});

describe("the map zone picker while the Index is held", () => {
  let host: HTMLDivElement;
  let root: Root;

  const zoneIndex = computeZonePintIndex(
    Array.from({ length: 12 }, (_, offset) => ({
      kind: "pub" as const,
      zone: 1,
      cheapestPrice: 5 + offset / 10,
    })),
  );

  function serveSnapshot(snapshot: PintIndexSnapshot | null) {
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      if (String(input) !== PINT_INDEX_SNAPSHOT_PUBLIC_PATH) throw new Error(`unexpected fetch ${input}`);
      if (snapshot === null) return { ok: false, body: null } as unknown as Response;
      return { ok: true, json: async () => snapshot } as unknown as Response;
    }));
  }

  async function mountPicker() {
    await act(async () => {
      root.render(createElement(ZonePicker, {
        zone: "",
        onZoneChange: () => {},
        index: zoneIndex,
        variant: "inline" as const,
      }));
    });
  }

  beforeEach(() => {
    resetPintIndexLeagueLoader();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    resetPintIndexLeagueLoader();
  });

  it("mounts the chips but not the pint index strip while the month is empty", async () => {
    serveSnapshot(snapshotWith(0, []));
    await mountPicker();
    expect(host.querySelector(".zoneChips")).not.toBeNull();
    expect(host.querySelector(".zonePintIndex")).toBeNull();
  });

  it("mounts the strip again once a month reaches the floor, with no code change", async () => {
    serveSnapshot(snapshotWith(PINT_INDEX_BOROUGH_ADMISSION_FLOOR, AT_FLOOR));
    await mountPicker();
    expect(host.querySelector(".zonePintIndex")).not.toBeNull();
  });

  it("stays silent when the snapshot cannot be read", async () => {
    serveSnapshot(null);
    await mountPicker();
    expect(host.querySelector(".zonePintIndex")).toBeNull();
  });
});
