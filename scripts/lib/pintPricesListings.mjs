// A pint-prices.com row belongs to the listing page it was read from.
//
// The venue canonicalizer rewrites a merged row's name, address and point to
// the canonical pub, but it never touches `pub_url`. So a row's display
// identity can name one listing while its price came from another: "Red Lion,
// 1 Eldon Street EC2M 7LS" and "Red Lion (Moorgate)" are two pint-prices pages
// at one point, and both now display as Red Lion (Moorgate). Only the row's
// own page says which listing states its price.

import {
  canonicalizeDataset,
  stableVenueIdFromKey,
  venueGroupingKey,
} from "./venueCanonicalization.mjs";

const LONDON = { latMin: 51.26, latMax: 51.72, lngMin: -0.55, lngMax: 0.3 };

/** "A, B" -> "a::b": the comparison every pint-prices identity uses. */
export function normaliseKey(...parts) {
  return parts.map((part) => String(part ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "")).join("::");
}

function decode(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** The listing a pint-prices `/pub/<address>/<name>` URL names, or null. */
export function listingFromPubUrl(value) {
  let url;
  try {
    url = new URL(String(value ?? "").trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host !== "pint-prices.com" && !host.endsWith(".pint-prices.com")) return null;
  const [, root, address, ...name] = url.pathname.split("/");
  if (root !== "pub" || !address || name.length === 0) return null;
  const decodedAddress = decode(address);
  const decodedName = decode(name.join("/"));
  if (!decodedAddress?.trim() || !decodedName?.trim()) return null;
  return { name: decodedName, address: decodedAddress };
}

/** The pint-prices listing this row's price was read from, or null. */
export function rowListing(row) {
  return listingFromPubUrl(row.pub_url) ?? listingFromPubUrl(row.constructed_pub_url);
}

/** Both pages a row may have been read from: its pub page and its map listing. */
function rowListings(row) {
  return [listingFromPubUrl(row.pub_url), listingFromPubUrl(row.constructed_pub_url)].filter(Boolean);
}

/** The observation key for this row's own listing and pint, or null. */
export function rowObservationKey(row) {
  const listing = rowListing(row);
  return listing ? normaliseKey(listing.name, listing.address, row.pint_name) : null;
}

function inLondon(listing) {
  return (
    listing.latitude >= LONDON.latMin &&
    listing.latitude <= LONDON.latMax &&
    listing.longitude >= LONDON.lngMin &&
    listing.longitude <= LONDON.lngMax
  );
}

function blankLike(template) {
  return Object.fromEntries(
    Object.entries(template).map(([key, value]) => [
      key,
      typeof value === "boolean" ? false : typeof value === "number" ? 0 : value === null ? null : "",
    ]),
  );
}

function priceText(value) {
  return `£${value.toFixed(2)}`;
}

/**
 * Attach the observed pints that no held row states to a venue the dataset
 * already holds, and never to a new one.
 *
 * A listing the dataset already reads takes the new pint under that listing's
 * own venue. A listing it does not read joins a venue only when the
 * canonicalizer's own same-pub rule (name, distance, postcode, verified
 * aliases) merges it into exactly one held venue. Everything else is returned
 * unmatched, with the reason, so a person can look at it. A venue that already
 * prices the pint, from any source, keeps its own row.
 *
 * `listings` is `Map<key, {name, address, latitude, longitude, url, pints: Map<pintKey, {pint, prices}>}>`,
 * where `url` is the pub page it was read from, or null for a borough map entry.
 * A pint stated at several prices takes the lowest, as the refresh does.
 */
export function attachMatchedListings(rows, listings, collectedAt) {
  const venueOf = (row) => stableVenueIdFromKey(venueGroupingKey(row));
  const heldPints = new Set();
  const rowsByListing = new Map();
  for (const row of rows) {
    for (const listing of rowListings(row)) {
      heldPints.add(normaliseKey(listing.name, listing.address, row.pint_name));
      const key = normaliseKey(listing.name, listing.address);
      if (!rowsByListing.has(key)) rowsByListing.set(key, row);
    }
  }

  // New rows take the shape of an exported pint-prices row, never the extra
  // fields of whichever lane the matched venue came from.
  const shape = rows.find((row) => rowListing(row)) ?? {};
  const unmatched = [];
  const pending = [];
  for (const [key, listing] of listings) {
    const pints = [...listing.pints.values()]
      .filter(({ pint }) => !heldPints.has(normaliseKey(listing.name, listing.address, pint)))
      .map(({ pint, prices }) => ({ pint, price: Math.min(...prices) }));
    if (pints.length === 0) continue;
    const miss = (reason) =>
      pints.forEach(({ pint, price }) => unmatched.push({ ...describe(listing), pint, price, reason }));
    if (!Number.isFinite(listing.latitude) || !Number.isFinite(listing.longitude)) miss("no-coordinates");
    else if (!inLondon(listing)) miss("outside-london");
    else pending.push({ key, listing, pints, heldRow: rowsByListing.get(key) ?? null });
  }

  // One canonicalizer pass decides every unheld listing at once. A probe row
  // carries the listing's own identity; when the pass merges it, the held rows
  // in its cluster name the venue it belongs to.
  const probes = pending
    .filter(({ heldRow }) => !heldRow)
    .map(({ listing }) => ({
      pub_name: listing.name,
      address: listing.address,
      latitude: listing.latitude,
      longitude: listing.longitude,
      source_datasets: "borough_embedded_map_data_raw",
    }));
  const merged = canonicalizeDataset([...rows, ...probes]).rows;
  const heldVenuesByMergedVenue = new Map();
  rows.forEach((row, index) => {
    const mergedVenue = venueOf(merged[index]);
    if (!heldVenuesByMergedVenue.has(mergedVenue)) heldVenuesByMergedVenue.set(mergedVenue, new Map());
    heldVenuesByMergedVenue.get(mergedVenue).set(venueOf(row), row);
  });

  const added = [];
  let nextId = rows.reduce((max, row) => {
    const n = Number(/^app_price_(\d+)$/.exec(String(row.app_price_id))?.[1]);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  let probeIndex = rows.length;
  for (const { listing, pints, heldRow } of pending) {
    let venueRow = heldRow;
    if (!venueRow) {
      const venues = heldVenuesByMergedVenue.get(venueOf(merged[probeIndex])) ?? new Map();
      probeIndex += 1;
      if (venues.size !== 1) {
        const reason = venues.size === 0 ? "no-matching-venue" : "matches-several-venues";
        pints.forEach(({ pint, price }) => unmatched.push({ ...describe(listing), pint, price, reason }));
        continue;
      }
      venueRow = [...venues.values()][0];
    }
    const venue = venueOf(venueRow);
    const venuePints = new Set(
      rows
        .filter((row) => venueOf(row) === venue && typeof row.price_gbp === "number")
        .map((row) => normaliseKey(row.pint_name)),
    );
    const url = listingUrl(listing);
    for (const { pint, price } of pints) {
      if (venuePints.has(normaliseKey(pint))) {
        unmatched.push({ ...describe(listing), pint, price, reason: "venue-already-prices-this-pint" });
        continue;
      }
      venuePints.add(normaliseKey(pint));
      nextId += 1;
      added.push({
        ...blankLike(shape),
        app_price_id: `app_price_${String(nextId).padStart(6, "0")}`,
        pub_name: venueRow.pub_name,
        address: venueRow.address,
        latitude: venueRow.latitude,
        longitude: venueRow.longitude,
        primary_borough: venueRow.primary_borough,
        locality: venueRow.locality ?? "",
        pint_name: pint,
        price_gbp: price,
        price_text: priceText(price),
        pub_url: url,
        constructed_pub_url: url,
        source_datasets: "borough_embedded_map_data_raw",
        source_row_count: 1,
        has_raw_embedded_map_row: true,
        data_quality_notes: "not_visible_in_borough_leaderboard|not_found_on_individual_pub_page_extract",
        scraped_at_values: collectedAt,
      });
    }
  }
  return { added, unmatched };
}

function describe(listing) {
  return {
    name: listing.name,
    address: listing.address,
    latitude: listing.latitude,
    longitude: listing.longitude,
    url: listingUrl(listing),
  };
}

/** The page a listing was read from, or the one its map entry links to. */
export function listingUrl(listing) {
  return (
    listing.url ??
    `https://www.pint-prices.com/pub/${encodeURIComponent(listing.address)}/${encodeURIComponent(listing.name)}`
  );
}
