#!/usr/bin/env node
// Reports which repo migration labels are missing from an applied list, and
// which applied labels sit after a missing one. The comparison is by the
// four-digit label, not the 14-digit version: production can record the same
// migration under a different timestamp than the file in this repo.
//
// Usage:
//   node scripts/qa/schema-level-report.mjs --against <file>
//     <file> is a paste: `supabase migration list` output, or rows of
//     `version` and `name` from supabase_migrations.schema_migrations.
//     A name like 0170_profiles_table_door counts as label 0170. A name that
//     dropped the label, plan_membership_account_claim, still counts as the
//     repo file that ends in that name. The version need not match.
//
//   node scripts/qa/schema-level-report.mjs --fetch
//     Reads that same ledger with one read-only select. The connection
//     string is SCHEMA_LEVEL_DATABASE_URL, SUPABASE_DB_URL, or DATABASE_URL.
//     The session is default_transaction_read_only. Nothing is written.
//
// Prints two lists, missing first, then out-of-order. A label is missing
// when no applied row carries its label, its descriptive name, or one of its
// repo files' versions. A label is out of order when it is applied and an
// earlier label, in timestamp apply order, is missing. Exit 0 after a report.
// Exit 1 when the invocation itself is wrong.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  isMigrationApplied,
  labelOf,
  listMigrations,
  parseAppliedLabels,
  parseAppliedNames,
  parseAppliedVersions,
} from "./migration-apply-list.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const MIGRATIONS_DIR = path.join(REPO_ROOT, "supabase", "migrations");

export const APPLIED_LIST_SQL =
  "select version, coalesce(name, '') as name from supabase_migrations.schema_migrations order by version";

const DATABASE_URL_KEYS = ["SCHEMA_LEVEL_DATABASE_URL", "SUPABASE_DB_URL", "DATABASE_URL"];

export function databaseUrlFrom(env) {
  for (const key of DATABASE_URL_KEYS) {
    const value = env[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

// Compares repo filenames, oldest timestamp first, with a pasted or fetched
// applied list. Labels are reported once, in the order their first file appears.
export function compareSchemaLevel(migrations, appliedText) {
  const appliedVersions = parseAppliedVersions(appliedText);
  const appliedLabels = parseAppliedLabels(appliedText);
  const appliedNames = parseAppliedNames(appliedText);
  const filesByLabel = new Map();
  const order = [];

  for (const name of migrations) {
    const label = labelOf(name);
    if (!label) continue;
    if (!filesByLabel.has(label)) {
      filesByLabel.set(label, []);
      order.push(label);
    }
    filesByLabel.get(label).push(name);
  }

  const applied = new Set();
  for (const label of order) {
    const recorded = filesByLabel
      .get(label)
      .some((name) => isMigrationApplied(name, appliedVersions, appliedLabels, appliedNames));
    if (recorded) applied.add(label);
  }

  const missing = [];
  const outOfOrder = [];
  let gap = false;
  for (const label of order) {
    if (!applied.has(label)) {
      missing.push(label);
      gap = true;
      continue;
    }
    if (gap) outOfOrder.push(label);
  }

  return { missing, outOfOrder };
}

export function formatSchemaLevelReport({ missing, outOfOrder }) {
  return ["missing:", ...missing, "out-of-order:", ...outOfOrder, ""].join("\n");
}

// Runs the fixed select. `execFile` is injectable so a test can see the
// arguments without a database. The connection string is an argument to psql
// and is stripped from any error this function throws.
export function fetchAppliedList(env, execFile = execFileSync) {
  const url = databaseUrlFrom(env);
  if (!url) {
    throw new Error(
      "--fetch needs SCHEMA_LEVEL_DATABASE_URL, SUPABASE_DB_URL, or DATABASE_URL",
    );
  }
  const psql = env.PSQL || "psql";
  const previousOptions = env.PGOPTIONS ? `${env.PGOPTIONS} ` : "";
  try {
    return execFile(
      psql,
      [url, "--no-psqlrc", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-F", "\t", "-c", APPLIED_LIST_SQL],
      {
        encoding: "utf8",
        env: {
          ...env,
          PGOPTIONS: `${previousOptions}-c default_transaction_read_only=on`,
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes(url)) {
      throw new Error("--fetch failed");
    }
    throw error;
  }
}

function main() {
  const args = process.argv.slice(2);
  const againstIndex = args.indexOf("--against");
  const fetch = args.includes("--fetch");
  if ((againstIndex !== -1 && fetch) || (againstIndex === -1 && !fetch)) {
    console.error(
      "Usage: node scripts/qa/schema-level-report.mjs --against <file> | --fetch",
    );
    process.exitCode = 1;
    return;
  }

  let appliedText;
  if (fetch) {
    try {
      appliedText = fetchAppliedList(process.env);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
      return;
    }
  } else {
    const appliedFile = args[againstIndex + 1];
    if (!appliedFile) {
      console.error("--against needs a file path");
      process.exitCode = 1;
      return;
    }
    appliedText = readFileSync(appliedFile, "utf8");
  }

  const report = compareSchemaLevel(listMigrations(MIGRATIONS_DIR), appliedText);
  process.stdout.write(formatSchemaLevelReport(report));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
