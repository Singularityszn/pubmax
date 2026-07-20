import { readFile } from "node:fs/promises";
import path from "node:path";

import type { AreaNewsDataset } from "@/lib/areaNews";

let cache: AreaNewsDataset | null = null;

/** Read the committed dataset once. Never throws: a read/parse failure yields an
 *  empty dataset so every surface fails soft to "nothing here" rather than 500. */
export async function loadAreaNews(): Promise<AreaNewsDataset> {
  if (cache) return cache;
  try {
    const file = path.join(process.cwd(), "data", "area_news.json");
    const parsed = JSON.parse(await readFile(file, "utf8")) as Partial<AreaNewsDataset>;
    cache = {
      version: typeof parsed.version === "number" ? parsed.version : 1,
      generatedAt: typeof parsed.generatedAt === "string" ? parsed.generatedAt : "",
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    };
  } catch {
    cache = { version: 1, generatedAt: "", entries: [] };
  }
  return cache;
}

/** Test-only: drop the in-memory cache between cases. */
export function __resetAreaNewsCache(): void {
  cache = null;
}
