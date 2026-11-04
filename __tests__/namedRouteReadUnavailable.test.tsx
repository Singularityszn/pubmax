import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/lib/venueDataset", () => ({ loadGroupedVenues: async () => [] }));

import NamedRoutePage, { dynamic, dynamicParams, generateStaticParams, revalidate } from "@/app/routes/[slug]/page";

// /routes/[slug] is a CDN-held document (proxy.ts, CDN_CACHED_DOCUMENT_ROUTES).
// A copy of empty stops would stand for the whole ISR window, so a dataset the
// page could not read throws and ISR keeps the last good copy.
describe("a named route page held by the CDN", () => {
  it("throws rather than cache a page built from an unreadable dataset", async () => {
    await expect(NamedRoutePage({ params: Promise.resolve({ slug: "victorian-soho" }) })).rejects.toThrow(
      /venue dataset unavailable/,
    );
  });

  it("prerenders exactly the four named routes for an hour", () => {
    expect(dynamic).toBe("force-static");
    expect(revalidate).toBe(3600);
    expect(dynamicParams).toBe(false);
    expect(generateStaticParams().map(({ slug }) => slug)).toEqual([
      "victorian-soho",
      "camden-market",
      "borough-market",
      "fleet-street",
    ]);
  });
});
