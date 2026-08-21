import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export async function checkProductionStoreFreshness({
  registry,
  fetchImpl = fetch,
  url = "https://pubmaxxing.com/api/freshness",
  now = Date.now(),
}) {
  const storeIds = new Set([
    "whats_on",
    ...(
    (registry.datasets ?? [])
      .filter((dataset) => dataset.stamp?.kind === "store")
      .map((dataset) => dataset.id)
    ),
  ]);
  const gateUrl = new URL(url);
  gateUrl.searchParams.set("release_gate", String(now));
  const response = await fetchImpl(gateUrl, {
    cache: "no-store",
    headers: { Accept: "application/json", "Cache-Control": "no-cache" },
  });
  if (!response.ok) throw new Error(`Production freshness endpoint returned ${response.status}.`);
  const body = await response.json();
  const byId = new Map((body.datasets ?? []).map((dataset) => [dataset.id, dataset]));
  const failures = [];
  for (const id of storeIds) {
    const result = byId.get(id);
    if (!result || !["fresh", "untracked"].includes(result.status)) {
      failures.push(`${id}: ${result?.status ?? "missing"} - ${result?.detail ?? "No result"}`);
    }
  }
  if (failures.length > 0) throw new Error(failures.join("\n"));
  return [...storeIds];
}

async function main() {
  const registry = JSON.parse(readFileSync(join(ROOT, "data/freshness_registry.json"), "utf8"));
  const checked = await checkProductionStoreFreshness({ registry });
  console.log(`PRODUCTION STORE FRESHNESS PASSED: ${checked.join(", ") || "no store feeds"}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`PRODUCTION STORE FRESHNESS FAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
