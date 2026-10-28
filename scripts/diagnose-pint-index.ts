import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { diagnosePintIndex } from "../lib/pintIndexDiagnostics";

const args = process.argv.slice(2);
const usage = "Usage: node --import tsx scripts/diagnose-pint-index.ts [snapshot.json]";

if (args.length === 1 && args[0] === "--help") {
  process.stdout.write(`${usage}\n`);
} else if (args.length > 1 || args[0]?.startsWith("-")) {
  process.stderr.write(`${usage}\n`);
  process.exitCode = 2;
} else {
  try {
    const filename = resolve(args[0] ?? "public/data/pint_index_snapshot.json");
    const value: unknown = JSON.parse(readFileSync(filename, "utf8"));
    const report = diagnosePintIndex(value);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.status === "invalid") process.exitCode = 1;
  } catch {
    process.stderr.write("Could not read or parse the snapshot JSON.\n");
    process.exitCode = 1;
  }
}
