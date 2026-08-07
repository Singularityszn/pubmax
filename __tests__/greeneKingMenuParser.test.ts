import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  mapSectionToCategory,
  parseGreeneKingMenuMarkdown,
  slugFromMenuUrl,
  titleFromSlug,
} from "@/lib/greeneKingMenuParser";

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/menus/greene-king-sherlock-menu.md",
);

describe("mapSectionToCategory", () => {
  it("maps wine and cocktails", () => {
    expect(mapSectionToCategory("White Wine (10)")).toBe("wine");
    expect(mapSectionToCategory("Cocktails (9)")).toBe("cocktail");
  });

  it("skips food sections", () => {
    expect(mapSectionToCategory("main menu")).toBeNull();
  });
  it("maps coffee, soft drink, and alcohol-free sections", () => {
    expect(mapSectionToCategory("Coffee")).toBe("coffee");
    expect(mapSectionToCategory("Hot drinks")).toBe("coffee");
    expect(mapSectionToCategory("Soft Drinks (8)")).toBe("soft-drink");
    expect(mapSectionToCategory("Drinks")).toBe("soft-drink");
    expect(mapSectionToCategory("Alcohol-free")).toBe("alcohol-free");
    expect(mapSectionToCategory("No & Low")).toBe("alcohol-free");
  });
});

describe("parseGreeneKingMenuMarkdown", () => {
  it("extracts priced drinks from the Sherlock Holmes probe", () => {
    const md = readFileSync(FIXTURE, "utf8");
    const rows = parseGreeneKingMenuMarkdown(md);
    expect(rows.length).toBeGreaterThan(20);
    const margarita = rows.find((r) => r.drinkName === "Margarita");
    expect(margarita).toMatchObject({ category: "cocktail", priceGbp: 12.5 });
    const pinot = rows.find((r) => r.drinkName.includes("Pinot Grigio"));
    expect(pinot?.category).toBe("wine");
    expect(pinot?.priceGbp).toBe(7.2);
  });
});

describe("slug helpers", () => {
  it("parses menu URLs", () => {
    expect(
      slugFromMenuUrl(
        "https://www.greeneking.co.uk/pubs/greater-london/sherlock-holmes/menu",
      ),
    ).toBe("sherlock-holmes");
  });

  it("title-cases slugs", () => {
    expect(titleFromSlug("sherlock-holmes")).toBe("Sherlock Holmes");
  });
});
