import { readFileSync } from "node:fs";
import { join } from "node:path";

import { rowsFromSlimPayload } from "@/lib/slimPayload";

type SlimRow = {
  id?: string;
  name?: string;
  cheapestPrice?: number;
};

export type PalEvalVenueIndex = {
  ids: Set<string>;
  names: Set<string>;
  priceById: Map<string, number>;
};

let cached: PalEvalVenueIndex | null = null;

export function loadPalEvalVenueIndex(cwd = process.cwd()): PalEvalVenueIndex {
  if (cached) return cached;
  const path = join(cwd, "public/data/venues_slim.json");
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  const rows = (rowsFromSlimPayload(raw) ?? []) as SlimRow[];
  const ids = new Set<string>();
  const names = new Set<string>();
  const priceById = new Map<string, number>();
  for (const row of rows) {
    const id = typeof row.id === "string" ? row.id : "";
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (id) ids.add(id);
    if (name) names.add(name.toLowerCase());
    if (id && typeof row.cheapestPrice === "number" && Number.isFinite(row.cheapestPrice)) {
      priceById.set(id, row.cheapestPrice);
    }
  }
  cached = { ids, names, priceById };
  return cached;
}

export function resetPalEvalVenueIndexCache(): void {
  cached = null;
}
