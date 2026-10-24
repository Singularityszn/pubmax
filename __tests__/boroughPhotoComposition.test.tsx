import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/borough/BoroughPassportSlice", () => ({ default: () => null }));

import BoroughPage from "@/app/borough/[slug]/page";

async function photograph(slug: string) {
  const document = new JSDOM(renderToStaticMarkup(
    await BoroughPage({ params: Promise.resolve({ slug }) }),
  )).window.document;
  return document.querySelector(".boroughPhoto");
}

describe("borough page photograph composition", () => {
  it("shows the founder's Southwark photograph with its place and credit", async () => {
    const photo = await photograph("southwark");
    expect(photo?.textContent).toContain("Southwark");
    expect(photo?.textContent).toContain("Photo: the PUBMAXX founder");
    const image = photo?.querySelector("img");
    expect(image?.getAttribute("src")).toBe("/landing/london-collage/southwark-shard-1280.webp");
    expect(image?.getAttribute("alt")).toBe("The Shard seen down a Southwark street under a mackerel sky, London");
    expect(image?.getAttribute("width")).toBe("1280");
    expect(image?.getAttribute("height")).toBe("1707");
    expect(image?.getAttribute("loading")).toBe("eager");
    expect(image?.getAttribute("fetchPriority")).toBe("high");
    for (const format of ["avif", "webp"]) {
      const source = photo?.querySelector(`source[type="image/${format}"]`);
      expect(source?.getAttribute("srcset")).toBe(
        `/landing/london-collage/southwark-shard-640.${format} 640w, /landing/london-collage/southwark-shard-1280.${format} 1280w`,
      );
      expect(source?.getAttribute("sizes")).toBe("(max-width: 1100px) 100vw, 1040px");
    }
  });

  it("keeps the licensed Camden photograph and its licence", async () => {
    const photo = await photograph("camden");
    expect(photo?.querySelector("img")?.getAttribute("src")).toBe("/landing/london/camden-lock-1280.webp");
    expect(photo?.textContent).toContain("Camden Lock");
    expect(photo?.querySelector('a[href*="creativecommons.org"]')).not.toBeNull();
  });

  it("names London on the city fallback for a borough without a photograph", async () => {
    const photo = await photograph("barnet");
    expect(photo?.getAttribute("data-photo-scope")).toBe("london");
    expect(photo?.textContent).toContain("London");
    expect(photo?.querySelector('a[href*="creativecommons.org"]')).not.toBeNull();
  });
});
