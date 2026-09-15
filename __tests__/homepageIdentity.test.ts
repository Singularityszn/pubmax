import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const face = () => ({ className: "font-mock", variable: "--font-mock" });
  return {
    Space_Grotesk: face,
    Inter: face,
    JetBrains_Mono: face,
  };
});

import { SITE_JSON_LD } from "@/app/layout";

const landingSource = readFileSync(
  join(process.cwd(), "components/landing/LandingPage.tsx"),
  "utf8",
);

const organization = SITE_JSON_LD.find(
  (entry) => entry["@type"] === "Organization",
);

describe("homepage identity", () => {
  it("publishes the founder and only the verified public identity links", () => {
    expect(organization).toMatchObject({
      founder: {
        "@type": "Person",
        name: "Karan Manoharan",
        url: "https://x.com/karansznx",
      },
      sameAs: [
        "https://x.com/karansznx",
        "https://github.com/karanmrn",
      ],
    });
  });

  it("credits the founder in the landing footer", () => {
    expect(landingSource).toContain(
      "© 2026 PUBMAXX / Karan Manoharan",
    );
  });
});
