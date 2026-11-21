import { readFile } from "node:fs/promises";
import path from "node:path";
import { tsImport } from "tsx/esm/api";
import { comparablePint, isComparablePintServing } from "../../lib/comparablePint.mjs";
import { cityVenueIdForPub } from "../../lib/cityVenueId.mjs";
import { CITIES } from "../fetch_city_osm_pubs.mjs";
import { buildUkEstimateModel } from "./ukEstimateModel.mjs";
import { boroughNameForPoint } from "../../lib/londonBoroughPoint.mjs";
import { mergeOsmTwins } from "./ukBaseOsmTwins.mjs";

const { parseUkPriceBundleRows, bundlePricesForCategory } = await tsImport("../../lib/ukPriceBundle.ts", import.meta.url);
const { priceStandingFor } = await tsImport("../../lib/priceTier.ts", import.meta.url);

function baseId(osmId) {
  const [kind, id] = String(osmId ?? "").split("/");
  const prefix = { node: "n", way: "w", relation: "r" }[kind];
  return prefix && id ? `venue-uk-${prefix}${id}` : null;
}

export async function loadUkEstimateModel(root, input = {}) {
  const read = async (name) => JSON.parse(await readFile(path.join(root, name), "utf8"));
  const [bundle, manifest, london, uk, baselines, boundaries] = await Promise.all([
    input.bundleRows ?? read("public/data/uk_prices/rows.json"), input.computedAt ? { generatedAt: input.computedAt } : read("public/data/uk_prices/manifest.json"),
    read("public/data/venues_slim.json"), read("data/osm/uk/uk_osm_pubs.json"),
    read("public/data/price_estimates/baselines.json"), read("data/london_boroughs_simplified.json"),
  ]);
  const computedAt = manifest.generatedAt;
  if (!Number.isFinite(Date.parse(computedAt))) throw new Error("UK price bundle has no generation date");
  const now = Date.parse(computedAt);
  const venues = new Map();
  const osmForVenue = new Map();
  const ukByOsmId = new Map();
  const twinRows = (uk.pubs ?? []).flatMap((pub) => {
    const id = baseId(pub.osmId);
    return id && pub.name ? [[id.slice("venue-uk-".length), pub.name, pub.address ?? "", pub.lat, pub.lng, ""]] : [];
  });
  const { twins } = mergeOsmTwins(twinRows);
  const sampleId = (venue, fallback) => {
    const id = baseId(venue.osmId);
    if (!id) return fallback;
    const ref = id.slice("venue-uk-".length);
    return `venue-uk-${twins.get(ref) ?? ref}`;
  };
  for (const pub of uk.pubs ?? []) {
    ukByOsmId.set(pub.osmId, pub);
    const id = baseId(pub.osmId);
    if (id) venues.set(id, { ...pub, id });
    if (pub.curatedRef?.source === "curated-london-slim" && pub.curatedRef.id) {
      osmForVenue.set(pub.curatedRef.id, pub);
    }
  }
  for (const row of london.rows ?? []) {
    const osm = osmForVenue.get(row.id);
    venues.set(row.id, { id: row.id, osmId: osm?.osmId, lat: row.lat, lng: row.lng, locality: osm?.locality ?? row.borough, postcode: osm?.postcode });
  }
  for (const city of Object.values(CITIES).filter((entry) => entry.enabled)) {
    const pack = await read(`data/cities/${city.id}/osm_pubs.json`);
    for (const pub of pack.pubs ?? []) {
      if (pub.kind && pub.kind !== "pub") continue;
      const id = cityVenueIdForPub(city.id, pub);
      const ukPub = ukByOsmId.get(pub.osmId);
      if (id) venues.set(id, { ...pub, locality: pub.locality ?? ukPub?.locality, postcode: pub.postcode ?? ukPub?.postcode, id });
    }
  }
  const rowsByVenue = new Map();
  for (const row of parseUkPriceBundleRows(bundle)) {
    if (row.standing !== "listed" || row.category !== "beer" || !venues.has(row.venueId)) continue;
    if (row.servingSize && row.servingSize.toLowerCase() !== "pint") continue;
    if (!isComparablePintServing({ cheapestPint: row.drinkLabel })) continue;
    const rows = rowsByVenue.get(row.venueId) ?? [];
    rows.push(row);
    rowsByVenue.set(row.venueId, rows);
  }
  const samples = [];
  const sampledIds = new Set();
  for (const [id, rows] of rowsByVenue) {
    const listed = bundlePricesForCategory(rows, "beer").listed;
    if (!listed || priceStandingFor({ listed }, now).standing !== "listed") continue;
    sampledIds.add(id);
    const venue = venues.get(id);
    samples.push({ ...venue, id: sampleId(venue, id), priceGbp: listed.priceGbp, observedAt: listed.observedAt });
  }
  for (const row of london.rows ?? []) {
    if (sampledIds.has(row.id)) continue;
    const price = comparablePint(row, now);
    if (price !== null) {
      const venue = venues.get(row.id);
      samples.push({ ...venue, id: sampleId(venue, row.id), priceGbp: price, observedAt: row.priceObservedAt });
    }
  }
  samples.sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt) || a.priceGbp - b.priceGbp);
  const estimateFromPrices = buildUkEstimateModel(samples);
  const boroughs = new Map((baselines.regions ?? []).filter((row) => row.kind === "london_borough" && row.sampleSize >= 3 && row.medianGbp >= 2 && row.medianGbp <= 12).map((row) => [row.label.toLowerCase(), row]));
  const estimateFor = (pub) => {
    if (pub.lat >= 51.2 && pub.lat <= 51.8 && pub.lng >= -0.6 && pub.lng <= 0.4) {
      const name = boroughNameForPoint(pub.lat, pub.lng, boundaries);
      const region = name ? boroughs.get(name.toLowerCase()) : null;
      if (region && Number.isFinite(Date.parse(baselines.computedAt))) return { priceGbp: region.medianGbp, basis: "regional_baseline", sampleSize: region.sampleSize, detail: name, computedAt: baselines.computedAt };
    }
    const estimate = estimateFromPrices(pub);
    return estimate ? { ...estimate, computedAt } : null;
  };
  return { estimateFor, computedAt };
}
