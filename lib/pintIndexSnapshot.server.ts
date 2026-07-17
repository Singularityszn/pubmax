import { promises as fs } from "node:fs";
import path from "node:path";

import { validatePintIndexSnapshot, type PintIndexSnapshot } from "@/lib/pintIndex";

export const PINT_INDEX_SNAPSHOT_PATH = "public/data/pint_index_snapshot.json";

export async function loadPublicPintIndexSnapshot(): Promise<PintIndexSnapshot | null> {
  try {
    const raw = await fs.readFile(path.join(process.cwd(), PINT_INDEX_SNAPSHOT_PATH), "utf8");
    const result = validatePintIndexSnapshot(JSON.parse(raw));
    return result.ok ? result.snapshot : null;
  } catch {
    return null;
  }
}
