import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  mapMbplcSectionToCategory,
  parseMbplcMenuMarkdown,
  pubNameFromMbplcMarkdown,
} from "@/lib/mbplcMenuParser";

const probePath = join(process.cwd(), ".firecrawl/probes/nicholsons-thameside.md");

describe("mbplcMenuParser", () => {
  const markdown = readFileSync(probePath, "utf8");

  it("maps Nicholson's drink sections", () => {
    expect(mapMbplcSectionToCategory("Cask Ale, Craft Beer & Cider")).toBe("beer");
    expect(mapMbplcSectionToCategory("Gin")).toBe("gin");
    expect(mapMbplcSectionToCategory("Fever-Tree Mixers")).toBeNull();
  });

  it("extracts pub name from page heading", () => {
    expect(pubNameFromMbplcMarkdown(markdown)).toBe("The Old Thameside Inn");
  });

  it("parses bottled beer with bare decimal prices", () => {
    const drinks = parseMbplcMenuMarkdown(markdown);
    const corona = drinks.find((d) => d.drinkName === "Corona Extra");
    expect(corona).toMatchObject({ category: "beer", priceGbp: 7.5 });
  });

  it("parses gin spirits", () => {
    const drinks = parseMbplcMenuMarkdown(markdown);
    const tanqueray = drinks.find((d) => d.drinkName === "Tanqueray London Dry");
    expect(tanqueray).toMatchObject({ category: "gin", priceGbp: 6.7 });
  });

  it("skips mixer-only sections", () => {
    const drinks = parseMbplcMenuMarkdown(markdown);
    expect(drinks.some((d) => d.drinkName.includes("Tonic Water"))).toBe(false);
  });
});
