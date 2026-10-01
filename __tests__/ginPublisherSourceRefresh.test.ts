import { describe, expect, it } from "vitest";

import {
  pageStatesADrinksList,
  readVenueDrinkPrices,
} from "@/lib/harvest/ukPriceCrawl";
import source from "./fixtures/harvest/scolt-head-spirits-20261001.json";
import albion from "./fixtures/harvest/albion-gin-pdfjs-20261001.json";

// Root captured the publisher's actual PDF web text on the date in this fixture.
// This exercises the official text reader, not network permission or pdfjs layout.
const readSource = () => readVenueDrinkPrices(source.text, "text");

describe("Scolt Head captured publisher spirits", () => {
  it.each([
    ["58 House Gin", 4.5, "£4.5"],
    ["Bombay Sapphire", 4.8, "£4.8"],
    ["Tanqueray", 4.8, "£4.8"],
    ["Hendrick’s", 5.2, "£5.2"],
  ] as const)("keeps %s at its complete printed Gin amount", (name, priceGbp, verbatim) => {
    const row = readSource().kept.find((candidate) => candidate.drinkLabel?.includes(name));

    expect(row).toEqual(expect.objectContaining({ category: "gin", priceGbp, verbatim }));
  });

  it("keeps FreeGlider under its printed alcohol-free heading", () => {
    const row = readSource().kept.find((candidate) =>
      candidate.drinkLabel?.includes("Sipsmith FreeGlider Gin"),
    );

    expect(row).toEqual(expect.objectContaining({ category: "alcohol-free", priceGbp: 4, verbatim: "£4" }));
  });

  it("never files that alcohol-free item as an alcoholic Gin offer", () => {
    expect(readSource().kept.filter((row) => row.category === "gin").some((row) =>
      row.drinkLabel?.includes("Sipsmith FreeGlider Gin"),
    )).toBe(false);
  });

  it("leaves the alcoholic house Gin measure unknown because this source states none", () => {
    const row = readSource().kept.find((candidate) => candidate.drinkLabel?.includes("58 House Gin"));

    expect(row).toBeDefined();
    expect(row?.servingSize).toBeUndefined();
  });

  it("retains a drinks-list reading instead of accepting an empty extraction", () => {
    expect(pageStatesADrinksList(readSource())).toBe(true);
  });
});

// Unlike the Scolt comparison, this is exact official pdfjs text from saved bytes.
const readAlbion = () => readVenueDrinkPrices(albion.text, "text");

describe("Albion captured publisher Gin section", () => {
  it("keeps the named Gordons offer at its printed Gin amount", () => {
    const row = readAlbion().kept.find((candidate) => candidate.drinkLabel?.includes("GORDONS"));

    expect(row).toEqual(expect.objectContaining({
      category: "gin", priceGbp: 4, verbatim: "£4.00", drinkLabel: "GORDONS",
    }));
  });

  it("keeps the Gin section's source-stated 25ml serving", () => {
    const row = readAlbion().kept.find((candidate) => candidate.drinkLabel?.includes("GORDONS"));

    expect(row).toEqual(expect.objectContaining({ category: "gin", priceGbp: 4, servingSize: "25ml" }));
  });

  it("keeps Water £3.50 out of Gin offers", () => {
    const reading = readAlbion();
    const water = reading.kept.find((row) => row.drinkLabel?.includes("WATER"));

    expect(water).toEqual(expect.objectContaining({ priceGbp: 3.5 }));
    expect(water?.category).not.toBe("gin");
    expect(reading.kept.filter((row) => row.category === "gin" && row.priceGbp === 3.5)).toEqual([]);
  });

  it("does not carry the later Gin 25ml heading back onto Water", () => {
    const water = readAlbion().kept.find((row) => row.drinkLabel?.includes("WATER"));

    expect(water).toBeDefined();
    expect(water?.servingSize).not.toBe("25ml");
  });

  it("ends Gin scope at the next printed Whiskey heading", () => {
    const bells = readAlbion().kept.find((row) => row.drinkLabel?.includes("BELLS"));

    expect(bells).toEqual(expect.objectContaining({ category: "whisky", priceGbp: 4 }));
  });
});
