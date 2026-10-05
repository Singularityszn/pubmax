import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import DrinkMenu from "@/components/drinks/DrinkMenu";
import { isDemoDrinkProvenance } from "@/lib/drinks";
import { demoDrinkVenueIds } from "@/lib/drinkSeeds";
import { parseDrinkPriceUpdates } from "@/lib/drinkPriceUpdates";
import type { VenuePrice } from "@/lib/venues";
import { venueMenuForInspector } from "@/lib/venueMenu";
import { defined } from "@/__tests__/helpers/defined";

// #1427. A menu prints what a publisher or a drinker put on record. A seeded
// demo pour beside a real Pint Drop is the thing this file refuses, and the
// disclaimer that used to trail EVERY menu ("Demo items are seeded examples,
// not live prices.") went with the rows it was about: the claim belongs on the
// row's own Demo chip, not on a real price.
//
// The default here IS the production default, because vitest.setup.ts strips
// both demo flags: a case that wants a seeded row asks for one by name.

const DRINKS_FLAG = "NEXT_PUBLIC_DEMO_DRINKS";
const REMOVED_FOOTER_LINE = "Demo items are seeded examples, not live prices.";

const SHIPPED_DRINK_UPDATES = parseDrinkPriceUpdates(
  JSON.parse(
    readFileSync(
      join(process.cwd(), "public/data/drink_price_updates/latest.json"),
      "utf8",
    ),
  ) as unknown,
  Date.parse("2026-08-05T12:00:00.000Z"),
);

afterEach(() => {
  delete process.env[DRINKS_FLAG];
});

/** One real public Pint Drop on a pub that carries no other price. */
function pintDropPrice(): VenuePrice {
  return {
    app_price_id: "hatton-lager",
    pub_name: "The Sir Christopher Hatton",
    pint_name: "Lager",
    price_gbp: 4.5,
    price_text: "£4.50",
    address: "4 Leather Lane, EC1N 7RA",
    latitude: 51.5205,
    longitude: -0.1096,
    boroughs_visible: "",
    boroughs_raw_embedded_non_anomaly: "",
    boroughs_raw_embedded_site_anomaly: "",
    primary_borough: "",
    rank_visible_borough: "",
    estimated_average_price_text: "",
    pub_url: "",
    constructed_pub_url: "",
    borough_urls: "",
    phone_number: "",
    email: "",
    website: "",
    booking_link: "",
    image_url: "",
  } as VenuePrice;
}

function renderMenu(venueId: string, prices: VenuePrice[]): string {
  return renderToStaticMarkup(
    createElement(DrinkMenu, {
      drinks: venueMenuForInspector({ id: venueId, prices }, SHIPPED_DRINK_UPDATES),
      venueId,
    }),
  );
}

describe("production menus carry no demo drink", () => {
  it("renders one public Pint Drop with no demo row and no demo line", () => {
    const html = renderMenu("venue-hatton", [pintDropPrice()]);

    expect(html).toContain("Lager");
    expect(html).toContain("£4.50");
    expect(html).not.toContain(REMOVED_FOOTER_LINE);
    expect(html).not.toContain(">Demo<");
  });

  it("drops every seeded row from every venue that has a seeded menu", () => {
    expect(demoDrinkVenueIds.length).toBeGreaterThan(0);
    for (const venueId of demoDrinkVenueIds) {
      const menu = venueMenuForInspector(
        { id: venueId, prices: [pintDropPrice()] },
        SHIPPED_DRINK_UPDATES,
      );
      expect(menu.filter((drink) => isDemoDrinkProvenance(drink.provenance))).toEqual(
        [],
      );
      expect(renderMenu(venueId, [pintDropPrice()])).not.toContain(">Demo<");
    }
  });

  it("no menu renders the removed demo footer line, seeded rows or not", () => {
    process.env[DRINKS_FLAG] = "on";
    const seededVenueId = demoDrinkVenueIds[0];
    const html = renderMenu(defined(seededVenueId), [pintDropPrice()]);

    // The opt-in path still labels each seeded row honestly.
    expect(html).toContain(">Demo<");
    expect(html).not.toContain(REMOVED_FOOTER_LINE);
  });

  it("the removed sentence is gone from the source, not merely unrendered", () => {
    const source = readFileSync(
      join(process.cwd(), "components/drinks/DrinkMenu.tsx"),
      "utf8",
    );
    // The comment above the footnote names the sentence; the rendered copy
    // must not.
    expect(source).not.toContain(`· ${REMOVED_FOOTER_LINE}`);
  });
});
