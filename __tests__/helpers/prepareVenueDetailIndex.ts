import { execFileSync } from "node:child_process";

/**
 * Rebuild the venue detail index from this tree before any worker reads it.
 *
 * `data/generated/venue_detail_index.json` and `venue_details.jsonl` are
 * gitignored, so a checkout of another commit keeps the old pair, and
 * validate-data then fails its parity check against the committed pint
 * dataset. Building them only "when missing" kept that stale pair, and a
 * worker that did build them raced the workers reading them. `--details-only`
 * writes just these two files (about a second), never a committed map pack,
 * and it runs after the places enrichment it reads.
 */
export default function prepareVenueDetailIndex(): void {
  execFileSync(process.execPath, ["scripts/build_slim_index.mjs", "--details-only"], {
    cwd: process.cwd(),
    env: { ...process.env, DEPLOYMENT_VERSION: "local" },
    stdio: "pipe",
  });
}
