// Build runtime files and the freshness stamp from committed observations only. No network or new observation dates.
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { canonicalOsmId } from "../lib/harvestFold.ts";
import { PLACES_ENRICHMENT_STAMP, placesEnrichmentStamp } from "./lib/placesEnrichmentStamp.mjs";

const root = process.cwd();
const pack = JSON.parse(await readFile(path.join(root, "data/places_enrichment.json"), "utf8"));
if (pack.version !== 1 || !Array.isArray(pack.venues)) throw new Error("Invalid Places enrichment pack");
const records = [...pack.venues];
for (const name of ["uk_cities", "london_extras", "uk_cities_extras"]) {
  let extra;
  try { extra = JSON.parse(await readFile(path.join(root, `data/places_enrichment_${name}.json`), "utf8")); }
  catch (error) { if (error.code === "ENOENT") continue; throw error; }
  if (extra.version !== 1 || !Array.isArray(extra.venues)) throw new Error("Invalid Places enrichment pack");
  records.push(...extra.venues);
}
const grouped = new Map();
for (const row of records) {
  const key = typeof row?.venueId === "string" ? canonicalOsmId(row.venueId) : null;
  if (!key || typeof row.googlePlaceId !== "string" || !/^[A-Za-z0-9_-]{10,}$/.test(row.googlePlaceId)) {
    throw new Error("Invalid Places enrichment identity");
  }
  const existing = grouped.get(key) ?? [];
  const same = existing.find((entry) => entry.venueId === row.venueId && entry.googlePlaceId === row.googlePlaceId);
  if (!same) existing.push({ ...row });
  else {
    for (const [field, observation] of Object.entries(row)) {
      if (observation && typeof observation === "object" && observation.source === "google_places"
        && (!same[field] || Date.parse(observation.observedAt) > Date.parse(same[field].observedAt))) same[field] = observation;
    }
    if (Date.parse(row.observedAt) > Date.parse(same.observedAt)) same.observedAt = row.observedAt;
  }
  grouped.set(key, existing);
}
const directory = path.join(root, "data/generated/places_enrichment");
await mkdir(directory, { recursive: true });
for (const [key, rows] of grouped) {
  const file = path.join(directory, `${key.replace("/", "-")}.json`);
  await writeFile(`${file}.tmp`, `${JSON.stringify(rows)}\n`);
  await rename(`${file}.tmp`, file);
}
for (const name of await readdir(directory)) {
  if (/^(node|way|relation)-\d+\.json$/.test(name) && !grouped.has(name.slice(0, -5).replace("-", "/"))) await unlink(path.join(directory, name));
}
const stamp = path.join(root, PLACES_ENRICHMENT_STAMP);
await writeFile(`${stamp}.tmp`, `${JSON.stringify(placesEnrichmentStamp(pack), null, 2)}\n`);
await rename(`${stamp}.tmp`, stamp);
console.log(`Places enrichment runtime files: ${grouped.size} identities, ${records.length} records`);
