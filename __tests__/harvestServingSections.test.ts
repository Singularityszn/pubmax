import { describe, expect, it } from "vitest";

import { readChainPintPrices } from "@/lib/harvest/chainMenuPrices";
import { readVenueDrinkPrices } from "@/lib/harvest/ukPriceCrawl";

describe("beer serving section boundaries", () => {
  it.each(["Draught beer", "Draft beers", "Cask ales", "Keg beers"])("ends bottle context at %s", (heading) => {
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

  it.each(["bottle", "can", "330ml"])("retains an explicit %s restriction beside pint volume", (restriction) => {
    const reading = readVenueDrinkPrices(`Guinness ${restriction} 568ml £6.20`, "text");
    expect(reading.kept).toEqual([]);
    expect(reading.drops).toEqual(["bottled-measure-not-a-pint"]);
  });
});
