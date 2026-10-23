import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LONDON_BOROUGH_CLASSIFIER_VERSION } from "@/lib/londonBoroughPoint.mjs";
import type { ArchivedPintIndexSnapshot } from "@/lib/pintIndexArchive";
import type { PintIndexSnapshot } from "@/lib/pintIndex";

// F10 of the public QA pass: both Pint Index pages offered "Download the CSV"
// while the file held the header row only, which reads as a broken export. A
// page with no borough rows now offers no download, and a page with rows still
// does. The CSV routes themselves keep answering, so an old citation resolves.

const state = vi.hoisted(() => ({
  live: null as unknown as PintIndexSnapshot,
  edition: null as unknown as ArchivedPintIndexSnapshot,
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return {
    ...actual,
    useRouter: () => ({
      back: () => undefined,
      forward: () => undefined,
      refresh: () => undefined,
      push: () => undefined,
      replace: () => undefined,
      prefetch: () => Promise.resolve(),
    }),
  };
});
vi.mock("@/lib/pintIndexSnapshot.server", () => ({
  loadPublicPintIndexSnapshotOrThrow: async () => state.live,
  loadPintIndexArchive: async () => [state.edition],
  loadArchivedPintIndexMonth: async () => state.edition,
  listPintIndexArchiveMonths: async () => ["2026-06"],
}));

import PintIndexPage from "@/app/pint-index/page";
import PintIndexEditionPage from "@/app/pint-index/[month]/page";

const base: PintIndexSnapshot = {
  schemaVersion: 1,
  snapshotId: "test-v1",
  status: "published",
  generatedAt: "2026-07-16T12:00:00.000Z",
  observationWindow: { start: "2026-06-01T00:00:00.000Z", end: "2026-06-15T23:59:59.000Z" },
  classification: {
    version: LONDON_BOROUGH_CLASSIFIER_VERSION,
    method: "point_in_polygon",
    sourceArtifact: "data/london_boroughs_simplified.json",
    licence: "OGL v3",
  },
  sources: [
    {
      id: "community-1",
      kind: "confirmed_pint_drop",
      publisher: "PUBMAXX contributor",
      sourceUrl: "https://pubmaxxing.com/evidence/1",
      licence: null,
      confirmationId: "drop-confirmation-1",
      reviewState: "confirmed",
    },
  ],
  observations: [
    { venueId: "a", pubName: "Cheap A", boroughCode: "hackney", boroughName: "Hackney", pricePence: 500, observedAt: "2026-06-10T12:00:00.000Z", sourceId: "community-1" },
    { venueId: "b", pubName: "Posh", boroughCode: "westminster", boroughName: "Westminster", pricePence: 850, observedAt: "2026-06-12T12:00:00.000Z", sourceId: "community-1" },
  ],
  excluded: [],
};

const archive = (snapshot: PintIndexSnapshot): ArchivedPintIndexSnapshot => ({
  ...snapshot,
  archive: {
    month: "2026-06",
    revision: 1,
    publishedAt: "2026-07-01T00:00:00.000Z",
    sourceSnapshotId: "test-v1",
    observationsSha256: "0".repeat(64),
    corrections: [],
  },
});

const empty: PintIndexSnapshot = { ...base, observationWindow: null, observations: [], sources: [] };

async function live(): Promise<string> {
  return renderToStaticMarkup(await PintIndexPage());
}

async function edition(): Promise<string> {
  const page = await PintIndexEditionPage({ params: Promise.resolve({ month: "2026-06" }) });
  return renderToStaticMarkup(page);
}

describe("the Pint Index download door", () => {
  beforeEach(() => {
    state.live = empty;
    state.edition = archive(empty);
  });

  it("offers no CSV on the live page while there are no rows to publish", async () => {
    const html = await live();
    expect(html).not.toContain("Download the CSV");
    expect(html).not.toContain("Download current data");
    expect(html).not.toContain("/pint-index/data.csv");
  });

  it("offers the CSV on the live page once there are rows", async () => {
    state.live = base;
    const html = await live();
    expect(html).toContain("Download the CSV");
    expect(html).toContain("Download current data (CSV)");
    expect(html).toContain('href="/pint-index/data.csv"');
  });

  it("offers no CSV on an edition that published no rows, in the page or its structured data", async () => {
    const html = await edition();
    expect(html).not.toContain("Download the CSV");
    expect(html).not.toContain("(CSV)");
    expect(html).not.toContain("2026-06/data.csv");
    expect(html).not.toContain("DataDownload");
  });

  it("offers the CSV on an edition with rows, in the page and its structured data", async () => {
    state.edition = archive(base);
    const html = await edition();
    expect(html).toContain("Download the CSV");
    expect(html).toContain("Download June 2026 (CSV)");
    expect(html).toContain("DataDownload");
  });
});
