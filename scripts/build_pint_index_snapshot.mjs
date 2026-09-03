#!/usr/bin/env node
// Build the LIVE public London Pint Index snapshot from confirmed Pint Drops.
//
//   npm run build:pint-index-snapshot
//   npm run build:pint-index-snapshot -- --dry-run
//
// The rules are not in this file. `lib/pintIndexFromConfirmations.ts` decides
// what becomes an observation and what is dropped and counted; `lib/pintIndex.ts`
// decides what the snapshot may contain at all, and this validates against it
// and dies rather than write a file that module would refuse.
//
// FOUR refusals, because overwriting a published Index badly is worse than not
// writing at all:
//   • no durable store configured: it would read zero and publish an empty
//     Index over a real one;
//   • the store read threw: same outcome, from a different cause;
//   • the confirmed-drop read came back at its own cap: the Index would be
//     silently truncated, and a dropped pub is a pub the Index stops covering
//     with nothing saying so;
//   • the built snapshot fails its own validator.
//
// Publishing a snapshot with ZERO observations is NOT a refusal. A read that
// answered and found no confirmations is the truth, and `"status": "empty"` is
// how this Index says so.
//
// Run it, then `npm run publish:pint-index-month` on or after the 1st to freeze
// the closed month.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { boroughNameForPoint, LONDON_BOROUGH_CLASSIFIER_VERSION } from "../lib/londonBoroughPoint.mjs";
import { LONDON_BOROUGH_NAMES, validatePintIndexSnapshot } from "../lib/pintIndex.ts";
import { buildPintIndexSnapshotFromConfirmations } from "../lib/pintIndexFromConfirmations.ts";
import { MAX_INDEX_CONFIRMED_DROPS, pintDropsStore } from "../lib/pintDropsStore.ts";
import { isSupabaseConfigured } from "../lib/supabase.ts";
import { getVenueIndex } from "../lib/venueIndex.ts";

const ROOT = process.cwd();
const SNAPSHOT_PATH = path.join(ROOT, "public/data/pint_index_snapshot.json");
const BOUNDARIES_PATH = path.join(ROOT, "data/london_boroughs_simplified.json");

// The site publishes the Index, and one citation resolves to the Pint Drop's
// own public permalink. Both are facts about this deployment, not about a drop,
// so they are stated here rather than derived inside the builder.
const PUBLISHER = "PUBMAXX";
const SITE_ORIGIN = "https://pubmaxxing.com";
const LICENCE = null;

// True of the whole Index rather than of any drop, and it stays true: the
// legacy competitor-derived baseline is not a source this Index may cite.
const CARRIED_EXCLUSIONS = [
  {
    reason: "source_not_eligible_for_public_index",
    observationCount: 2796,
    note: "Legacy competitor-derived baseline remains quarantined from this citable snapshot.",
  },
];

function die(message) {
  console.error(`build_pint_index_snapshot: ${message}`);
  process.exit(1);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  if (!isSupabaseConfigured()) {
    die(
      "no durable store is configured, so this run would read zero confirmations and publish an empty Index over a real one",
    );
  }

  const generatedAt = new Date().toISOString();
  let drops;
  try {
    drops = await pintDropsStore().listConfirmedDrops(Date.parse(generatedAt));
  } catch (error) {
    die(`the confirmed Pint Drop read failed: ${error instanceof Error ? error.message : error}`);
  }
  if (drops.length >= MAX_INDEX_CONFIRMED_DROPS) {
    die(
      `the confirmed Pint Drop read came back at its cap of ${MAX_INDEX_CONFIRMED_DROPS}, so this Index would be truncated; raise the cap in lib/pintDropsStore.ts before publishing`,
    );
  }

  const index = await getVenueIndex();
  const venues = new Map();
  for (const [id, venue] of index) {
    venues.set(id, { name: venue.name, lat: venue.lat, lng: venue.lng });
  }

  const boundaries = JSON.parse(await readFile(BOUNDARIES_PATH, "utf8"));
  const allowedNames = new Set(LONDON_BOROUGH_NAMES);
  const classify = (lat, lng) => boroughNameForPoint(lat, lng, boundaries, allowedNames);

  const built = buildPintIndexSnapshotFromConfirmations({
    drops,
    venues,
    classify,
    snapshotId: `london-pint-index-public-${generatedAt.slice(0, 10).replace(/-/g, "")}-v1`,
    generatedAt,
    classification: {
      version: LONDON_BOROUGH_CLASSIFIER_VERSION,
      method: "point_in_polygon",
      sourceArtifact: "data/london_boroughs_simplified.json",
      licence: "Open Government Licence v3.0",
    },
    publisher: PUBLISHER,
    dropUrl: (dropId) => `${SITE_ORIGIN}/p/${dropId}`,
    licence: LICENCE,
    carriedExclusions: CARRIED_EXCLUSIONS,
  });

  const validation = validatePintIndexSnapshot(built.snapshot);
  if (!validation.ok) {
    die(`the built snapshot fails its own contract:\n  ${validation.errors.join("\n  ")}`);
  }

  const dropped = built.examined - built.published;
  console.log(
    `read ${built.examined} confirmed Pint Drops, published ${built.published}, dropped ${dropped}, status ${built.snapshot.status}`,
  );
  for (const row of built.snapshot.excluded) {
    console.log(`  excluded ${row.observationCount}: ${row.reason}`);
  }

  if (dryRun) {
    console.log("dry run: nothing was written");
    return;
  }
  await writeFile(SNAPSHOT_PATH, `${JSON.stringify(built.snapshot, null, 2)}\n`, "utf8");
  console.log(`wrote ${path.relative(ROOT, SNAPSHOT_PATH)}`);
}

main().catch((error) => {
  die(error instanceof Error ? error.stack ?? error.message : String(error));
});
