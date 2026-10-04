import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { validateAreaNewsEntry, type AreaNewsDataset } from "@/lib/areaNews";
import { classifyExtractedFact, KNOWN_AREA_SLUGS } from "../scripts/lib/keenableAreaNews.mjs";

export type AreaNewsLoadResult =
  | (AreaNewsDataset & { status: "ready" })
  | { status: "unavailable"; version: 1; generatedAt: ""; entries: [] };

let cachedDataset: AreaNewsDataset | null = null;
let cachedProjection: { day: number; result: AreaNewsLoadResult } | null = null;

function projectAreaNews(dataset: AreaNewsDataset, day: number): AreaNewsLoadResult {
  const oldestAllowed = day - 21 * 24 * 60 * 60 * 1000;
  const currentYear = new Date(day).getUTCFullYear();
  const entries: AreaNewsDataset["entries"] = [];

  for (const entry of dataset.entries) {
    const observedAt = Date.parse(`${entry.observedAt}T00:00:00Z`);
    if (observedAt < oldestAllowed || observedAt > day) continue;

    const harvestYears = new Set([new Date(observedAt).getUTCFullYear(), currentYear]);
    const classification = [...harvestYears]
      .map((year) => classifyExtractedFact({ content: JSON.stringify(entry) }, {
        knownAreas: KNOWN_AREA_SLUGS,
        currentYear: year,
        now: day,
      }))
      .find(({ status }) => status !== "invalid") ?? { status: "invalid" as const };
    if (classification.status === "invalid") {
      throw new Error("Area news dataset current fact is invalid.");
    }
    if (classification.status === "current") entries.push(entry);
  }

  return {
    status: "ready",
    version: dataset.version,
    generatedAt: dataset.generatedAt,
    entries,
  };
}

/** Cache the validated source rows, then project current facts once per UTC day. */
export async function loadAreaNews(): Promise<AreaNewsLoadResult> {
  try {
    if (!cachedDataset) {
      const file = path.join(process.cwd(), "data", "area_news.json");
      const parsed = JSON.parse(await readFile(file, "utf8")) as Partial<AreaNewsDataset>;
      if (
        typeof parsed.version !== "number" ||
        typeof parsed.generatedAt !== "string" ||
        !Array.isArray(parsed.entries) ||
        parsed.entries.some((entry) => validateAreaNewsEntry(entry).length > 0)
      ) {
        throw new Error("Area news dataset shape is invalid.");
      }
      cachedDataset = {
        version: parsed.version,
        generatedAt: parsed.generatedAt,
        entries: parsed.entries,
      };
    }
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const day = today.getTime();
    if (cachedProjection?.day !== day) {
      cachedProjection = { day, result: projectAreaNews(cachedDataset, day) };
    }
    return cachedProjection.result;
  } catch {
    cachedDataset = null;
    cachedProjection = null;
    return { status: "unavailable", version: 1, generatedAt: "", entries: [] };
  }
}

/** Test-only: drop the in-memory cache between cases. */
export function __resetAreaNewsCache(): void {
  cachedDataset = null;
  cachedProjection = null;
}
