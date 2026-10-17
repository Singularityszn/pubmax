import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  MIN_DISHES_FOR_MENU,
  foodMenuUrlsFrom,
  htmlLinks,
  isLikelyFoodMenuUrl,
  pageStatesAFoodMenu,
  readVenueFoodPrices,
} from "@/lib/harvest/ukFoodCrawl";

const FIXTURES = path.join(__dirname, "fixtures", "uk-food");
const fixture = (name: string) => readFileSync(path.join(FIXTURES, name), "utf8");
const dishes = (reading: ReturnType<typeof readVenueFoodPrices>) =>
  reading.kept.map((dish) => `${dish.category}|${dish.itemName}|${dish.priceGbp}`);

describe("readVenueFoodPrices: a served food menu", () => {
  const reading = readVenueFoodPrices(fixture("served-menu.html"), "html");

  it("keeps every dish the menu states, filed under the section it sits in", () => {
    expect(dishes(reading)).toEqual([
      "starters|Soup of the Day|6.5",
      "starters|Salt & Pepper Squid|8.95",
      "starters|Chicken Liver Parfait|7.95",
      "mains|Beer-Battered Haddock|17.5",
      "mains|Steak & Ale Pie|16.95",
      "mains|Wild Mushroom Risotto (v)|14.5",
      "mains|8oz Sirloin Steak|26",
      "burgers|Classic Beef Burger|15.5",
      "sides|Skin-on Fries|4.5",
      "sides|Onion Rings|4",
      "desserts|Sticky Toffee Pudding|7.5",
    ]);
    expect(pageStatesAFoodMenu(reading)).toBe(true);
  });

  it("names every figure it did not keep", () => {
    expect(reading.drops).toEqual({
      "offer-or-add-on": 2, // "Add peppercorn sauce £2.50", "Two courses for £22"
      "several-prices-on-line": 1, // "Small £6 / Large £10 Kids Burger"
      "duplicate-item": 1, // the second "Skin-on Fries £4.50"
      "drink-section": 3, // lager, pale ale and red wine under Drinks
    });
  });

  it("quotes the menu's own words, so a curator can check the row against the page", () => {
    const haddock = reading.kept.find((dish) => dish.itemName === "Beer-Battered Haddock");
    expect(haddock?.quote).toBe("Beer-Battered Haddock / Chunky chips, mushy peas, tartare sauce. / £17.50");
    for (const dish of reading.kept) {
      expect(dish.quote).toContain(dish.itemName);
      // The figure kept is the figure the quote states.
      const stated = [...dish.quote.matchAll(/£\s?(\d+(?:\.\d{2})?)/g)].map((match) => Number(match[1]));
      expect(stated, dish.itemName).toEqual([dish.priceGbp]);
    }
  });

  it("reads no figure out of a script, and none below an end-of-menu heading", () => {
    // The page carries "£99.00" in a script blob and "Treat someone £25" under
    // Gift Cards: neither is a dish.
    expect(reading.kept.some((dish) => dish.priceGbp === 99 || dish.priceGbp === 25)).toBe(false);
  });
});

describe("readVenueFoodPrices: a rendered (Browserbase) menu", () => {
  const reading = readVenueFoodPrices(fixture("rendered-menu.md"), "text");

  it("tells a dish written as a heading from a section heading", () => {
    expect(dishes(reading)).toEqual([
      "starters|Halloumi Fries|7.25",
      "starters|Pork Belly Bites|8.5",
      "starters|Garlic Flatbread|5.75",
      "mains|Fish & Chips|18.25",
      "mains|Bangers & Mash|16.5",
      "mains|Chicken & Mushroom Pie|17.75",
    ]);
  });

  it("leaves the wine list to the drink lanes", () => {
    expect(reading.drops["drink-section"]).toBe(2);
    expect(reading.drops["several-prices-on-line"]).toBe(1);
  });
});

describe("a page that is not a menu yields nothing", () => {
  it("a home page's promo figures fall below the menu floor", () => {
    const reading = readVenueFoodPrices(fixture("home.html"), "html");
    expect(reading.drops["offer-or-add-on"]).toBe(1); // "Sunday roast from £18.95"
    expect(reading.kept.length).toBeLessThan(MIN_DISHES_FOR_MENU);
    expect(pageStatesAFoodMenu(reading)).toBe(false);
  });

  it("a drinks list states no dish at all", () => {
    const reading = readVenueFoodPrices(fixture("drinks-only.html"), "html");
    expect(reading.kept).toEqual([]);
    expect(reading.drops["drink-section"]).toBe(6);
  });
});

describe("the line rules", () => {
  const one = (html: string) => readVenueFoodPrices(`<h2>Mains</h2><ul>${html}</ul>`, "html");

  it("drops a dish outside the food band rather than guessing", () => {
    expect(one("<li>Whole Lobster £85.00</li>").drops["outside-food-band"]).toBe(1);
    expect(one("<li>Bread Roll £0.50</li>").drops["outside-food-band"]).toBe(1);
  });

  it("drops a drink named under a food heading unless a plate word claims it", () => {
    expect(one("<li>Pint of House Lager £6.20</li>").drops["drink-line"]).toBe(1);
    expect(dishes(one("<li>Beer-Battered Cod £16.00</li>"))).toEqual(["mains|Beer-Battered Cod|16"]);
    expect(dishes(one("<li>Prawn Cocktail £8.00</li>"))).toEqual(["mains|Prawn Cocktail|8"]);
  });

  it("files a dish with no heading above it as other, and only when a plate word says it is food", () => {
    expect(dishes(readVenueFoodPrices("<p>Ploughman's Lunch £12.50</p>", "html"))).toEqual([
      "other|Ploughman's Lunch|12.5",
    ]);
    expect(readVenueFoodPrices("<p>Membership £12.50</p>", "html").drops["no-food-context"]).toBe(1);
  });

  it("refuses per-head and set-menu figures", () => {
    for (const line of ["Sunday Roast £24 per person", "Set menu £30", "Three courses £35", "Burger + £2 for cheese"]) {
      expect(one(`<li>${line}</li>`).drops["offer-or-add-on"], line).toBe(1);
    }
  });
});

describe("food-menu link discovery", () => {
  const origin = "https://www.example-arms.test";

  it("follows the pub's own food pages and nothing else", () => {
    expect(foodMenuUrlsFrom(htmlLinks(fixture("home.html")), origin)).toEqual([
      "https://www.example-arms.test/food/",
      "https://www.example-arms.test/menus/sunday-lunch.pdf",
    ]);
  });

  it("refuses another site, a drinks list, a set or seasonal menu and an image", () => {
    for (const url of [
      "https://www.deliveroo-example.test/menu/x",
      "/drinks-menu/",
      "/christmas-menu/",
      "/set-menu/",
      "/kids-menu/",
      "/food/menu.jpg",
    ]) {
      expect(isLikelyFoodMenuUrl(url, origin), url).toBe(false);
    }
    expect(isLikelyFoodMenuUrl("https://menus.example-arms.test/food", origin)).toBe(true);
  });
});
