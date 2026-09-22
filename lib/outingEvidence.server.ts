import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  discoverBaselineSourceUrl,
  parseDiscoverBoard,
  DISCOVER_BOARD_PATH,
} from "@/lib/discoverBoard";

export type OutingPriceEvidence = {
  priceGbp: number;
  drink: string;
  sourceUrl: string | null;
  reviewedAt: string | null;
};

/** Read the compact committed board; it carries source and collection date for each price. */
export async function loadOutingPriceEvidence(): Promise<Map<string, OutingPriceEvidence>> {
  try {
    const file = path.join(process.cwd(), "public", DISCOVER_BOARD_PATH.replace(/^\//, ""));
    const raw = JSON.parse(await readFile(file, "utf8")) as unknown;
    const board = parseDiscoverBoard(raw);
    if (!board) return new Map();
    const reviewedAt = Number.isFinite(Date.parse(board.observedAt))
      ? new Date(board.observedAt).toISOString()
      : null;
    return new Map(board.baselines.map((row) => [row.id, {
      priceGbp: row.cheapestPrice,
      drink: row.drink,
      sourceUrl: discoverBaselineSourceUrl(row.sourceRef),
      reviewedAt,
    }]));
  } catch {
    return new Map();
  }
}
