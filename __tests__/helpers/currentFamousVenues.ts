import { readFileSync } from "node:fs";
import path from "node:path";

import { assertCurrentFamousVenueRows } from "@/scripts/build_slim_index.mjs";

const ROOT = path.resolve(__dirname, "..", "..");
const FAMOUS_DIR = path.join(ROOT, "data", "famous_venues");

const PACK_FILES = ["bars.json", "late_food.json", "restaurants.json"] as const;

type FamousSeedRow = {
  id: string;
  kind: "bar" | "food" | "restaurant";
  observedAt: string;
  expiresAt: string;
};

function loadFamousSeedRows(): FamousSeedRow[] {
  return PACK_FILES.flatMap((file) =>
    JSON.parse(readFileSync(path.join(FAMOUS_DIR, file), "utf8")) as FamousSeedRow[],
  );
}

function currentFamousVenueRows(asOf: Date = new Date()) {
  return assertCurrentFamousVenueRows(loadFamousSeedRows(), asOf);
}

export function expectedSlimFamousCounts(asOf: Date = new Date()) {
  const rows = currentFamousVenueRows(asOf);
  return {
    bar: rows.filter((row) => row.kind === "bar").length,
    food: rows.filter((row) => row.kind === "food").length,
    restaurant: rows.filter((row) => row.kind === "restaurant").length,
    total: rows.length,
  };
}

export function currentFamousVenueIds(asOf: Date = new Date()) {
  return new Set(currentFamousVenueRows(asOf).map((row) => row.id));
}
