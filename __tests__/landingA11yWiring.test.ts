import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string): string =>
  readFileSync(join(process.cwd(), file), "utf8");

describe("landing and city chooser accessibility wiring", () => {
  it("does not point to a search result that is not mounted", () => {
    const source = read("components/city/CityChooser.tsx");
    expect(source).toMatch(
      /aria-controls=\{\s*normalizedQuery\.length >= 2\s*\?\s*`\$\{listId\}-search-results`\s*:\s*undefined\s*\}/,
    );
  });

  it("keeps visible link text inside each accessible name", () => {
    const city = read("components/city/CityChooser.tsx");
    const hero = read("components/landing/ThamesHero.tsx");
    expect(city).toContain(
      'aria-label={`${city.displayName} ${city.tagline}. Open map.`}',
    );
    expect(hero).toContain(
      'aria-label={`${categoryLabel(pub.category)} ${pub.place} ${pub.price}. Open on the map`}',
    );
  });

  it("uses canonical PUBMAXX wording for landing wordmarks", () => {
    expect(read("components/landing/LandingPage.tsx")).not.toContain(
      'aria-label="PUBMAXXING home"',
    );
  });
});
