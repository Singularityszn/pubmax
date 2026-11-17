import { comparablePint } from "./comparablePint.mjs";
import { isHttpUrl } from "./httpUrl.mjs";
import { priceRowReadDay } from "./priceReadDay.mjs";

export function applySlimListingPrices(slim, bundleRows, now = Date.now()) {
  const unpriced = new Map(slim.filter((row) => row.cheapestPrice === null).map((row) => [row.id, row]));
  for (const row of bundleRows) {
    const venue = unpriced.get(row?.venueId);
    if (!venue || row.lane !== "listing-site" || row.standing !== "listed" || row.category !== "beer") continue;
    if (typeof row.servingSize !== "string" || row.servingSize.toLowerCase() !== "pint") continue;
    if (typeof row.drinkLabel !== "string" || !row.drinkLabel.trim() || !isHttpUrl(row.sourceUrl)) continue;
    const price = {
      cheapestPrice: row.priceGbp,
      cheapestPint: row.drinkLabel,
      measure: "pint",
      priceSource: row.publisher,
      priceObservedAt: row.observedAt,
    };
    if (comparablePint(price, now) === null) continue;
    price.priceObservedAt = priceRowReadDay({ scraped_at_values: row.observedAt });
    if (venue.cheapestPrice === null || price.cheapestPrice < venue.cheapestPrice) Object.assign(venue, price);
  }
}

const PINT_URL_PREFIX = "https://www.pint-prices.com/pub/";
/** Repeated evidence is cell metadata. Each venue retains one exact observation. */
export function compactFairPintPayload(pins) {
  const dates = [...new Set(pins.flatMap((pin) => typeof pin.fairPint?.[2] === "string" ? [pin.fairPint[2]] : []))];
  const prefix = pins.filter((pin) => typeof pin.fairPint?.[1] === "string" && pin.fairPint[1].startsWith(PINT_URL_PREFIX)).length >= 2 ? PINT_URL_PREFIX : null;
  const rows = pins.map((pin) => {
    if (!pin.fairPint) return pin;
    const [pence, url, date] = pin.fairPint;
    if (typeof url !== "string" || typeof date !== "string") return pin;
    const row = { ...pin };
    let flags = 0;
    if (row.priceSource === "Pint Prices") { delete row.priceSource; flags |= 1; }
    if (row.priceObservedAt === date.slice(0, 10)) { delete row.priceObservedAt; flags |= 2; }
    delete row.fairPint;
    let encoded = url;
    const suffix = typeof row.name === "string" ? "/" + encodeURIComponent(row.name) : "";
    if (suffix && encoded.endsWith(suffix)) { encoded = encoded.slice(0, -suffix.length); flags |= 4; }
    if (prefix && encoded.startsWith(prefix) && !encoded.includes(" ")) encoded = "~" + encoded.slice(prefix.length).replaceAll("%20", " ");
    return { ...row, fp: [pence, encoded, dates.indexOf(date), ...(flags === 3 ? [] : [flags])] };
  });
  return { rows, ft: dates.map((date) => Date.parse(date)), ...(prefix ? { fu: prefix } : {}) };
}
const fairPintDates = new WeakMap();
export function expandFairPintPin(value, metadata) {
  if (!value || typeof value !== "object" || !("fp" in value) || !Array.isArray(value.fp)) return value;
  const { fp, ...row } = value;
  const [pence, encoded, index, flags = 3] = fp;
  const time = Array.isArray(metadata?.ft) && Number.isInteger(index) ? metadata.ft[index] : null;
  if (fp.length < 3 || fp.length > 4 || typeof encoded !== "string" || typeof time !== "number" || !Number.isFinite(time)
    || !Number.isInteger(flags) || flags < 0 || flags > 7) return row;
  let dates = fairPintDates.get(metadata);
  if (!dates) {
    dates = metadata.ft.map((value) => {
      if (typeof value !== "number" || !Number.isFinite(value)) return null;
      const stamp = new Date(value);
      return Number.isFinite(stamp.getTime()) ? stamp.toISOString() : null;
    });
    fairPintDates.set(metadata, dates);
  }
  const date = dates[index];
  if (typeof date !== "string") return row;
  let url = encoded;
  if (url.startsWith("~")) {
    if (typeof metadata?.fu !== "string") return row;
    url = metadata.fu + url.slice(1).replaceAll(" ", "%20");
  }
  if (flags & 4) {
    if (!("name" in row) || typeof row.name !== "string") return row;
    url += "/" + encodeURIComponent(row.name);
  }
  return { ...row, fairPint: [pence, url, date], ...(flags & 1 ? { priceSource: "Pint Prices" } : {}), ...(flags & 2 ? { priceObservedAt: date.slice(0, 10) } : {}) };
}
