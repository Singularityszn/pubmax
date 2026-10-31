import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({
  permanentRedirect: (href: string) => { throw new Error(`redirect:${href}`); },
  notFound: () => { throw new Error("not-found"); },
}));

describe("the area page is prerendered", () => {
  it("is force-static on the hourly window and renders no unlisted name", async () => {
    const page = await import("@/app/area/[slug]/page");
    expect(page.dynamic).toBe("force-static");
    expect(page.revalidate).toBe(3600);
    expect(page.dynamicParams).toBe(false);
  });

  it("lists every name it answers, published or redirected, and no unknown one", async () => {
    const { generateStaticParams } = await import("@/app/area/[slug]/page");
    const slugs = generateStaticParams().map(({ slug }) => slug);
    expect(slugs).toEqual(expect.arrayContaining(["piccadilly-soho", "soho", "barnes", "clapham"]));
    expect(slugs).not.toContain("not-a-real-area");
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("throws on an empty dataset read rather than caching a redirect", async () => {
    vi.resetModules();
    vi.doMock("@/lib/pintPriceLandingDataset.server", () => ({
      loadPintPriceLandingVenues: async () => [],
    }));
    const { default: AreaPage } = await import("@/app/area/[slug]/page");
    await expect(AreaPage({ params: Promise.resolve({ slug: "piccadilly-soho" }) })).rejects.toThrow(
      "venue dataset unavailable",
    );
    vi.doUnmock("@/lib/pintPriceLandingDataset.server");
  });
});
