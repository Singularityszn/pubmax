import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { groupVenuePrices } from "../../lib/venues.ts";
import { namedLegacyPintPriceSource } from "../../lib/drinks.ts";
import { venueMapUrl } from "../../lib/venueMapUrl.ts";
import { priceBand } from "../../lib/priceBand.ts";
import { PRODUCTION_SITE_ORIGIN } from "../../lib/siteUrlConfig.mjs";

const DATASET = fileURLToPath(new URL("../../public/data/pint_prices_app_dataset.json", import.meta.url));

/** The primary_borough values the bundled dataset records, spelt exactly. */
export const LONDON_BOROUGHS = Object.freeze([
  "Barking and Dagenham", "Barnet", "Bexley", "Brent", "Bromley", "Camden", "City of London",
  "Croydon", "Ealing", "Enfield", "Greenwich", "Hackney", "Hammersmith and Fulham", "Haringey",
  "Harrow", "Havering", "Hillingdon", "Hounslow", "Islington", "Kensington and Chelsea",
  "Kingston upon Thames", "Lambeth", "Lewisham", "Merton", "Newham", "Redbridge",
  "Richmond upon Thames", "Southwark", "Sutton", "Tower Hamlets", "Waltham Forest", "Wandsworth",
  "Westminster",
]);

/** Only public venue and listed-price fields cross the MCP boundary. */
export function publicVenuesInArea(rows, area, limit = 12) {
  if (!Array.isArray(rows)) throw new TypeError("Choose public venue rows.");
  if (!LONDON_BOROUGHS.includes(area) || !Number.isInteger(limit) || limit < 1 || limit > 30) {
    throw new TypeError("Choose a listed London borough and a limit between 1 and 30.");
  }
  const usable = rows.filter((row) =>
    row && typeof row.pub_name === "string" && typeof row.address === "string" &&
    typeof row.primary_borough === "string" &&
    Number.isFinite(row.latitude) && row.latitude >= -90 && row.latitude <= 90 &&
    Number.isFinite(row.longitude) && row.longitude >= -180 && row.longitude <= 180,
  );
  return groupVenuePrices(usable)
    .filter((venue) => venue.primaryBorough === area)
    .map((venue) => ({
      id: venue.id,
      name: venue.name,
      area: venue.primaryBorough,
      latitude: venue.latitude,
      longitude: venue.longitude,
      href: new URL(venueMapUrl(venue.id), PRODUCTION_SITE_ORIGIN).href,
      prices: venue.prices
        .filter((price) => Number.isFinite(price.price_gbp) && price.price_gbp > 0)
        .slice(0, 3)
        .map((price) => ({
          drink: price.pint_name || "Pint",
          priceGbp: price.price_gbp,
          band: priceBand(price.price_gbp, { city: "london" }),
          publisher: namedLegacyPintPriceSource(price),
        })),
    }))
    .sort((a, b) => (a.prices[0]?.priceGbp ?? Infinity) - (b.prices[0]?.priceGbp ?? Infinity) || a.name.localeCompare(b.name, "en-GB"))
    .slice(0, limit);
}

export async function loadPublicVenues(area, limit) {
  const rows = JSON.parse(await readFile(DATASET, "utf8"));
  if (!Array.isArray(rows)) throw new TypeError("Public venue dataset is unavailable.");
  return {
    area,
    venues: publicVenuesInArea(rows, area, limit),
    priceNotice: "Listed pint prices. Prices can change. Price dates aren't recorded.",
  };
}
