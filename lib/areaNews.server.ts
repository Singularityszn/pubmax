import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import type { AreaNewsDataset } from "@/lib/areaNews";

export type AreaNewsLoadResult =
  | (AreaNewsDataset & { status: "ready" })
  | { status: "unavailable"; version: 1; generatedAt: ""; entries: [] };

let loadResult: AreaNewsLoadResult | null = null;

/** Read the committed dataset once and preserve read failure as a distinct state. */
export async function loadAreaNews(): Promise<AreaNewsLoadResult> {
  if (loadResult) return loadResult;
  try {
    const file = path.join(process.cwd(), "data", "area_news.json");
    const parsed = JSON.parse(await readFile(file, "utf8")) as Partial<AreaNewsDataset>;
    if (
      typeof parsed.version !== "number" ||
      typeof parsed.generatedAt !== "string" ||
      !Array.isArray(parsed.entries)
    ) {
      throw new Error("Area news dataset shape is invalid.");
    }
    loadResult = {
      status: "ready",
      version: parsed.version,
      generatedAt: parsed.generatedAt,
      entries: parsed.entries,
    };
  } catch {
    loadResult = { status: "unavailable", version: 1, generatedAt: "", entries: [] };
  }
  return loadResult;
}

/** Test-only: drop the in-memory cache between cases. */
export function __resetAreaNewsCache(): void {
  loadResult = null;
}
