#!/usr/bin/env node
// No Python file under scripts/ may open a network connection. Harvest lanes
// are Node and every fetched URL passes lib/harvest/sourcePolicy.ts; the
// retired extract_pint_prices.py fetched with requests outside the fence.
// Python here is for replay builders that read committed files only.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCRIPTS = join(ROOT, "scripts");

const NETWORK_PATTERNS = [
  /^\s*(?:import|from)\s+(?:requests|urllib\.request|http\.client|aiohttp|httpx)\b/m,
  /\brequests\.(?:get|post|put|delete|head|patch|request|Session)\s*\(/,
  /\burlopen\s*\(/,
];

function* pythonFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* pythonFiles(path);
    else if (entry.name.endsWith(".py")) yield path;
  }
}

const offenders = [];
for (const file of pythonFiles(SCRIPTS)) {
  const text = readFileSync(file, "utf8");
  if (NETWORK_PATTERNS.some((pattern) => pattern.test(text))) {
    offenders.push(file.slice(ROOT.length + 1));
  }
}

if (offenders.length > 0) {
  console.error("Python network access is not a permitted harvest lane:");
  for (const file of offenders) console.error(`  ${file}`);
  console.error("Fetch through a Node lane behind lib/harvest/sourcePolicy.ts instead.");
  process.exit(1);
}
