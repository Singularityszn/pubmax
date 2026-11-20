#!/usr/bin/env node
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { DISCOVER_BOARD_LIMIT, DISCOVER_BOARD_PATH, discoverBoardFromVenues } from "../lib/discoverBoard.ts";
import { PINT_DATASET_OBSERVED_AT } from "../lib/dataFreshness.ts";
import { loadLondonPintRanking } from "../lib/londonPintRanking.server.ts";
import { getPricedVenues } from "../lib/venuePriceIndex.ts";

const output = path.join("public", DISCOVER_BOARD_PATH);

async function main() {
  const ranking = await loadLondonPintRanking(DISCOVER_BOARD_LIMIT);
  const venues = await getPricedVenues();
  const board = discoverBoardFromVenues(venues, PINT_DATASET_OBSERVED_AT.toISOString(), ranking);
  if (board.cheapest.length === 0 || board.baselines.length === 0) {
    throw new Error(
      "discover board: the dataset yielded no priced venues, refusing to write an empty board",
    );
  }
  const out = path.join(process.cwd(), output);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(board)}\n`, "utf8");
  console.log(
    `discover board: ${board.cheapest.length} ranked rows, ${board.baselines.length} baselines -> ${output}`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
