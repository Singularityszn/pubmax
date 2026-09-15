import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

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
    expect(layoutSource).toContain('name: "Karan Manoharan"');
    expect(layoutSource).toContain('url: "https://x.com/karansznx"');
    expect(layoutSource).toContain('"https://github.com/karanmrn"');
    expect(layoutSource).toMatch(
      /founder:\s*\{[\s\S]*?"@type": "Person"[\s\S]*?name: "Karan Manoharan"[\s\S]*?url: "https:\/\/x\.com\/karansznx"/,
    );
    expect(layoutSource).toMatch(
      /sameAs:\s*\[[\s\S]*?"https:\/\/x\.com\/karansznx",[\s\S]*?"https:\/\/github\.com\/karanmrn"/,
    );
  });

  it("credits the founder in the landing footer", () => {
    expect(landingSource).toContain(
      "© 2026 PUBMAXX / Karan Manoharan",
    );
  });
});
