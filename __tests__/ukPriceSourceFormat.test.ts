import { describe, expect, it } from "vitest";
import { readVenueDrinkPrices } from "@/lib/harvest/ukPriceCrawl";

describe("HTML source wrapping keeps one printed item", () => {
  it.each([
    "<span>Espresso Martini\non draught £9.50</span>",
    "<td>Espresso Martini\non draught £9.50</td>",
    "<span>Espresso Martini</span>\n<span>on draught £9.50</span>",
    "<span>Espresso Martini</span>\non draught £9.50",
  ])("reads %s as the stated cocktail", (source) => {
    const reading = readVenueDrinkPrices(source, "html");
    expect(reading.drops).toEqual([]);
    expect(reading.kept).toEqual([
      expect.objectContaining({ category: "cocktail", priceGbp: 9.5, drinkLabel: "Espresso Martini on draught" }),
    ]);
  });

  it.each([
    ["\n", "<span>Menu updated today</span>", false],
    ["\r\n", "<body>Menu updated today</body>", false],
    ["\n", "<body>Menu updated today</body>", true],
  ])("preserves text menu boundaries (%j, %j, %j)", (newline, markup, header) => {
    const rows = ["Guinness Draught pint £6.10", "Negroni on tap £9.00", "Espresso Martini on draught £10.00", "Heineken 0.0% lager £5.00"];
    const source = (header ? [markup, ...rows] : [...rows, markup]).join(newline);
    const reading = readVenueDrinkPrices(source, "text");
    expect(reading.drops).toEqual([]);
    expect(reading.kept.filter((row) => row.category === "cocktail")).toEqual([
      expect.objectContaining({ priceGbp: 9, drinkLabel: "Negroni on tap" }),
      expect.objectContaining({ priceGbp: 10, drinkLabel: "Espresso Martini on draught" }),
    ]);
    expect(reading.kept.filter((row) => row.category === "beer" && row.priceGbp >= 9)).toEqual([]);
  });
});
