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

import RootLayout from "@/app/layout";
import LandingPage from "@/components/landing/LandingPage";
import type { siteJsonLd } from "@/lib/siteJsonLd";

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
