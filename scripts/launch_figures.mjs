#!/usr/bin/env node
// Print the live launch figures, read-only, from the same readers the site uses.
//
//   npm run launch:figures
//
// The launch kit (docs/growth/LAUNCH_KIT_2026-11-17.md) quotes these figures in
// its press release, its Product Hunt copy and its posts. They are recomputed
// here, never typed from memory, and this prints every one with its pub, its
// source and the day the source was read.
//
// The rules are not in this file. `lib/cheapestHunt.ts` decides what may win
// "cheapest" and "dearest" (a listed or confirmed price with a named publisher
// and a read day, never an estimate), and `lib/pricedPubCount.ts` owns the one
// answer to "how many London pubs have a pint price". This script only reads
// them and prints. It writes nothing and fetches nothing.
//
// Every figure is read from the committed packs (public/data), the same files
// the deployed build reads, so it needs no key. A price someone logs in the app
// is not one of them. The day matters as well as the commit: a confirmed price
// counts for 30 days and a listed one for 365 (lib/priceTier.ts), so a figure
// can age out between two runs of the same commit. Run it on the day you quote.

import process from "node:process";

import { loadCheapestHunt } from "../lib/cheapestHunt.server.ts";
import {
  HUNT_CITY_EMPTY_LINE,
  HUNT_CITY_UNNAMED_LINE,
  huntSourceVerb,
  londonHuntPints,
} from "../lib/cheapestHunt.ts";
import { pricedPubsSentence } from "../lib/pricedPubCount.ts";
import { loadPricedPubCount } from "../lib/pricedPubCount.server.ts";
import { ukPriceBundleRowsByVenue } from "../lib/ukPriceBundle.server.ts";
import { getPricedVenues } from "../lib/venuePriceIndex.ts";

const SITE_ORIGIN = "https://pubmaxxing.com";

function formatDay(isoDay) {
  return new Date(`${isoDay}T12:00:00.000Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/London",
  });
}

const samePrice = (left, right) => Math.abs(left - right) < 0.005;

/**
 * The drink the winning row names, and the address our list holds, so a line
 * quoting the figure can say what the drink is. Read from the same packs the
 * hunt read; this decides nothing.
 */
function rowDetailsFor(pint, venuesById, bundleByVenue) {
  if (pint.lane === "london-list") {
    const venue = venuesById.get(pint.venueId);
    const row = venue?.prices.find(
      (price) => typeof price.price_gbp === "number" && samePrice(price.price_gbp, pint.priceGbp) && price.pint_name,
    );
    return { drink: row?.pint_name ?? null, address: venue?.address ?? null };
  }
  const row = (bundleByVenue.get(pint.venueId) ?? []).find(
    (candidate) => candidate.category === "beer" && samePrice(candidate.priceGbp, pint.priceGbp) && candidate.drinkLabel,
  );
  return { drink: row?.drinkLabel ?? null, address: null };
}

function describePint(pint, details) {
  const { drink, address } = details(pint);
  return [
    `£${pint.priceGbp.toFixed(2)} at ${pint.pubName}, ${pint.placeName}.`,
    `Drink the source names: ${drink ?? "not named"}.${address ? ` Address in our list: ${address}.` : ""}`,
    `${huntSourceVerb(pint.standing)} ${pint.publisher.label} (${pint.publisher.url}), read ${formatDay(pint.observedOn)}.`,
    `Map: ${SITE_ORIGIN}${pint.mapHref}`,
  ].join("\n  ");
}

async function main() {
  const hunt = await loadCheapestHunt();
  if (hunt.cities.length === 0) {
    console.error("A hunt read is unavailable. Print no figure rather than an invented one.");
    process.exitCode = 1;
    return;
  }

  const [venues, bundle] = await Promise.all([getPricedVenues(), ukPriceBundleRowsByVenue()]);
  const venuesById = new Map(venues.map((venue) => [venue.id, venue]));
  const details = (pint) => rowDetailsFor(pint, venuesById, bundle.byVenue);
  const lines = [`Launch figures, computed ${new Date().toISOString()}`, ""];

  lines.push("Britain's cheapest pint (the hero card):");
  lines.push(hunt.britain ? `  ${describePint(hunt.britain, details)}` : "  No winner. The hero makes no claim.");
  if (hunt.britain) {
    // A tie is a fact a press line has to carry: the hero names ONE pub, by
    // the hunt's own order (price, freshest read, name, id), and every other
    // pub in our London pub list that stands in the hunt at the same price is
    // just as cheap. Counted over the London lane the hunt itself reads.
    const winner = hunt.britain;
    const tied = londonHuntPints(venues).filter((pint) => samePrice(pint.priceGbp, winner.priceGbp));
    lines.push(
      `  Pubs in our London pub list at £${winner.priceGbp.toFixed(2)} in the hunt: ${tied.length}. The hero names one by the tie-break (freshest read, then name, then id).`,
    );
  }
  lines.push("");

  lines.push("City by city:");
  for (const row of hunt.cities) {
    if (row.pint) {
      lines.push(`  ${row.cityName}: ${describePint(row.pint, details)}`);
    } else if (row.unnamedPricesHeld) {
      lines.push(`  ${row.cityName}: ${HUNT_CITY_UNNAMED_LINE}`);
    } else {
      lines.push(`  ${row.cityName}: ${HUNT_CITY_EMPTY_LINE}`);
    }
  }
  lines.push("");

  lines.push("London's dearest pint (a pub's cheapest pint, the dearest we hold):");
  lines.push(hunt.londonDearest ? `  ${describePint(hunt.londonDearest, details)}` : "  None held.");
  lines.push("");

  const priced = await loadPricedPubCount();
  lines.push(`Priced pubs: ${pricedPubsSentence(priced.count)}`);
  lines.push(`  Read status: ${priced.status}.`);

  console.log(lines.join("\n"));
}

await main();
