import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  permanentRedirect: (href: string) => { throw new Error(`redirect:${href}`); },
  notFound: () => { throw new Error("not-found"); },
}));

async function visit(slug: string) {
  const { default: AreaPage } = await import("@/app/area/[slug]/page");
  return AreaPage({ params: Promise.resolve({ slug }) });
}

describe("area links", () => {
  it("redirects a known London area to its map without publishing another landing page", async () => {
    await expect(visit("clapham")).rejects.toThrow("redirect:/map?area=clapham");
  });
  it("resolves the known Soho alias to its canonical map area", async () => {
    await expect(visit("soho")).rejects.toThrow("redirect:/map?area=piccadilly-soho");
  });
  it("refuses unknown area names", async () => {
    await expect(visit("not-a-real-area")).rejects.toThrow("not-found");
  });
});
