#!/usr/bin/env node
// npm run check:migration-ledger - fail when production lacks a migration the
// repo ships. Read-only against production. scripts/lib/migrationLedger.mjs
// owns the rule; `npm run release:prod` runs the same check before an upload.

import { checkMigrationLedger } from "./lib/migrationLedger.mjs";

try {
  const { remoteOnly } = await checkMigrationLedger({ say: (line) => console.log(`[ledger] ${line}`) });
  if (remoteOnly.length > 0) {
    console.log(`[ledger] Remote-only names (no repo file explains them): ${remoteOnly.join(", ")}`);
  }
  console.log("[ledger] Production holds every migration the repo ships.");
} catch (error) {
  console.error(`[ledger] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
