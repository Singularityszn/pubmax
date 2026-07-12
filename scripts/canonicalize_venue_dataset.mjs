// Canonicalize duplicate venue identities in the bundled price dataset (D1).
//
// The venue dataset carries the same physical pub twice across dataset lineages
// (e.g. a seed record + a Wetherspoons-directory record), which double-counts
// pubs in borough leaderboards and duplicates map pins. This step collapses
// those duplicates in place — rewriting the losing rows' identity fields to the
// canonical pub so every downstream consumer groups them as one venue — and
// emits public/data/venue_id_aliases.json mapping each merged id to its
// canonical id, so stored references (pint drops, plans, saved lists) still
// resolve via lib/venueAliases.ts.
//
// Runs as part of the reproducible pipeline (postexport:data + prebuild:slim),
// so it heals both this committed artifact AND any regeneration from the CSV.
// Idempotent: a run against an already-canonical dataset finds no duplicates
// and leaves both files untouched (aliases are merged cumulatively, never
// clobbered, so a dedup already applied is never forgotten).
//
// Run manually:  node scripts/canonicalize_venue_dataset.mjs

import { readFile, writeFile } from "node:fs/promises";
import path, { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalizeDataset } from "./lib/venueCanonicalization.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATASET_PATH = path.join(ROOT, "public", "data", "pint_prices_app_dataset.json");
const ALIASES_PATH = path.join(ROOT, "public", "data", "venue_id_aliases.json");

async function readJsonOr(pathname, fallback) {
  try {
    return JSON.parse(await readFile(pathname, "utf8"));
  } catch {
    return fallback;
  }
}

async function main() {
  const rows = JSON.parse(await readFile(DATASET_PATH, "utf8"));
  if (!Array.isArray(rows)) {
    throw new Error(`Expected an array in ${DATASET_PATH}, got ${typeof rows}`);
  }

  const { rows: newRows, aliases, clusters, stats } = canonicalizeDataset(rows);

  // Cumulative alias map: never forget a dedup that was applied on an earlier
  // (full-dataset) run just because this run sees an already-canonical file.
  const prev = await readJsonOr(ALIASES_PATH, { aliases: {} });
  const mergedAliases = { ...(prev.aliases ?? {}), ...aliases };

  const aliasDoc = {
    version: 1,
    generatedBy: "scripts/canonicalize_venue_dataset.mjs",
    note:
      "duplicateVenueId -> canonicalVenueId. The same physical pub appeared twice across dataset lineages (e.g. Wetherspoons directory vs seed); those identities were collapsed into one venue. A stored reference to a merged id resolves to its canonical id via lib/venueAliases.ts — no id is ever deleted silently.",
    aliasCount: Object.keys(mergedAliases).length,
    aliases: mergedAliases,
    clusters: clusters.length > 0 ? clusters : prev.clusters ?? [],
  };

  const nextAliasText = `${JSON.stringify(aliasDoc, null, 2)}\n`;
  const prevAliasText = await readFile(ALIASES_PATH, "utf8").catch(() => "");

  if (stats.duplicateClusters > 0) {
    await writeFile(DATASET_PATH, JSON.stringify(newRows));
  }
  if (nextAliasText !== prevAliasText) {
    await writeFile(ALIASES_PATH, nextAliasText);
  }

  console.log(
    `canonicalize: ${stats.venueIdentitiesBefore} -> ${stats.venueIdentitiesAfter} venue identities ` +
      `(${stats.duplicateClusters} duplicate clusters, ${stats.mergedRecords} merged records this run; ` +
      `${Object.keys(mergedAliases).length} total aliases)`,
  );
  if (stats.duplicateClusters === 0) {
    console.log("canonicalize: dataset already canonical — dataset left unchanged");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
