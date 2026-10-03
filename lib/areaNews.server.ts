import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { validateAreaNewsEntry, type AreaNewsDataset } from "@/lib/areaNews";
import { classifyExtractedFact, KNOWN_AREA_SLUGS } from "../scripts/lib/keenableAreaNews.mjs";

export type AreaNewsLoadResult =
  | (AreaNewsDataset & { status: "ready" })
  | { status: "unavailable"; version: 1; generatedAt: ""; entries: [] };

let cachedDataset: AreaNewsDataset | null = null;

function projectAreaNews(dataset: AreaNewsDataset, now: number): AreaNewsLoadResult {
  const nowDay = new Date(now);
  nowDay.setUTCHours(0, 0, 0, 0);
  const oldestAllowed = nowDay.getTime() - 21 * 24 * 60 * 60 * 1000;
  const currentYear = nowDay.getUTCFullYear();
  const entries: AreaNewsDataset["entries"] = [];

  for (const entry of dataset.entries) {
    const observedAt = Date.parse(`${entry.observedAt}T00:00:00Z`);
    if (observedAt < oldestAllowed || observedAt > nowDay.getTime()) continue;

    const classification = classifyExtractedFact({ content: JSON.stringify(entry) }, {
      knownAreas: KNOWN_AREA_SLUGS,
      currentYear,
      now: nowDay.getTime(),
    });
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

/** Cache the validated source rows, then project current facts on every read. */
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
    return projectAreaNews(cachedDataset, Date.now());
  } catch {
    cachedDataset = null;
    return { status: "unavailable", version: 1, generatedAt: "", entries: [] };
  }
}

/** Test-only: drop the in-memory cache between cases. */
export function __resetAreaNewsCache(): void {
  cachedDataset = null;
}
