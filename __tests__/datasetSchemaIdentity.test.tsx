import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { PintIndexSnapshot } from "@/lib/pintIndex";
import type { ArchivedPintIndexSnapshot } from "@/lib/pintIndexArchive";

const state = vi.hoisted(() => ({
  snapshot: null as unknown as PintIndexSnapshot,
  edition: null as unknown as ArchivedPintIndexSnapshot,
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-nonce": "dataset-request-nonce" }),
}));

vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));

vi.mock("@/lib/pintIndexSnapshot.server", () => ({
  loadPublicPintIndexSnapshotOrThrow: async () => state.snapshot,
  loadPintIndexArchive: async () => [],
  loadArchivedPintIndexMonth: async () => state.edition,
  listPintIndexArchiveMonths: async () => ["2026-06"],
}));

import PintIndexPage from "@/app/pint-index/page";
import PintIndexEditionPage from "@/app/pint-index/[month]/page";
import SpoonsValuePage from "@/app/spoons-value/page";
import { siteJsonLd } from "@/lib/siteJsonLd";

const snapshot: PintIndexSnapshot = {
  schemaVersion: 1,
  snapshotId: "schema-identity-fixture",
  status: "published",
  generatedAt: "2026-07-01T00:00:00.000Z",
  observationWindow: { start: "2026-06-01T00:00:00.000Z", end: "2026-06-30T23:59:59.000Z" },
  classification: { version: "test", method: "point_in_polygon", sourceArtifact: "test", licence: "test" },
  sources: [{
    id: "confirmation",
    kind: "confirmed_pint_drop",
    publisher: "PUBMAXX contributor",
    sourceUrl: "https://pubmaxxing.com/evidence/1",
    licence: null,
    confirmationId: "confirmation-1",
    reviewState: "confirmed",
  }],
  observations: [{
    venueId: "camden-pub",
    pubName: "Camden Pub",
    boroughCode: "camden",
    boroughName: "Camden",
    pricePence: 500,
    observedAt: "2026-06-10T00:00:00.000Z",
    sourceId: "confirmation",
  }],
  excluded: [],
};

function datasetFrom(html: string): Record<string, unknown> {
  const document = new JSDOM(html).window.document;
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  expect(scripts).toHaveLength(1);
  expect(scripts[0]?.getAttribute("nonce")).toBe("dataset-request-nonce");
  return JSON.parse(scripts[0]?.textContent ?? "null");
}

describe("dataset organization identity", () => {
  it("links the Spoons publisher to PUBMAXX while retaining the independent creator", async () => {
    const dataset = datasetFrom(renderToStaticMarkup(await SpoonsValuePage()));

    expect(dataset["@type"]).toBe("Dataset");
    expect(dataset.publisher).toEqual({ "@id": "https://pubmaxxing.com/#organization" });
    expect(dataset.creator).toEqual({ "@type": "Person", name: "Oliver Clegg" });
    expect(siteJsonLd.find((node) => node["@id"] === "https://pubmaxxing.com/#organization"))
      .toMatchObject({ "@type": "Organization", name: "PUBMAXX" });
  });

  it("links a populated live Pint Index creator to the shared organization", async () => {
    state.snapshot = snapshot;
    const dataset = datasetFrom(renderToStaticMarkup(await PintIndexPage()));

    expect(dataset["@type"]).toBe("Dataset");
    expect(dataset.creator).toEqual({ "@id": "https://pubmaxxing.com/#organization" });
    expect(dataset.distribution).toEqual([{
      "@type": "DataDownload",
      encodingFormat: "text/csv",
      contentUrl: "https://pubmaxxing.com/pint-index/data.csv",
    }]);
  });

  it.each([true, false])("links an archived Pint Index creator with published rows: %s", async (hasRows) => {
    state.edition = {
      ...snapshot,
      observations: hasRows ? snapshot.observations : [],
      observationWindow: hasRows ? snapshot.observationWindow : null,
      sources: hasRows ? snapshot.sources : [],
      archive: {
        month: "2026-06",
        revision: 1,
        publishedAt: "2026-07-01T00:00:00.000Z",
        sourceSnapshotId: snapshot.snapshotId,
        observationsSha256: "0".repeat(64),
        corrections: [],
      },
    };
    const page = await PintIndexEditionPage({ params: Promise.resolve({ month: "2026-06" }) });
    const dataset = datasetFrom(renderToStaticMarkup(page));

    expect(dataset["@type"]).toBe("Dataset");
    expect(dataset.creator).toEqual({ "@id": "https://pubmaxxing.com/#organization" });
    expect(dataset.datePublished).toBe("2026-07-01T00:00:00.000Z");
    expect(dataset.name).toBe("The London Pint Index, June 2026");
  });

  it("does not advertise a Dataset while the live Pint Index has no observations", async () => {
    state.snapshot = { ...snapshot, status: "empty", observations: [], sources: [], observationWindow: null };
    const document = new JSDOM(renderToStaticMarkup(await PintIndexPage())).window.document;

    expect(document.querySelector("main")).not.toBeNull();
    expect(document.querySelectorAll('script[type="application/ld+json"]')).toHaveLength(0);
  });
});
