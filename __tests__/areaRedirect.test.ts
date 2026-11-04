import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({
  permanentRedirect: (href: string) => { throw new Error(`redirect:${href}`); },
  notFound: () => { throw new Error("not-found"); },
}));

async function visit(slug: string) {
  const { default: AreaPage } = await import("@/app/area/[slug]/page");
  return AreaPage({ params: Promise.resolve({ slug }) });
}

describe("area links", () => {
  it("renders an area that clears the area floor instead of redirecting", async () => {
    await expect(visit("piccadilly-soho")).resolves.toBeTruthy();
  });
  it("sends a known alias of a published area to that area's own page", async () => {
    await expect(visit("soho")).rejects.toThrow("redirect:/area/piccadilly-soho");
  });
  it("redirects an area below the floor to its map area", async () => {
    await expect(visit("barnes")).rejects.toThrow("redirect:/map?area=barnes");
  });
  it("refuses unknown area names", async () => {
    await expect(visit("not-a-real-area")).rejects.toThrow("not-found");
  });
});
