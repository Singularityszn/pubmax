import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CityPubsOnlyNoteLine } from "@/components/map/CityPubsOnlyNote";
import { CITY_PUBS_ONLY_NOTE, cityPubsOnlyNoteFor } from "@/lib/cityPubsOnlyNote";

describe("a city map outside London says what it is", () => {
  it("prints the line on each enabled city with limited coverage, and never on London", () => {
    expect(cityPubsOnlyNoteFor("london")).toBeNull();
    for (const cityId of [
      "manchester", "birmingham", "leeds", "liverpool", "oxford", "durham",
      "glasgow", "bristol", "cambridge", "bath", "llandudno",
    ]) {
      expect(cityPubsOnlyNoteFor(cityId), cityId).toEqual({
        text: "Few prices here yet.",
        linkLabel: "Tell us your city.",
        href: "/places",
      });
    }
  });

  it("describes sparse coverage and links to the city picker", () => {
    const html = renderToStaticMarkup(<CityPubsOnlyNoteLine note={CITY_PUBS_ONLY_NOTE} />);
    const text = html.replace(/<[^>]+>/g, "");
    expect(text).toBe("Few prices here yet. Tell us your city.");
    expect(html).toContain('href="/places"');
    expect(html).toContain('role="note"');
    expect(text).not.toMatch(/[!—]/u);
  });
});
