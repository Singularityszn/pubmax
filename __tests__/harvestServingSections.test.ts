import { describe, expect, it } from "vitest";

import { readChainPintPrices } from "@/lib/harvest/chainMenuPrices";
import { readVenueDrinkPrices } from "@/lib/harvest/ukPriceCrawl";

describe("beer serving section boundaries", () => {
  it.each([
    "Draught beer", "Draft beers", "Cask ales", "Keg beers", "On tap", "oN tAp",
    "Draught beer & cider", "DRAFT BEERS AND CIDERS", "Cask ales / keg lagers",
    "Beers & ciders on tap", "On tap (pint)", "Draught beers (568ml)",
  ])("ends bottle context at %s", (heading) => {
    for (const drink of ["Guinness", "Guinness pint"]) {
      for (const format of ["html", "text"] as const) {
        const body = format === "html"
          ? `<p>Bottled beers</p><p>Peroni 330ml £5.20</p><h2>${heading}</h2><p>${drink} £6.20</p>`
          : `Bottled beers\nPeroni 330ml £5.20\n${heading}\n${drink} £6.20`;
        const reading = readVenueDrinkPrices(body, format);
        expect(reading.kept.map(({ drinkLabel, category, priceGbp }) => ({ drinkLabel, category, priceGbp }))).toEqual([
          { drinkLabel: drink, category: "beer", priceGbp: 6.2 },
        ]);
        expect(reading.drops).toEqual(["bottled-measure-not-a-pint"]);
        if (format === "html") {
          expect(readChainPintPrices(body).kept.map(({ drinkLabel, priceGbp }) => ({ drinkLabel, priceGbp }))).toEqual([
            { drinkLabel: drink, priceGbp: 6.2 },
          ]);
        }
      }
    }
  });

  it.each(["pint", "568ml"])("respects an explicit %s without admitting bottles, cans or halves", (measure) => {
    const body = `Bottled beers\nPeroni 330ml £5.20\nGuinness ${measure} £6.20\nMadri half pint £3.20\nNeck Oil can 440ml £6.80`;
    const reading = readVenueDrinkPrices(body, "text");
    expect(reading.kept.map(({ drinkLabel, category, priceGbp }) => ({ drinkLabel, category, priceGbp }))).toEqual([
      { drinkLabel: `Guinness ${measure}`, category: "beer", priceGbp: 6.2 },
    ]);
    expect(reading.drops).toEqual(["bottled-measure-not-a-pint", "half-measure-not-a-pint", "bottled-measure-not-a-pint"]);
  });

  it.each(["bottle", "can", "canned", "330ml"])("retains an explicit %s restriction beside pint volume", (restriction) => {
    const reading = readVenueDrinkPrices(`Guinness ${restriction} 568ml £6.20`, "text");
    expect(reading.kept).toEqual([]);
    expect(reading.drops).toEqual(["bottled-measure-not-a-pint"]);
  });

  it.each([
    "Bottles", "bOtTlEd BeErS", "Canned beers", "CANS AND BOTTLES", "Bottled beer / canned cider",
    "Bottles (330ml / 500ml)", "Beers canned", "Bottled beers and ciders",
    "Low ABV (440ml Cans)", "Low alcohol beers (bottles 330ml)", "Beers (cans 440ml)",
  ])("starts container context at %s", (heading) => {
    for (const format of ["text", "html"] as const) {
      const lines = ["On tap", "Guinness £6.20", heading, "Peroni lager £5.20"];
      const body = format === "html" ? lines.map((line) => `<p>${line}</p>`).join("") : lines.join("\n");
      const reading = readVenueDrinkPrices(body, format);
      expect(reading.kept.map(({ drinkLabel, category, priceGbp }) => ({ drinkLabel, category, priceGbp }))).toEqual([
        { drinkLabel: "Guinness", category: "beer", priceGbp: 6.2 },
      ]);
      expect(reading.drops).toEqual(["bottled-measure-not-a-pint"]);
      if (format === "html") {
        expect(readChainPintPrices(body).kept.map(({ drinkLabel, priceGbp }) => ({ drinkLabel, priceGbp }))).toEqual([
          { drinkLabel: "Guinness", priceGbp: 6.2 },
        ]);
      }
    }
  });

  it.each(["Guinness", "GUINNESS", "Neck Oil", "LOCAL FAVOURITES"])("does not treat the unpriced label %s as a section", (label) => {
    for (const format of ["text", "html"] as const) {
      const lines = ["Bottled beers", "Peroni 330ml £5.20", label, "stout £6.20", "On tap", "Madri pint £6.40"];
      const body = format === "html" ? lines.map((line) => `<p>${line}</p>`).join("") : lines.join("\n");
      const reading = readVenueDrinkPrices(body, format);
      expect(reading.kept.map(({ drinkLabel, category, priceGbp }) => ({ drinkLabel, category, priceGbp }))).toEqual([
        { drinkLabel: "Madri pint", category: "beer", priceGbp: 6.4 },
      ]);
      expect(reading.drops).toEqual(["bottled-measure-not-a-pint", "bottled-measure-not-a-pint"]);
      if (format === "html") {
        expect(readChainPintPrices(body).kept.map(({ drinkLabel, priceGbp }) => ({ drinkLabel, priceGbp }))).toEqual([
          { drinkLabel: "Madri pint", priceGbp: 6.4 },
        ]);
      }
    }
  });

  it.each(["Local favourites", "LOCAL FAVOURITES", "Guinness"])("inherits containers through the deeper HTML heading %s", (heading) => {
    const body = `<h2>Bottled beers</h2><p>Peroni 330ml £5.20</p><h3>${heading}</h3><p>Guinness £6.20</p><h3>On tap</h3><p>Madri £6.40</p><h4>Local favourites</h4><p>Neck Oil £6.80</p>`;
    const reading = readVenueDrinkPrices(body, "html");
    expect(reading.kept.map(({ drinkLabel, category, priceGbp }) => ({ drinkLabel, category, priceGbp }))).toEqual([
      { drinkLabel: "Madri", category: "beer", priceGbp: 6.4 },
      { drinkLabel: "Neck Oil", category: "beer", priceGbp: 6.8 },
    ]);
    expect(reading.drops).toEqual(["bottled-measure-not-a-pint", "bottled-measure-not-a-pint"]);
    expect(readChainPintPrices(body).kept.map(({ drinkLabel, priceGbp }) => ({ drinkLabel, priceGbp }))).toEqual([
      { drinkLabel: "Madri", priceGbp: 6.4 },
      { drinkLabel: "Neck Oil", priceGbp: 6.8 },
    ]);
  });

  it.each([1, 2])("ends the HTML container at a neutral level %s heading", (level) => {
    const body = `<h2>Bottled beers</h2><p>Peroni 330ml £5.20</p><h3>Local favourites</h3><p>Kernel stout £6.00</p><h${level}>Seasonal selection</h${level}><p>Guinness £6.20</p>`;
    const reading = readVenueDrinkPrices(body, "html");
    expect(reading.kept.map(({ drinkLabel, category, priceGbp }) => ({ drinkLabel, category, priceGbp }))).toEqual([
      { drinkLabel: "Guinness", category: "beer", priceGbp: 6.2 },
    ]);
    expect(reading.drops).toEqual(["bottled-measure-not-a-pint", "bottled-measure-not-a-pint"]);
    expect(readChainPintPrices(body).kept.map(({ drinkLabel, priceGbp }) => ({ drinkLabel, priceGbp }))).toEqual([
      { drinkLabel: "Guinness", priceGbp: 6.2 },
    ]);
  });

  it("restores the HTML container when a deeper draught section ends", () => {
    const body = "<h2>Bottled beers</h2><h3>On tap</h3><p>Guinness £6.20</p><h3>Local favourites</h3><p>Kernel stout £6.00</p><h2>On tap</h2><p>Madri can 440ml £6.40</p><p>Neck Oil half pint £3.40</p>";
    const reading = readVenueDrinkPrices(body, "html");
    expect(reading.kept.map(({ drinkLabel, category, priceGbp }) => ({ drinkLabel, category, priceGbp }))).toEqual([
      { drinkLabel: "Guinness", category: "beer", priceGbp: 6.2 },
    ]);
    expect(reading.drops).toEqual(["bottled-measure-not-a-pint", "bottled-measure-not-a-pint", "half-measure-not-a-pint"]);
    expect(readChainPintPrices(body).kept.map(({ drinkLabel, priceGbp }) => ({ drinkLabel, priceGbp }))).toEqual([
      { drinkLabel: "Guinness", priceGbp: 6.2 },
    ]);
  });
});
