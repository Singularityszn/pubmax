import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { siteJsonLd } from "@/lib/siteJsonLd";

const layoutSource = readFileSync(
  join(process.cwd(), "app/layout.tsx"),
  "utf8",
);
const landingSource = readFileSync(
  join(process.cwd(), "components/landing/LandingPage.tsx"),
  "utf8",
);

describe("homepage identity", () => {
  it("publishes the founder and only the verified public identity links", () => {
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
      },
      sameAs: ["https://x.com/karansznx", "https://github.com/karanmrn"],
    });
    expect(layoutSource).toContain('import { siteJsonLd } from "@/lib/siteJsonLd"');
  });

  it("names PUBMAXX on the WebSite and Organization graph with the domain's spelling as an alternate", () => {
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
  });

  it("credits the founder in the landing footer", () => {
    expect(landingSource).toContain(
      "© 2026 PUBMAXX / Karan Manoharan",
    );
  });
});
