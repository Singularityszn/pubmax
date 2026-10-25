// Build runtime files and the freshness stamp from committed observations only. No network or new observation dates.
import { mkdir, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { canonicalOsmId } from "../lib/harvestFold.ts";
import { PLACES_ENRICHMENT_STAMP, placesEnrichmentStamp, readPlacesEnrichmentPacks } from "./lib/placesEnrichmentStamp.mjs";

async function removeIfPresent(file) {
  try {
    await unlink(file);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function writeAtomic(file, content) {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { flag: "wx" });
    await rename(temporary, file);
  } finally {
    await removeIfPresent(temporary);
  }
}

const root = process.cwd();
const packs = readPlacesEnrichmentPacks(root);
if (!packs.places_enrichment) throw new Error("Invalid Places enrichment pack");
const records = Object.values(packs).flatMap((pack) => pack.venues);
const grouped = new Map();
for (const row of records) {
  const key = typeof row?.venueId === "string" ? canonicalOsmId(row.venueId) : null;
  if (!key || typeof row.googlePlaceId !== "string" || !/^[A-Za-z0-9_-]{10,}$/.test(row.googlePlaceId)) {
    throw new Error("Invalid Places enrichment identity");
  }
  const existing = grouped.get(key) ?? [];
  const same = existing.find((entry) => entry.googlePlaceId === row.googlePlaceId);
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
  await writeAtomic(file, `${JSON.stringify(rows)}\n`);
}
for (const name of await readdir(directory)) {
  if (/^(node|way|relation)-\d+\.json$/.test(name) && !grouped.has(name.slice(0, -5).replace("-", "/"))) await removeIfPresent(path.join(directory, name));
}
const stamp = path.join(root, PLACES_ENRICHMENT_STAMP);
await writeAtomic(stamp, `${JSON.stringify(placesEnrichmentStamp(packs), null, 2)}\n`);
console.log(`Places enrichment runtime files: ${grouped.size} identities, ${records.length} records`);
