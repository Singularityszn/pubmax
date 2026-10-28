// @vitest-environment jsdom

import { Children, createElement, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-nonce": "homepage-identity-nonce" }),
}));
vi.mock("next/font/google", () => ({
  Space_Grotesk: () => ({
    variable: "display",
    style: { fontFamily: "Display, Display Fallback" },
  }),
  Inter: () => ({
    variable: "body",
    style: { fontFamily: "Body, Body Fallback" },
  }),
}));
vi.mock("next/font/local", () => ({ default: () => ({ variable: "mono" }) }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ prefetch: () => Promise.resolve() }),
}));
vi.mock("@/components/nav/SiteNav", () => ({
  default: () => null,
  SiteNavActions: () => null,
}));
vi.mock("@/lib/landingPubCard.server", () => ({
  loadLandingHeroData: async () => ({
    card: null, archive: {}, rail: [], averages: null,
    priceReadLine: null, collagePrices: {},
  }),
}));
vi.mock("@/lib/landingAnswers.server", () => ({
  loadLandingAnswers: async () => null,
}));
vi.mock("@/lib/trustedHandoffFlags.server", () => ({
  readTrustedHandoffFlag: () => false,
}));

import RootLayout from "@/app/layout";
import Home from "@/app/page";
import LandingPage from "@/components/landing/LandingPage";
import type { siteJsonLd } from "@/lib/siteJsonLd";
import { SITE_PRODUCT_DESCRIPTION } from "@/lib/siteProductCopy";

async function renderedIdentity(): Promise<typeof siteJsonLd> {
  const layout = await RootLayout({ children: createElement("main") });
  const head = Children.toArray(layout.props.children).find(
    (child) => isValidElement(child) && child.type === "head",
  );
  expect(head).toBeDefined();
  const document = new DOMParser().parseFromString(
    renderToStaticMarkup(head),
    "text/html",
  );
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  expect(scripts).toHaveLength(1);
  const script = scripts.item(0);
  expect(script.getAttribute("nonce")).toBe("homepage-identity-nonce");
  return JSON.parse(script.textContent ?? "") as typeof siteJsonLd;
}

describe("homepage identity", () => {
  it("describes the free web app on its homepage and connects its publisher", async () => {
    const document = new DOMParser().parseFromString(
      renderToStaticMarkup(await Home()),
      "text/html",
    );
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    expect(scripts).toHaveLength(1);
    const graph = JSON.parse(scripts.item(0).textContent ?? "");
    const application = graph.find((node: Record<string, unknown>) => node["@type"] === "WebApplication");
    const page = graph.find((node: Record<string, unknown>) => node["@type"] === "WebPage");
    expect(application).toMatchObject({
      "@id": "https://pubmaxxing.com/#app",
      name: "PUBMAXX",
      url: "https://pubmaxxing.com",
      applicationCategory: "LifestyleApplication",
      isAccessibleForFree: true,
      inLanguage: "en-GB",
      publisher: { "@id": "https://pubmaxxing.com/#organization" },
      offers: { "@type": "Offer", price: 0, priceCurrency: "GBP" },
    });
    expect(application.description).toBe(SITE_PRODUCT_DESCRIPTION);
    expect(application.alternateName).toContain("PubMaxxing");
    expect(application).not.toHaveProperty("aggregateRating");
    expect(application).not.toHaveProperty("review");
    expect(page).toMatchObject({
      "@id": "https://pubmaxxing.com/#webpage",
      isPartOf: { "@id": "https://pubmaxxing.com/#website" },
      mainEntity: { "@id": application["@id"] },
    });
    expect(document.body.textContent).toContain("Free to use.");
    expect(document.body.textContent).toContain("Find a London pub, compare listed pint prices and plan your night.");
  });

  it("assigns personal identity links to the founder instead of the organization", async () => {
    const siteJsonLd = await renderedIdentity();
    const organization = siteJsonLd.find(
      (node) => node["@type"] === "Organization",
    );
    expect(organization).toBeDefined();
    expect(organization).toMatchObject({
      name: "PUBMAXX",
      founder: {
        "@type": "Person",
        name: "Karan Manoharan",
        url: "https://x.com/karansznx",
        sameAs: ["https://x.com/karansznx", "https://github.com/karanmrn"],
      },
    });
    expect(organization).not.toHaveProperty("sameAs");
  });

  it("names PUBMAXX on the WebSite and Organization graph with the domain's spelling as an alternate", async () => {
    const siteJsonLd = await renderedIdentity();
    expect(siteJsonLd).toHaveLength(2);
    const website = siteJsonLd.find((node) => node["@type"] === "WebSite");
    expect(website?.name).toBe("PUBMAXX");
    expect(website?.description).toBe(SITE_PRODUCT_DESCRIPTION);
    expect(website?.description).toContain("planning crawls with friends and sharing routes");
    expect(website?.alternateName).toContain("PubMaxxing");
    expect(website?.alternateName).not.toContain("PUBMAXX");
    expect(website?.url).toBe("https://pubmaxxing.com");
    const organization = siteJsonLd.find(
      (node) => node["@type"] === "Organization",
    );
    expect(organization?.logo).toBe("https://pubmaxxing.com/brand/icon-512.png");
    expect(organization?.alternateName).toContain("PubMaxxing");
    expect(organization?.["@id"]).toBe("https://pubmaxxing.com/#organization");
    expect(website?.["@id"]).toBe("https://pubmaxxing.com/#website");
    expect(website?.publisher).toEqual({ "@id": organization?.["@id"] });
  });

  it("credits the founder in the landing footer", () => {
    const document = new DOMParser().parseFromString(
      renderToStaticMarkup(createElement(LandingPage)),
      "text/html",
    );
    expect(document.querySelector("footer .lpFooterCredit")?.textContent).toBe(
      "© 2026 PUBMAXX / Karan Manoharan",
    );
  });
});
