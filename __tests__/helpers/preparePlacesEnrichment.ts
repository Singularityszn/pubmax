import { execFileSync } from "node:child_process";

/** Match build-time venue evidence before any worker reads the real dataset. */
export default function preparePlacesEnrichment(): void {
  execFileSync(process.execPath, ["--import", "tsx", "scripts/build_places_enrichment.mjs"], {
    cwd: process.cwd(),
    stdio: "pipe",
  });
}
