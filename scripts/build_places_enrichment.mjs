// Build runtime files from committed observations only. No network or new observation dates.
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { canonicalOsmId } from "../lib/harvestFold.ts";

const root = process.cwd();
const pack = JSON.parse(await readFile(path.join(root, "data/places_enrichment.json"), "utf8"));
if (pack.version !== 1 || !Array.isArray(pack.venues)) throw new Error("Invalid Places enrichment pack");
const grouped = new Map();
for (const row of pack.venues) {
  const key = typeof row?.venueId === "string" ? canonicalOsmId(row.venueId) : null;
  if (!key || typeof row.googlePlaceId !== "string" || !/^[A-Za-z0-9_-]{10,}$/.test(row.googlePlaceId)) {
    throw new Error("Invalid Places enrichment identity");
  }
  grouped.set(key, [...(grouped.get(key) ?? []), row]);
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
console.log(`Places enrichment runtime files: ${grouped.size} identities, ${pack.venues.length} records`);
