import { readFileSync } from "node:fs";
import { join } from "node:path";

import { rowsFromSlimPayload } from "@/lib/slimPayload";
import { displayVenueName, venueSourceNameField } from "@/lib/venueDisplay";
import { venueSearchNames } from "@/lib/venueSearchNames.mjs";

type SlimRow = {
  id?: string;
  name?: string;
  cheapestPrice?: number;
};

export type PalEvalVenueIndex = {
  ids: Set<string>;
  priceById: Map<string, number>;
  namesById: Map<string, string[]>;
};

export function loadPalEvalVenueIndex(cwd = process.cwd()): PalEvalVenueIndex {
  const path = join(cwd, "public/data/venues_slim.json");
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  const rows = (rowsFromSlimPayload(raw) ?? []) as SlimRow[];
  const ids = new Set<string>();
  const priceById = new Map<string, number>();
  const namesById = new Map<string, string[]>();
  for (const row of rows) {
    const id = typeof row.id === "string" ? row.id : "";
    if (id) ids.add(id);
    if (id && typeof row.name === "string" && row.name.trim()) {
      namesById.set(id, venueSearchNames({ id, name: displayVenueName(row.name), ...venueSourceNameField(row.name) }));
    }
    if (id && typeof row.cheapestPrice === "number" && Number.isFinite(row.cheapestPrice)) {
      priceById.set(id, row.cheapestPrice);
    }
  }
  return { ids, priceById, namesById };
}
