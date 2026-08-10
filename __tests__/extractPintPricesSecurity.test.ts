import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("scripts/extract_pint_prices.py", "utf8");

describe("pint-price extractor XML boundary", () => {
  it("does not parse a fetched sitemap with the unsafe stdlib XML parser", () => {
    expect(source).not.toMatch(/from xml\.etree import ElementTree/);
    expect(source).not.toMatch(/ElementTree\.fromstring\(/);
  });
});
