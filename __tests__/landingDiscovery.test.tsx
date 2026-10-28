import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loadPublished = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("@/lib/drinkBrandLanding.server", () => ({
  loadDrinkBrandLandings: loadPublished,
}));

import LandingDiscoveryLinks from "@/components/landing/LandingDiscoveryLinks";
import { loadLandingDrinkLinks } from "@/lib/landingDiscovery.server";

describe("homepage public page links", () => {
  beforeEach(() => loadPublished.mockReset());

  it("offers the public hubs and only three links supplied by the publication loader", async () => {
    loadPublished.mockResolvedValue([
      { slug: "guinness", brandLabel: "Guinness", rows: [{ privateToLoader: true }] },
      { slug: "camden-hells", brandLabel: "Camden Hells" },
      { slug: "bud-light", brandLabel: "Bud Light" },
      { slug: "pravha", brandLabel: "Pravha" },
    ]);

    const drinks = await loadLandingDrinkLinks();
    expect(drinks).toEqual([
      { href: "/drink/guinness", label: "Guinness prices" },
      { href: "/drink/camden-hells", label: "Camden Hells prices" },
      { href: "/drink/bud-light", label: "Bud Light prices" },
    ]);
    const html = renderToStaticMarkup(createElement(LandingDiscoveryLinks, { drinks }));
    expect(html).toContain('href="/borough"');
    expect(html).toContain('href="/historic"');
    expect(html).toContain('href="/crawls"');
    expect(html).toContain('href="/drink/guinness"');
    expect(html).toContain('href="/drink/bud-light"');
    expect(html).not.toContain("/drink/pravha");
    expect(html).not.toContain("/area/");
    expect(html).not.toContain("privateToLoader");
  });

  it("keeps useful hub links when no drink page meets its publication floor", async () => {
    loadPublished.mockResolvedValue([]);
    const drinks = await loadLandingDrinkLinks();
    const html = renderToStaticMarkup(createElement(LandingDiscoveryLinks, { drinks }));
    expect(html).toContain('href="/borough"');
    expect(html).not.toContain("/drink/");
    expect(html).not.toContain("Listed pint prices by drink");
  });
});
