#!/usr/bin/env node
// Cut the Discover board out of the bundled pint dataset, and write it once.
//
//   npm run build:discover-board
//
// THE RULE LIVES IN lib/discoverBoard.ts (`discoverBoardFromVenues`), and this
// script only reads the dataset, calls it and writes the answer, so the
// producer and the page cannot disagree about what the ten cheapest pints are.
// The input is the same `public/data/pint_prices_app_dataset.json` the app
// reads everywhere else, grouped through the canonical `groupVenuePrices`.
//
// Why it exists: Discover used to fetch that 6,868 KB dataset in the BROWSER to
// print ten rows. Nothing in it is a live number, so the answer is cut here.
//
// Runs under tsx because the rule is TypeScript.
// __tests__/discoverBoard.test.ts recomputes this file from the same dataset
// and fails when the shipped copy drifts.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { discoverBoardFromVenues } from "../lib/discoverBoard.ts";
import { groupVenuePrices } from "../lib/venues.ts";
import { PINT_DATASET_FILE, PINT_DATASET_OBSERVED_AT } from "../lib/dataFreshness.ts";

export const DISCOVER_BOARD_OUTPUT = path.join(
  "public",
  "data",
  "discover",
  "board.json",
);

/** The grouped venue set the board is cut from. */
export async function readDatasetVenues(root = process.cwd()) {
  const file = path.join(root, "public", "data", PINT_DATASET_FILE);
  const rows = JSON.parse(await readFile(file, "utf8"));
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`discover board: ${PINT_DATASET_FILE} holds no rows`);
  }
  return groupVenuePrices(rows);
}

/**
 * Build the board and refuse an empty one. A board with no ranked rows would
 * publish "no priced pints to rank" over a dataset holding 952 of them, so a
 * thin read fails the build rather than shipping a wrong answer.
 */
export function buildDiscoverBoard(venues, observedAt) {
  const board = discoverBoardFromVenues(venues, observedAt);
  if (board.cheapest.length === 0 || board.baselines.length === 0) {
    throw new Error(
      "discover board: the dataset yielded no priced venues, refusing to write an empty board",
    );
  }
  return board;
}

async function main() {
  const venues = await readDatasetVenues();
  // The dataset's own collection day, never the wall clock: the artifact is
  // then byte-stable across builds and dates what it really dates.
  const board = buildDiscoverBoard(venues, PINT_DATASET_OBSERVED_AT.toISOString());
  const out = path.join(process.cwd(), DISCOVER_BOARD_OUTPUT);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(board)}\n`, "utf8");
  console.log(
    `discover board: ${board.cheapest.length} ranked rows, ${board.baselines.length} baselines -> ${DISCOVER_BOARD_OUTPUT}`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
