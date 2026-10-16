#!/usr/bin/env node
// npm run price-pulse:draft -- --edition 2026-10-23
//
// Starts next week's Price Pulse edition as a DRAFT and registers it. It writes
// `data/price-pulse/<edition>.json` with `approved: false` and no items, and
// adds the file to `lib/pricePulseEditions.ts` between its markers. It fetches
// nothing: the research and the lines are the research agent's work, by the
// runbook in data/price-pulse/README.md. It never approves anything.
//
// The window ends the day before the edition and starts 30 days before that.
// `npx vitest run __tests__/pricePulse.test.tsx` then refuses the draft until
// every line is sourced, dated and written in our own words.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const ROOT = resolve(import.meta.dirname, "../..");
const DATA_DIR = join(ROOT, "data/price-pulse");
const REGISTRY = join(ROOT, "lib/pricePulseEditions.ts");
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function fail(message) {
  console.error(`price-pulse:draft: ${message}`);
  process.exit(1);
}

function shiftDay(day, days) {
  const ms = Date.parse(`${day}T00:00:00Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

const { values } = parseArgs({
  options: {
    edition: { type: "string" },
    "window-start": { type: "string" },
    "window-end": { type: "string" },
  },
});

const edition = values.edition;
if (!edition || !DAY_RE.test(edition) || !Number.isFinite(Date.parse(`${edition}T00:00:00Z`))) {
  fail("pass --edition YYYY-MM-DD");
}
const windowEnd = values["window-end"] ?? shiftDay(edition, -1);
const windowStart = values["window-start"] ?? shiftDay(windowEnd, -30);
for (const [name, day] of [["--window-start", windowStart], ["--window-end", windowEnd]]) {
  if (!DAY_RE.test(day)) fail(`${name} must be YYYY-MM-DD`);
}

const file = join(DATA_DIR, `${edition}.json`);
if (existsSync(file)) fail(`data/price-pulse/${edition}.json already exists`);

const draft = {
  schemaVersion: 1,
  edition,
  title: "",
  summary: "",
  windowStart,
  windowEnd,
  approved: false,
  approvedAt: null,
  items: [],
};
writeFileSync(file, `${JSON.stringify(draft, null, 2)}\n`);

const binding = `edition${edition.replaceAll("-", "")}`;
let registry = readFileSync(REGISTRY, "utf8");
const importsEnd = "// price-pulse:imports:end";
const listEnd = "  // price-pulse:list:end";
if (!registry.includes(importsEnd) || !registry.includes(listEnd)) {
  fail("lib/pricePulseEditions.ts has lost its markers");
}
registry = registry
  .replace(importsEnd, `import ${binding} from "@/data/price-pulse/${edition}.json";\n${importsEnd}`)
  .replace(listEnd, `  ${binding},\n${listEnd}`);
writeFileSync(REGISTRY, registry);

console.log(`Drafted data/price-pulse/${edition}.json (approved: false), window ${windowStart} to ${windowEnd}.`);
console.log("Next: fill title, summary and items by data/price-pulse/README.md, then run");
console.log("  npx vitest run __tests__/pricePulse.test.tsx");
