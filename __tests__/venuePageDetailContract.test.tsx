import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const read = vi.hoisted(() => vi.fn());
const store = vi.hoisted(() => ({ listVisible: vi.fn(async () => []), listLegacyForVenue: vi.fn(async () => []) }));
const requestHeaders = vi.hoisted(() => vi.fn(async () => new Headers()));
vi.mock("@/lib/venueDetailIndex", () => ({ lookupVenueDetail: read }));
vi.mock("@/lib/pintDropsStore", () => ({ memoryPintDropStore: store, supabasePintDropStore: store }));
vi.mock("next/headers", () => ({ headers: requestHeaders }));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("next/og", () => ({ ImageResponse: class {
  constructor(public element: ReactNode, public options: { headers?: Record<string, string> }) {}
} }));
vi.mock("@/lib/ogBrand", async (original) => ({ ...await original<object>(), loadOgFonts: () => [] }));

import BarTabPage, { generateMetadata as barMetadata } from "@/app/bar-tab/[id]/page";
import LedgerPage, { generateMetadata as ledgerMetadata } from "@/app/ledger/[id]/page";
import BarTabImage from "@/app/bar-tab/[id]/opengraph-image";
import { slimVenueToPin } from "@/lib/slimPins";
import type { VenueKind } from "@/lib/venues";

const venue = slimVenueToPin({ id: "restaurant-contract", name: "Named venue", lat: 51.5, lng: -0.1, cheapestPrice: 18, borough: "Westminster", kind: "restaurant" });
const props = { params: Promise.resolve({ id: "venue-alias" }) };
const routes = [
  { page: BarTabPage, metadata: barMetadata, missing: "on the tab", sibling: "/ledger/restaurant-contract" },
  { page: LedgerPage, metadata: ledgerMetadata, missing: "in the ledger", sibling: "/bar-tab/restaurant-contract" },
];
beforeEach(() => { vi.clearAllMocks(); read.mockReset(); });

describe.each(routes)("$missing detail contract", ({ page, metadata, missing, sibling }) => {
  it("renders empty-price details and keeps reads and links canonical", async () => {
    read.mockResolvedValue({ status: "found", venue });
    const html = renderToStaticMarkup(await page(props));
    expect(html).toContain("Named venue");
    expect(html).toContain(`href="${sibling}"`);
    expect(html).toContain("sel=restaurant-contract");
    expect(html).toContain("Photos of Named venue");
    expect(html).not.toContain("£18");
    expect(store.listVisible).toHaveBeenCalledWith(venue.id);
    if (page === LedgerPage) expect(store.listLegacyForVenue).toHaveBeenCalledWith(venue.id);
    expect(read).toHaveBeenCalledWith("venue-alias");
    const meta = await metadata(props);
    expect(String(meta.title)).toContain(venue.name);
    if (page === LedgerPage) expect(meta.alternates?.canonical).toBe(`/ledger/${venue.id}`);
  });

  it.each(["missing", "unavailable"] as const)("does not cache %s across page and metadata calls", async (status) => {
    read.mockResolvedValueOnce({ status }).mockResolvedValueOnce({ status }).mockResolvedValue({ status: "found", venue });
    const meta = await metadata(props);
    expect(meta.robots).toEqual({ index: false, follow: false });
    const html = renderToStaticMarkup(await page(props));
    expect(html).toContain(status === "missing" ? missing : "We could not load this pub");
    if (status === "unavailable") expect(html).not.toContain(missing);
    expect(requestHeaders).toHaveBeenCalled();
    expect(store.listVisible).not.toHaveBeenCalled();
    expect(store.listLegacyForVenue).not.toHaveBeenCalled();
    expect(renderToStaticMarkup(await page(props))).toContain(venue.name);
    expect(read).toHaveBeenCalledTimes(3);
  });
});

it.each([
  [undefined, "BarOrPub"], ["bar", "BarOrPub"], ["restaurant", "Restaurant"], ["food", "FoodEstablishment"], ["library", "Place"],
] as [VenueKind | undefined, string][])("uses %s venue kind for %s structured data", async (kind, schemaType) => {
  read.mockResolvedValue({ status: "found", venue: { ...venue, kind } });
  const html = renderToStaticMarkup(await LedgerPage(props));
  expect(html).toContain(`"@type":"${schemaType}"`);
});

it("uses canonical detail in the Bar Tab preview without promoting an anchor price", async () => {
  read.mockResolvedValue({ status: "found", venue });
  const image = await BarTabImage(props) as unknown as { element: ReactNode };
  const html = renderToStaticMarkup(image.element);
  expect(html).toContain(venue.name);
  expect(html).not.toContain("£18");
  expect(store.listVisible).toHaveBeenCalledWith(venue.id);
});

it.each(["missing", "unavailable"] as const)("does not cache a %s generic preview", async (status) => {
  read.mockResolvedValueOnce({ status }).mockResolvedValue({ status: "found", venue });
  const image = await BarTabImage(props) as unknown as { element: ReactNode; options: { headers: Record<string, string> } };
  expect(renderToStaticMarkup(image.element)).toContain("A London pub");
  expect(image.options.headers).toEqual({ "Cache-Control": "no-store" });
  expect(requestHeaders).toHaveBeenCalled();
  expect(store.listVisible).not.toHaveBeenCalled();
  const recovered = await BarTabImage(props) as unknown as { element: ReactNode };
  expect(renderToStaticMarkup(recovered.element)).toContain(venue.name);
  expect(read).toHaveBeenCalledTimes(2);
});
